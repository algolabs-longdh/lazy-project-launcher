const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const { randomUUID } = require("crypto");
const pty = require("node-pty");
const FrameMenu = require("./framemenu");
const WindowManager = require("./windowmanager");

const isDev = process.env.NODE_ENV === "development";

// disable GPU hardware acceleration to solve GPU process crash problem
app.disableHardwareAcceleration();

let mainWindow;
let frameMenu;
let windowManager;
let runningProjects = new Map(); // store running project processes
let terminalSessions = new Map(); // store interactive terminal sessions

function getShellConfig() {
  if (process.platform === "win32") {
    const powershell = process.env.POWERSHELL || "powershell.exe";
    return {
      command: powershell,
      args: ["-NoLogo"],
    };
  }

  if (process.platform === "darwin") {
    return {
      command: process.env.SHELL || "/bin/zsh",
      args: ["-l"],
    };
  }

  return {
    command: process.env.SHELL || "/bin/bash",
    args: ["-l"],
  };
}

function disposeTerminalSession(sessionId, requesterId) {
  if (!terminalSessions.has(sessionId)) {
    return false;
  }

  const session = terminalSessions.get(sessionId);
  if (requesterId && session.windowId !== requesterId) {
    return false;
  }

  try {
    session.pty.kill();
  } catch (error) {
    console.error("Failed to kill terminal session", sessionId, error);
  }

  terminalSessions.delete(sessionId);
  return true;
}

function cleanupTerminalsForWebContents(webContentsId) {
  for (const [sessionId, session] of terminalSessions.entries()) {
    if (session.windowId === webContentsId) {
      disposeTerminalSession(sessionId);
    }
  }
}

// set IPC handlers
function setupIPC() {
  // handle import project request
  ipcMain.handle("send-message", async (event, message, data) => {
    if (message === "import-project") {
      try {
        // get current window
        const currentWindow = BrowserWindow.fromWebContents(event.sender);
        if (currentWindow) {
          await FrameMenu.triggerImportProject(currentWindow);
          return { success: true };
        } else {
          return { success: false, error: "No window found" };
        }
      } catch (error) {
        console.error("Error triggering import project:", error);
        return { success: false, error: error.message };
      }
    }

    if (message === "open-terminal") {
      try {
        const projectPath = data?.path || process.cwd();
        const cols = data?.cols || 80;
        const rows = data?.rows || 24;
        const sessionId = randomUUID();
        const webContents = event.sender;
        const shellConfig = getShellConfig();

        console.log("Opening embedded terminal:", sessionId, "in", projectPath);

        const ptyProcess = pty.spawn(shellConfig.command, shellConfig.args, {
          name: "xterm-color",
          cols,
          rows,
          cwd: projectPath,
          env: {
            ...process.env,
            TERM: "xterm-256color",
          },
          useConpty: process.platform === "win32",
        });

        terminalSessions.set(sessionId, {
          pty: ptyProcess,
          windowId: webContents.id,
          path: projectPath,
        });

        ptyProcess.onData((chunk) => {
          if (!webContents.isDestroyed()) {
            webContents.send("terminal-data", {
              sessionId,
              data: chunk,
            });
          }
        });

        ptyProcess.onExit((eventData) => {
          terminalSessions.delete(sessionId);
          if (!webContents.isDestroyed()) {
            webContents.send("terminal-exit", {
              sessionId,
              code: eventData?.exitCode ?? null,
              signal: eventData?.signal ?? null,
            });
          }
        });

        return { success: true, sessionId };
      } catch (error) {
        console.error("Error opening terminal:", error);
        return { success: false, error: error.message };
      }
    }

    if (message === "start-project") {
      try {
        const { spawn } = require("child_process");
        const { path: projectPath, commands, projectId } = data;

        console.log(
          "Starting project:",
          projectId,
          "in:",
          projectPath,
          "with commands:",
          commands
        );

        // if project is already running, stop it first
        if (runningProjects.has(projectId)) {
          const existingProcess = runningProjects.get(projectId);
          existingProcess.kill();
          runningProjects.delete(projectId);
        }

        // select execution method based on operating system
        let childProcess;
        if (process.platform === "win32") {
          // Windows: use cmd to execute command, show terminal window
          childProcess = spawn("cmd", ["/k", commands], {
            cwd: projectPath,
            shell: true,
            detached: true, // detach process, let terminal window exist independently
            stdio: "pipe",
            windowsHide: false, // show window
          });
        } else {
          // Unix-like: use shell to execute command
          childProcess = spawn("sh", ["-c", commands], {
            cwd: projectPath,
            detached: true, // detach process
            stdio: "pipe",
          });
        }

        // store process reference and related information
        runningProjects.set(projectId, {
          process: childProcess,
          path: projectPath,
          commands: commands,
          startTime: Date.now(),
        });

        // handle process output
        childProcess.stdout.on("data", (data) => {
          console.log(`Project ${projectId} stdout:`, data.toString());
        });

        childProcess.stderr.on("data", (data) => {
          console.error(`Project ${projectId} stderr:`, data.toString());
        });

        childProcess.on("close", (code) => {
          console.log(`Project ${projectId} process exited with code ${code}`);
          runningProjects.delete(projectId);
        });

        childProcess.on("error", (error) => {
          console.error(`Project ${projectId} process error:`, error);
          runningProjects.delete(projectId);
        });

        return { success: true, processId: childProcess.pid };
      } catch (error) {
        console.error("Error starting project:", error);
        return { success: false, error: error.message };
      }
    }

    if (message === "stop-project") {
      try {
        const { projectId } = data;

        console.log("Stopping project:", projectId);

        if (runningProjects.has(projectId)) {
          const projectInfo = runningProjects.get(projectId);
          const childProcess = projectInfo.process;

          // since the process is detached, the user can directly close the terminal window
          // here we just remove it from our tracking
          runningProjects.delete(projectId);
          console.log(
            "Project removed from tracking (user can close terminal window)"
          );
          return { success: true };
        } else {
          console.log("Project not running");
          return { success: true, message: "Project not running" };
        }
      } catch (error) {
        console.error("Error stopping project:", error);
        return { success: false, error: error.message };
      }
    }

    return { success: false, message: "Unknown message" };
  });
  ipcMain.on("terminal-write", (event, payload) => {
    if (!payload?.sessionId || typeof payload.data !== "string") {
      return;
    }

    const session = terminalSessions.get(payload.sessionId);
    if (session && session.windowId === event.sender.id) {
      session.pty.write(payload.data);
    }
  });

  ipcMain.on("terminal-resize", (event, payload) => {
    if (!payload?.sessionId) {
      return;
    }

    const session = terminalSessions.get(payload.sessionId);
    if (session && session.windowId === event.sender.id) {
      const cols = Math.max(10, Number(payload.cols) || 80);
      const rows = Math.max(5, Number(payload.rows) || 24);
      session.pty.resize(cols, rows);
    }
  });

  ipcMain.handle("terminal-close", (event, payload) => {
    const sessionId = payload?.sessionId;
    if (!sessionId) {
      return { success: false, error: "Missing sessionId" };
    }

    const removed = disposeTerminalSession(sessionId, event.sender.id);
    return removed
      ? { success: true }
      : { success: false, error: "Session not found" };
  });
}

function createWindow() {
  // initialize window manager
  windowManager = new WindowManager();
  windowManager.setupIPC();

  // Read version from package.json
  const packageInfo = require("../package.json");
  const appTitle = `Lazy Project Launcher v${packageInfo.version}`;

  // use WindowManager to create window
  const windowOptions = {
    title: appTitle,
    icon: path.join(__dirname, "../icon.png"),
    width: 1200,
    height: 800,
    minWidth: 1200,
    minHeight: 800,
    maxWidth: 1200,
    maxHeight: 800,
    resizable: false,
    // Enable dark theme for window frame
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    frame: true,
    backgroundColor: "#1e293b", // dark background for window frame
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
      // add additional GPU related settings
      webgl: false,
      offscreen: false,
    },
  };

  const { window } = windowManager.createWindow(windowOptions);
  mainWindow = window;

  // Explicitly set the window title after creation
  mainWindow.setTitle(appTitle);

  // Load the app
  if (isDev) {
    mainWindow.loadURL("http://localhost:12511");
    // open developer tools in a new window, detach mode
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    // in production environment, use absolute path to load file
    const indexPath = path.join(__dirname, "../dist/index.html");
    mainWindow.loadFile(indexPath);
  }

  // Ensure title is set after page load
  mainWindow.webContents.once("did-finish-load", () => {
    mainWindow.setTitle(appTitle);
  });

  // initialize menu and update main window reference
  console.log("Creating frame menu...");
  frameMenu = new FrameMenu(mainWindow);
  frameMenu.createMenu();
  console.log("Frame menu created");

  // Handle window close event
  mainWindow.on("close", async (event) => {
    if (!frameMenu) {
      return;
    }

    const shouldPreventClose = await frameMenu.handleCloseRequest(event);
    if (!shouldPreventClose) {
      // Clean up tray when actually closing
      frameMenu.destroyTray();
    }
  });

  mainWindow.webContents.on("destroyed", () => {
    cleanupTerminalsForWebContents(mainWindow.webContents.id);
  });
}

// This method will be called when Electron has finished initialization
app.whenReady().then(() => {
  // Set initial native theme
  const { nativeTheme } = require("electron");

  // Force dark theme for the entire app on Windows
  if (process.platform === "win32") {
    try {
      console.log("Setting Windows to dark theme...");
      nativeTheme.themeSource = "dark";
    } catch (error) {
      console.log("Could not set native theme to dark:", error.message);
    }
  } else {
    nativeTheme.themeSource = "system"; // Start with system theme for other platforms
  }

  setupIPC();
  createWindow();
});

// Quit when all windows are closed
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on("web-contents-created", (event, contents) => {
  contents.on("destroyed", () => {
    cleanupTerminalsForWebContents(contents.id);
  });
});
