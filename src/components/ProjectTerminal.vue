<template>
  <div class="terminal-overlay">
    <div class="terminal-header">
      <div class="terminal-meta">
        <p class="terminal-title">
          {{ project?.name || t("project.open_terminal") }}
        </p>
        <p v-if="project?.path" class="terminal-path">
          {{ project.path }}
        </p>
      </div>
    </div>

    <div class="terminal-body">
      <div v-if="isConnecting" class="terminal-loading">
        <span class="spinner"></span>
        <span>{{ t("common.loading") }}</span>
      </div>
      <div
        v-else
        ref="terminalContainer"
        class="terminal-instance"
      ></div>
    </div>

    <div v-if="exitInfo" class="terminal-exit">
      <span>
        Process exited with code {{ exitInfo.code }}
        <template v-if="exitInfo.signal !== null && exitInfo.signal !== undefined">
          (signal {{ exitInfo.signal }})
        </template>
      </span>
    </div>
  </div>
</template>

<script>
import { ref, watch, onBeforeUnmount, nextTick } from "vue";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { useI18n } from "../utils/useI18n";

export default {
  name: "ProjectTerminal",
  props: {
    project: {
      type: Object,
      default: null,
    },
    sessionId: {
      type: String,
      default: null,
    },
    isVisible: {
      type: Boolean,
      default: false,
    },
    isConnecting: {
      type: Boolean,
      default: false,
    },
  },
  setup(props) {
    const { t } = useI18n();
    const terminalContainer = ref(null);
    const exitInfo = ref(null);
    let terminalInstance = null;
    let fitAddon = null;
    let inputDisposable = null;
    let disposeDataListener = null;
    let disposeExitListener = null;

    const detachIpc = () => {
      if (disposeDataListener) {
        disposeDataListener();
        disposeDataListener = null;
      }

      if (disposeExitListener) {
        disposeExitListener();
        disposeExitListener = null;
      }
    };

    const disposeTerminal = () => {
      detachIpc();
      if (inputDisposable) {
        inputDisposable.dispose();
        inputDisposable = null;
      }
      if (terminalInstance) {
        terminalInstance.dispose();
        terminalInstance = null;
      }
      fitAddon = null;
    };

    const sendResize = () => {
      if (
        !terminalInstance ||
        !window.electronAPI?.terminal ||
        !props.sessionId
      ) {
        return;
      }

      window.electronAPI.terminal.resize(
        props.sessionId,
        terminalInstance.cols,
        terminalInstance.rows
      );
    };

    const handleWindowResize = () => {
      if (!fitAddon) {
        return;
      }

      fitAddon.fit();
      sendResize();
    };

    const registerIpcListeners = () => {
      if (!window.electronAPI?.terminal || !props.sessionId) {
        return;
      }

      disposeDataListener = window.electronAPI.terminal.onData((payload) => {
        if (payload?.sessionId === props.sessionId) {
          terminalInstance?.write(payload.data);
        }
      });

      disposeExitListener = window.electronAPI.terminal.onExit((payload) => {
        if (payload?.sessionId === props.sessionId) {
          exitInfo.value = {
            code: payload.code,
            signal: payload.signal,
          };
        }
      });
    };

    const initTerminal = async () => {
      if (!props.isVisible || !props.sessionId) {
        return;
      }

      await nextTick();
      if (!terminalContainer.value) {
        return;
      }

      disposeTerminal();
      exitInfo.value = null;

      terminalInstance = new Terminal({
        convertEol: true,
        cursorBlink: true,
        fontFamily: 'Menlo, "JetBrains Mono", Consolas, monospace',
        fontSize: 13,
        theme: {
          background: "#0f172a",
          foreground: "#e2e8f0",
          cursor: "#38bdf8",
        },
      });

      fitAddon = new FitAddon();
      terminalInstance.loadAddon(fitAddon);
      terminalInstance.open(terminalContainer.value);
      fitAddon.fit();

      if (window.electronAPI?.terminal) {
        inputDisposable = terminalInstance.onData((data) => {
          window.electronAPI.terminal.write(props.sessionId, data);
        });
      }

      registerIpcListeners();
      sendResize();
    };

    watch(
      () => props.sessionId,
      () => {
        if (props.sessionId && props.isVisible) {
          initTerminal();
        } else if (!props.sessionId) {
          disposeTerminal();
        }
      }
    );

    watch(
      () => props.isVisible,
      (visible) => {
        if (typeof window !== "undefined") {
          window.removeEventListener("resize", handleWindowResize);
        }

        if (visible && props.sessionId) {
          initTerminal();
          if (typeof window !== "undefined") {
            window.addEventListener("resize", handleWindowResize);
          }
        } else {
          disposeTerminal();
        }
      },
      { immediate: true }
    );

    onBeforeUnmount(() => {
      if (typeof window !== "undefined") {
        window.removeEventListener("resize", handleWindowResize);
      }
      disposeTerminal();
    });

    return {
      t,
      terminalContainer,
      exitInfo,
    };
  },
};
</script>

<style scoped>
.terminal-overlay {
  width: 100%;
  height: 100%;
  background-color: var(--bg-card);
  border: 1px solid var(--border-primary);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-height: 320px;
}

.terminal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--spacing-md) var(--spacing-lg);
  border-bottom: 1px solid var(--border-primary);
  gap: var(--spacing-md);
  background: rgba(15, 23, 42, 0.4);
}

.terminal-meta {
  flex: 1;
  min-width: 0;
}

.terminal-title {
  font-size: var(--text-base);
  font-weight: var(--font-semibold);
  color: var(--text-primary);
  margin: 0;
}

.terminal-path {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--text-secondary);
  font-family: "JetBrains Mono", "Courier New", monospace;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.terminal-body {
  flex: 1;
  background-color: #0f172a;
  min-height: 200px;
  position: relative;
}

.terminal-instance {
  width: 100%;
  height: 100%;
}

.terminal-loading {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--spacing-sm);
  color: var(--text-secondary);
  font-size: var(--text-sm);
}

.spinner {
  width: 32px;
  height: 32px;
  border: 3px solid rgba(148, 163, 184, 0.3);
  border-top-color: var(--primary-color);
  border-radius: 50%;
  animation: spin 0.9s linear infinite;
}

.terminal-exit {
  padding: var(--spacing-sm) var(--spacing-lg);
  border-top: 1px solid var(--border-primary);
  font-size: var(--text-xs);
  color: var(--text-secondary);
  background-color: rgba(15, 23, 42, 0.6);
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 640px) {
  .terminal-overlay {
    min-height: 260px;
  }
}
</style>

