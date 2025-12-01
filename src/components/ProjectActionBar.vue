<template>
  <div class="action-bar">
    <button 
      class="action-btn start-btn"
      @click="startProject"
      :title="t('project.start_project')"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M8 5V19L19 12L8 5Z" fill="currentColor"/>
      </svg>
    </button>
    
    <button 
      class="action-btn settings-btn"
      @click="openSettings"
      :title="t('common.settings')"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="2"/>
        <path d="M3 9.11v5.77C3 17 3 17 5 18.35l5.5 3.18c.83.48 2.18.48 3 0l5.5-3.18c2-1.35 2-1.35 2-3.46V9.11C21 7 21 7 19 5.65l-5.5-3.18c-.82-.48-2.17-.48-3 0L5 5.65C3 7 3 7 3 9.11" stroke="currentColor" stroke-width="2"/>
      </svg>
    </button>
  </div>
</template>

<script>
import { useI18n } from '../utils/useI18n'

export default {
  name: 'ProjectActionBar',
  emits: ['start-project', 'open-settings'],
  props: {
    project: {
      type: Object,
      required: true
    }
  },
  setup() {
    // Use i18n composable
    const { t } = useI18n()
    
    return {
      t
    }
  },
  methods: {
    async startProject() {
      try {
        const settings = localStorage.getItem(`project-settings-${this.project.id}`)
        const startCommands = settings ? JSON.parse(settings).startCommands : ''
        
        if (!startCommands.trim()) {
          alert(this.t('messages.set_start_commands_first'))
          return
        }
        
        this.$emit('start-project', {
          project: this.project,
          commands: startCommands
        })
      } catch (error) {
        console.error('Error preparing start command:', error)
        alert(this.t('messages.project_start_error') + ': ' + error.message)
      }
    },
    
    openSettings() {
      this.$emit('open-settings', this.project)
    }
  }
}
</script>

<style scoped>
.action-bar {
  display: flex;
  gap: var(--spacing-xs);
  margin-top: var(--spacing-sm);
}

.action-btn {
  width: 28px;
  height: 28px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-primary);
  background-color: var(--bg-primary);
  color: var(--text-secondary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all var(--transition-fast);
  flex-shrink: 0;
}

.action-btn:hover {
  background-color: var(--primary-light);
  border-color: var(--primary-color);
  color: var(--primary-dark);
}

.start-btn {
  color: var(--success-color);
}

.start-btn:hover {
  background-color: var(--success-light);
  border-color: var(--success-color);
  color: var(--success-dark);
}

.settings-btn {
  color: var(--text-secondary);
}

.settings-btn:hover {
  background-color: var(--secondary-light);
  border-color: var(--secondary-color);
  color: var(--secondary-dark);
}
</style>
