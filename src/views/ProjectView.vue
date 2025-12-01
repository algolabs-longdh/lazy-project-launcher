<template>
  <div class="project-view">
    <div class="workspace">
      <div class="project-column">
        <div class="project-view-header">
          <div class="search-container">
            <svg class="search-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle cx="11" cy="11" r="8" stroke="currentColor" stroke-width="2"/>
              <path d="m21 21-4.35-4.35" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            <input 
              type="text" 
              :placeholder="t('project.search_projects')" 
              class="search-input"
              v-model="searchQuery"
            />
            <button 
              v-if="searchQuery"
              class="clear-btn"
              @click="clearSearch"
              title="Clear search"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M19 6.41L17.59 5L12 10.59L6.41 5L5 6.41L10.59 12L5 17.59L6.41 19L12 13.41L17.59 19L19 17.59L13.41 12L19 6.41Z" fill="currentColor"/>
              </svg>
            </button>
          </div>
          
          <button 
            class="import-btn"
            @click="importProject"
            :title="t('project.import_new_project')"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M14 2H6C4.9 2 4 2.9 4 4V20C4 21.1 4.89 22 5.99 22H18C19.1 22 20 21.1 20 20V8L14 2Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M14 2V8H20" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M12 18V12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M9 15L12 12L15 15" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
        </div>

        <div class="project-list-wrapper">
          <ProjectList 
            :search-query="searchQuery" 
            @select-project="handleProjectSelected"
            @start-project="handleProjectStart"
            @project-removed="handleProjectRemoved"
          />
        </div>
      </div>

      <div class="terminal-column">
        <div v-if="activeProject" class="terminal-wrapper">
          <div v-if="activeTerminal.error" class="terminal-error">
            <h3>{{ t('messages.terminal_open_error') }}</h3>
            <p>{{ activeTerminal.error }}</p>
            <button class="retry-btn" type="button" @click="retryActiveTerminal">
              Thử lại
            </button>
          </div>
          <ProjectTerminal
            v-else
            :project="activeProject"
            :session-id="activeTerminal.sessionId"
            :is-visible="!!activeProject"
            :is-connecting="activeTerminal.isConnecting"
            @close="handleTerminalClosed"
          />
        </div>
        <div v-else class="terminal-placeholder">
          <div class="terminal-placeholder-icon">🖥️</div>
          <h3>{{ t('project.open_terminal') }}</h3>
          <p>Chọn một project ở cột bên trái để hiển thị terminal.</p>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { ref, reactive, computed, onBeforeUnmount, watch } from 'vue'
import ProjectList from '../components/ProjectList.vue'
import ProjectTerminal from '../components/ProjectTerminal.vue'
import projectStore from '../store/projectStore'
import { useI18n } from '../utils/useI18n'

export default {
  name: 'ProjectView',
  components: {
    ProjectList,
    ProjectTerminal
  },
  setup() {
    const { t } = useI18n()
    const searchQuery = ref('')
    const activeProjectId = ref(null)
    const terminalSessions = reactive({})
    const sessionPromises = new Map()

    const ensureApiAvailable = () => {
      if (!window.electronAPI?.terminal) {
        alert(t('messages.terminal_open_failed'))
        throw new Error('Terminal API unavailable')
      }
    }

    const ensureSessionState = (projectId) => {
      if (!terminalSessions[projectId]) {
        terminalSessions[projectId] = {
          sessionId: null,
          isConnecting: false,
          error: null
        }
      }
      return terminalSessions[projectId]
    }

    const ensureTerminalSession = async (project) => {
      ensureApiAvailable()
      const state = ensureSessionState(project.id)

      if (state.sessionId) {
        return state
      }

      if (sessionPromises.has(project.id)) {
        return sessionPromises.get(project.id)
      }

      const creationPromise = (async () => {
        state.isConnecting = true
        state.error = null
        try {
          const result = await window.electronAPI.terminal.open({
            path: project.path
          })

          if (!result?.success || !result.sessionId) {
            throw new Error(result?.error || 'Unknown error')
          }

          state.sessionId = result.sessionId
          return state
        } catch (error) {
          state.error = error.message
          throw error
        } finally {
          state.isConnecting = false
          sessionPromises.delete(project.id)
        }
      })()

      sessionPromises.set(project.id, creationPromise)
      return creationPromise
    }

    const focusProjectTerminal = async (project) => {
      const state = await ensureTerminalSession(project)
      activeProjectId.value = project.id
      return state
    }

    const closeTerminalSession = async (projectId) => {
      const state = terminalSessions[projectId]
      if (!state) {
        return
      }

      if (state.sessionId && window.electronAPI?.terminal?.close) {
        try {
          await window.electronAPI.terminal.close(state.sessionId)
        } catch (error) {
          console.error('Failed to close terminal session', error)
        }
      }

      delete terminalSessions[projectId]
      if (activeProjectId.value === projectId) {
        activeProjectId.value = null
      }
    }

    const sendCommandToTerminal = (sessionId, rawCommands) => {
      ensureApiAvailable()
      const commandWithNewline = rawCommands.endsWith('\n') || rawCommands.endsWith('\r')
        ? rawCommands
        : `${rawCommands}\n`

      const payload = commandWithNewline.replace(/\r?\n/g, '\r')
      window.electronAPI.terminal.write(sessionId, payload)
    }

    const handleProjectSelected = async (project) => {
      try {
        await focusProjectTerminal(project)
      } catch (error) {
        console.error('Failed to open terminal for project', error)
      }
    }

    const handleProjectStart = async ({ project, commands }) => {
      try {
        const state = await focusProjectTerminal(project)
        if (!state?.sessionId) {
          throw new Error('Terminal chưa sẵn sàng')
        }
        sendCommandToTerminal(state.sessionId, commands)
      } catch (error) {
        console.error('Failed to start project inside terminal', error)
        alert(t('messages.project_start_error') + ': ' + error.message)
      }
    }

    const handleProjectRemoved = async (projectId) => {
      await closeTerminalSession(projectId)
    }

    const handleTerminalClosed = async () => {
      if (activeProjectId.value) {
        await closeTerminalSession(activeProjectId.value)
      }
    }

    const retryActiveTerminal = async () => {
      if (!activeProject.value) {
        return
      }

      delete terminalSessions[activeProject.value.id]
      try {
        await focusProjectTerminal(activeProject.value)
      } catch (error) {
        console.error('Retry terminal failed', error)
      }
    }

    const clearSearch = () => {
      searchQuery.value = ''
    }

    const importProject = async () => {
      if (window.electronAPI) {
        try {
          const result = await window.electronAPI.sendMessage('import-project')
          if (!result?.success) {
            const errorMsg = result?.error || result?.message || 'Unknown error'
            console.error('Failed to trigger project import:', errorMsg)
          }
        } catch (error) {
          console.error('Error calling import project:', error)
        }
      } else {
        console.error('electronAPI not available')
      }
    }

    const activeProject = computed(() =>
      projectStore.projects.find((project) => project.id === activeProjectId.value) || null
    )

    const activeTerminal = computed(() => {
      if (!activeProjectId.value) {
        return {
          sessionId: null,
          isConnecting: false,
          error: null
        }
      }
      return terminalSessions[activeProjectId.value] || {
        sessionId: null,
        isConnecting: false,
        error: null
      }
    })

    watch(
      () => projectStore.projects.map((project) => project.id),
      (ids) => {
        const idSet = new Set(ids)
        if (activeProjectId.value && !idSet.has(activeProjectId.value)) {
          activeProjectId.value = null
        }

        Object.keys(terminalSessions).forEach((projectId) => {
          if (!idSet.has(projectId)) {
            closeTerminalSession(projectId)
          }
        })
      }
    )

    onBeforeUnmount(async () => {
      await Promise.all(
        Object.keys(terminalSessions).map((projectId) => closeTerminalSession(projectId))
      )
    })

    return {
      t,
      searchQuery,
      clearSearch,
      importProject,
      handleProjectSelected,
      handleProjectStart,
      handleProjectRemoved,
      handleTerminalClosed,
      retryActiveTerminal,
      activeProject,
      activeTerminal
    }
  }
}
</script>

<style scoped>
.project-view {
  min-height: 100vh;
  background-color: var(--bg-primary);
}

.workspace {
  display: grid;
  grid-template-columns: 1fr 3fr;
  min-height: 100vh;
}

.project-column {
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--border-primary);
  min-height: 100vh;
  background-color: var(--bg-primary);
}

.project-list-wrapper {
  flex: 1;
  overflow-y: auto;
}

.terminal-column {
  background-color: var(--bg-secondary);
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.terminal-wrapper {
  flex: 1;
  padding: var(--spacing-lg);
  display: flex;
  flex-direction: column;
}

.terminal-placeholder,
.terminal-error {
  flex: 1;
  padding: var(--spacing-xl);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  color: var(--text-secondary);
  gap: var(--spacing-md);
}

.terminal-placeholder-icon {
  font-size: 3rem;
}

.retry-btn {
  padding: var(--spacing-sm) var(--spacing-lg);
  border-radius: var(--radius-md);
  border: 1px solid var(--border-primary);
  background-color: var(--bg-primary);
  color: var(--text-primary);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.retry-btn:hover {
  background-color: var(--primary-light);
  border-color: var(--primary-color);
  color: var(--primary-dark);
}

.project-view-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--spacing-md) var(--spacing-lg);
  background-color: var(--bg-card);
  border-bottom: 1px solid var(--border-primary);
  position: sticky;
  top: 0;
  z-index: var(--z-sticky);
  gap: var(--spacing-md);
}

.search-container {
  position: relative;
  flex: 1;
}

.search-icon {
  position: absolute;
  left: var(--spacing-sm);
  top: 50%;
  transform: translateY(-50%);
  color: var(--text-secondary);
  pointer-events: none;
  width: 16px;
  height: 16px;
}

.search-input {
  width: 100%;
  padding: var(--spacing-xs) var(--spacing-sm) var(--spacing-xs) 2.5rem;
  border: 1px solid var(--border-primary);
  border-radius: var(--radius-md);
  background-color: var(--bg-primary);
  color: var(--text-primary);
  font-size: var(--text-sm);
  transition: all var(--transition-fast);
}

.search-input:focus {
  outline: none;
  border-color: var(--primary-color);
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
}

.search-input::placeholder {
  color: var(--text-muted);
}

.clear-btn {
  position: absolute;
  right: var(--spacing-sm);
  top: 50%;
  transform: translateY(-50%);
  width: 16px;
  height: 16px;
  border: none;
  background: none;
  color: var(--text-secondary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-sm);
  transition: all var(--transition-fast);
}

.clear-btn:hover {
  color: var(--text-primary);
  background-color: var(--bg-secondary);
}

.import-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-primary);
  background-color: var(--bg-primary);
  color: var(--text-primary);
  cursor: pointer;
  transition: all var(--transition-fast);
  flex-shrink: 0;
}

.import-btn:hover {
  background-color: var(--primary-light);
  border-color: var(--primary-color);
  color: var(--primary-dark);
  transform: translateY(-1px);
  box-shadow: var(--shadow-sm);
}

.import-btn svg {
  flex-shrink: 0;
}

@media (max-width: 1024px) {
  .workspace {
    grid-template-columns: 1fr;
  }

  .project-column,
  .terminal-column {
    min-height: auto;
  }

  .terminal-column {
    order: 2;
  }
}

@media (max-width: 768px) {
  .project-view-header {
    padding: var(--spacing-md);
    gap: var(--spacing-sm);
  }

  .search-input {
    font-size: var(--text-base);
  }

  .import-btn {
    width: 36px;
    height: 36px;
  }
}
</style>
