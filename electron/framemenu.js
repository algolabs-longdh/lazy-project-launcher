const { Menu, dialog, ipcMain, Tray, nativeImage } = require("electron");
const path = require("path");
const fs = require("fs");

class FrameMenu {
  constructor(mainWindow) {
    this.mainWindow = mainWindow;
    this.currentTheme = this.loadTheme(); // load saved theme or default to 'system'
    this.currentLocale = this.loadLocale(); // load saved locale or default to 'en'
    this.tray = null;

    const closeBehavior = this.loadCloseBehavior();
    this.closeToTray = closeBehavior.closeToTray; // Default behavior comes from saved preference
    this.hasShownClosePrompt = closeBehavior.promptShown;
    this.forceCloseRequested = false; // Used to bypass prompt when user already confirmed exit
  }

  createMenu() {
    console.log("Creating menu...");

    // Send current theme and locale to renderer process on menu creation
    if (this.mainWindow && this.mainWindow.webContents) {
      this.mainWindow.webContents.send("theme-changed", {
        theme: this.currentTheme,
      });
      this.mainWindow.webContents.send("locale-changed", {
        locale: this.currentLocale,
      });
    }

    // Apply window frame theme on startup
    this.updateWindowFrameTheme(this.currentTheme);

    // Get localized menu labels
    const menuLabels = this.getMenuLabels();

    const template = [
      {
        label: menuLabels.file,
        submenu: [
          {
            label: menuLabels.import_project,
            accelerator: "CmdOrCtrl+I",
            click: () => {
              this.importProject();
            },
          },
          { type: "separator" },
          {
            label: menuLabels.exit,
            accelerator: process.platform === "darwin" ? "Cmd+Q" : "Ctrl+Q",
            click: () => {
              if (this.mainWindow) {
                this.mainWindow.close();
              }
            },
          },
        ],
      },
      {
        label: menuLabels.window,
        submenu: [
          {
            label: menuLabels.minimize,
            accelerator: "CmdOrCtrl+M",
            click: () => {
              if (this.mainWindow) {
                this.mainWindow.minimize();
              }
            },
          },
          {
            label: menuLabels.maximize,
            accelerator: "F11",
            enabled: false,
            click: () => {
              if (this.mainWindow) {
                if (this.mainWindow.isMaximized()) {
                  this.mainWindow.unmaximize();
                } else {
                  this.mainWindow.maximize();
                }
              }
            },
          },
          {
            label: menuLabels.close_as,
            submenu: [
              {
                label: menuLabels.exit_application,
                type: "radio",
                checked: !this.closeToTray,
                accelerator: "CmdOrCtrl+Q",
                click: () => {
                  this.closeToTray = false;
                  this.hasShownClosePrompt = true;
                  this.saveCloseBehavior({
                    closeToTray: this.closeToTray,
                    promptShown: this.hasShownClosePrompt,
                  });
                  if (this.mainWindow) {
                    this.mainWindow.close();
                  }
                },
              },
              {
                label: menuLabels.minimize_to_tray,
                type: "radio",
                checked: this.closeToTray,
                accelerator: "CmdOrCtrl+W",
                click: () => {
                  this.closeToTray = true;
                  this.hasShownClosePrompt = true;
                  this.saveCloseBehavior({
                    closeToTray: this.closeToTray,
                    promptShown: this.hasShownClosePrompt,
                  });
                  this.minimizeToTray();
                },
              },
            ],
          },
        ],
      },
      {
        label: menuLabels.theme,
        submenu: [
          {
            label: menuLabels.system_default,
            type: "radio",
            checked: this.currentTheme === "system",
            click: () => {
              this.setTheme("system");
            },
          },
          {
            label: menuLabels.light,
            type: "radio",
            checked: this.currentTheme === "light",
            click: () => {
              this.setTheme("light");
            },
          },
          {
            label: menuLabels.dark,
            type: "radio",
            checked: this.currentTheme === "dark",
            click: () => {
              this.setTheme("dark");
            },
          },
        ],
      },
      {
        label: menuLabels.language,
        submenu: [
          {
            label: menuLabels.english,
            type: "radio",
            checked: this.currentLocale === "en",
            click: () => {
              this.setLocale("en");
            },
          },
        ],
      },
      {
        label: menuLabels.help,
        submenu: [
          {
            label: menuLabels.about,
            click: () => {
              this.showAboutDialog();
            },
          },
          {
            label: menuLabels.developer_tools,
            accelerator: "F12",
            click: () => {
              if (this.mainWindow) {
                this.mainWindow.webContents.toggleDevTools();
              }
            },
          },
        ],
      },
    ];

    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);
    console.log("Menu created successfully");
  }

  async importProject() {
    try {
      const menuLabels = this.getMenuLabels();

      // Get localized content from JSON files
      let content = {
        title: "Select Project Folder",
        buttonLabel: "Import Project",
      };
      try {
        const localeFile = path.join(
          __dirname,
          "../src/locale",
          `${this.currentLocale}.json`
        );
        if (fs.existsSync(localeFile)) {
          const localeData = JSON.parse(fs.readFileSync(localeFile, "utf8"));
          content = {
            title:
              localeData.messages?.select_project_folder ||
              "Select Project Folder",
            buttonLabel: localeData.menu.import_project,
          };
        }
      } catch (error) {
        console.error("Error loading locale for import dialog:", error);
      }

      const result = await dialog.showOpenDialog(this.mainWindow, {
        title: content.title,
        properties: ["openDirectory"],
        buttonLabel: content.buttonLabel,
      });

      if (!result.canceled && result.filePaths.length > 0) {
        const projectPath = result.filePaths[0];
        const projectName = path.basename(projectPath);

        // send project information to renderer process
        this.mainWindow.webContents.send("project-imported", {
          name: projectName,
          path: projectPath,
          id: Date.now().toString(),
        });
      }
    } catch (error) {
      console.error("Error importing project:", error);
    }
  }

  updateMainWindow(mainWindow) {
    this.mainWindow = mainWindow;
  }

  getLocaleFilePaths(locale) {
    return [
      path.join(__dirname, "../src/locale", `${locale}.json`), // Development
      path.join(__dirname, "../dist/src/locale", `${locale}.json`), // Build
      path.join(__dirname, "../locale", `${locale}.json`), // Alternative build path
      path.join(process.cwd(), "src/locale", `${locale}.json`), // From project root
      path.join(process.cwd(), "dist/src/locale", `${locale}.json`), // From project root dist
    ];
  }

  loadLocaleFile(locale) {
    const candidates = this.getLocaleFilePaths(locale);
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        try {
          return JSON.parse(fs.readFileSync(candidate, "utf8"));
        } catch (error) {
          console.error("Error parsing locale file:", candidate, error);
        }
      }
    }
    return null;
  }

  // Get localized menu labels from JSON files
  getMenuLabels() {
    try {
      const localeData =
        this.loadLocaleFile(this.currentLocale) || this.loadLocaleFile("en");

      if (localeData?.menu) {
        return {
          file: localeData.menu.file,
          import_project: localeData.menu.import_project,
          exit: localeData.menu.exit,
          window: localeData.menu.window,
          minimize: localeData.menu.minimize,
          maximize: localeData.menu.maximize,
          close: localeData.menu.close,
          close_as: localeData.menu.close_as,
          exit_application: localeData.menu.exit_application,
          minimize_to_tray: localeData.menu.minimize_to_tray,
          theme: localeData.menu.theme,
          system_default: localeData.menu.system_default,
          light: localeData.menu.light,
          dark: localeData.menu.dark,
          language: localeData.menu.language,
          english: "English",
          simplified_chinese: "简体中文",
          traditional_chinese: "繁體中文",
          help: localeData.menu.help,
          about: localeData.menu.about,
          developer_tools: localeData.menu.developer_tools,
        };
      }
    } catch (error) {
      console.error("Error loading locale file:", error);
    }

    // Hard fallback
    return {
      file: "File",
      import_project: "Import Project",
      exit: "Exit",
      window: "Window",
      minimize: "Minimize",
      maximize: "Maximize",
      close: "Close",
      close_as: "Close as",
      exit_application: "Exit Application",
      minimize_to_tray: "Minimize to Tray",
      theme: "Theme",
      system_default: "System Default",
      light: "Light",
      dark: "Dark",
      language: "Language",
      english: "English",
      simplified_chinese: "简体中文",
      traditional_chinese: "繁體中文",
      help: "Help",
      about: "About",
      developer_tools: "Developer Tools",
    };
  }

  getClosePromptContent() {
    const defaults = {
      title: "Close Lazy Project Launcher?",
      message:
        "Would you like to exit completely or keep the app running in the system tray?",
      exitLabel: "Exit Application",
      trayLabel: "Minimize to Tray",
    };

    const localeData =
      this.loadLocaleFile(this.currentLocale) || this.loadLocaleFile("en");

    if (!localeData) {
      return defaults;
    }

    return {
      title: localeData.messages?.close_prompt_title || defaults.title,
      message: localeData.messages?.close_prompt_message || defaults.message,
      exitLabel:
        localeData.messages?.close_prompt_exit ||
        localeData.menu?.exit_application ||
        defaults.exitLabel,
      trayLabel:
        localeData.messages?.close_prompt_tray ||
        localeData.menu?.minimize_to_tray ||
        defaults.trayLabel,
    };
  }

  // Locale management methods
  loadLocale() {
    try {
      const userDataPath = require("os").homedir();
      const configPath = path.join(
        userDataPath,
        ".lazy-project-launcher",
        "locale.json"
      );

      if (fs.existsSync(configPath)) {
        const data = fs.readFileSync(configPath, "utf8");
        const config = JSON.parse(data);
        return config.locale || "en";
      }
    } catch (error) {
      console.error("Error loading locale config:", error);
    }
    return "en"; // default to English
  }

  saveLocale(locale) {
    try {
      const userDataPath = require("os").homedir();
      const configDir = path.join(userDataPath, ".lazy-project-launcher");
      const configPath = path.join(configDir, "locale.json");

      // create config directory if it doesn't exist
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }

      const config = { locale };
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    } catch (error) {
      console.error("Error saving locale config:", error);
    }
  }

  setLocale(locale) {
    this.currentLocale = locale;
    this.saveLocale(locale);

    // send locale change to renderer process
    if (this.mainWindow && this.mainWindow.webContents) {
      this.mainWindow.webContents.send("locale-changed", { locale });
    }

    // recreate menu to update radio button states
    this.createMenu();

    console.log("Locale changed to:", locale);
  }

  // Close behavior management
  loadCloseBehavior() {
    try {
      const userDataPath = require("os").homedir();
      const configPath = path.join(
        userDataPath,
        ".lazy-project-launcher",
        "close-behavior.json"
      );

      if (fs.existsSync(configPath)) {
        const data = JSON.parse(fs.readFileSync(configPath, "utf8"));
        return {
          closeToTray: Boolean(data.closeToTray),
          promptShown:
            typeof data.promptShown === "boolean" ? data.promptShown : true,
        };
      }
    } catch (error) {
      console.error("Error loading close behavior config:", error);
    }

    return {
      closeToTray: false,
      promptShown: false,
    };
  }

  saveCloseBehavior(preferences = {}) {
    try {
      const userDataPath = require("os").homedir();
      const configDir = path.join(userDataPath, ".lazy-project-launcher");
      const configPath = path.join(configDir, "close-behavior.json");

      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }

      const payload = {
        closeToTray:
          typeof preferences.closeToTray === "boolean"
            ? preferences.closeToTray
            : this.closeToTray,
        promptShown:
          typeof preferences.promptShown === "boolean"
            ? preferences.promptShown
            : this.hasShownClosePrompt,
      };

      fs.writeFileSync(configPath, JSON.stringify(payload, null, 2));
    } catch (error) {
      console.error("Error saving close behavior config:", error);
    }
  }

  // Theme management methods
  loadTheme() {
    try {
      const userDataPath = require("os").homedir();
      const configPath = path.join(
        userDataPath,
        ".lazy-project-launcher",
        "theme.json"
      );

      if (fs.existsSync(configPath)) {
        const data = fs.readFileSync(configPath, "utf8");
        const config = JSON.parse(data);
        return config.theme || "system";
      }
    } catch (error) {
      console.error("Error loading theme config:", error);
    }
    return "system"; // default to system theme
  }

  saveTheme(theme) {
    try {
      const userDataPath = require("os").homedir();
      const configDir = path.join(userDataPath, ".lazy-project-launcher");
      const configPath = path.join(configDir, "theme.json");

      // create config directory if it doesn't exist
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }

      const config = { theme };
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    } catch (error) {
      console.error("Error saving theme config:", error);
    }
  }

  setTheme(theme) {
    this.currentTheme = theme;
    this.saveTheme(theme);

    // send theme change to renderer process
    if (this.mainWindow && this.mainWindow.webContents) {
      this.mainWindow.webContents.send("theme-changed", { theme });
    }

    // update window frame theme
    this.updateWindowFrameTheme(theme);

    // recreate menu to update radio button states
    this.createMenu();

    console.log("Theme changed to:", theme);
  }

  /**
   * Update window frame theme based on selected theme
   * @param {string} theme - Theme to apply
   */
  updateWindowFrameTheme(theme) {
    if (!this.mainWindow) return;

    try {
      // Set window background color based on theme
      let backgroundColor;
      if (theme === "dark") {
        backgroundColor = "#1e293b"; // dark slate
      } else if (theme === "light") {
        backgroundColor = "#ffffff"; // white
      } else {
        // system theme - check system preference
        const { systemPreferences } = require("electron");
        if (process.platform === "darwin") {
          const isDarkMode = systemPreferences.isDarkMode();
          backgroundColor = isDarkMode ? "#1e293b" : "#ffffff";
        } else {
          // For Windows/Linux, default to light
          backgroundColor = "#ffffff";
        }
      }

      // Update window background
      this.mainWindow.setBackgroundColor(backgroundColor);

      // Windows specific: Try to set dark title bar
      if (process.platform === "win32") {
        try {
          const { nativeTheme } = require("electron");
          if (theme === "dark") {
            nativeTheme.themeSource = "dark";
            // Also try to set the window to use dark title bar
            this.mainWindow.setTitleBarStyle("hiddenInset");
          } else if (theme === "light") {
            nativeTheme.themeSource = "light";
            this.mainWindow.setTitleBarStyle("default");
          } else {
            nativeTheme.themeSource = "system";
            this.mainWindow.setTitleBarStyle("default");
          }
        } catch (error) {
          console.log("Could not set native theme:", error.message);
        }
      }

      console.log("Window frame theme updated:", theme, backgroundColor);
    } catch (error) {
      console.error("Error updating window frame theme:", error);
    }
  }

  /**
   * Show About dialog with app information
   */
  showAboutDialog() {
    try {
      const { app } = require("electron");
      const packageInfo = require("../package.json");
      const menuLabels = this.getMenuLabels();

      // Get localized content from JSON files
      let content = {
        title: "About Lazy Project Launcher",
        buttons: ["OK"],
        version: "Version",
        author: "Author",
      };
      try {
        const localeFile = path.join(
          __dirname,
          "../src/locale",
          `${this.currentLocale}.json`
        );
        if (fs.existsSync(localeFile)) {
          const localeData = JSON.parse(fs.readFileSync(localeFile, "utf8"));
          content = {
            title: `${localeData.menu.about} Lazy Project Launcher`,
            buttons: [],
            version: localeData.messages?.version || "Version",
            author: localeData.messages?.author || "Author",
          };
        }
      } catch (error) {
        console.error("Error loading locale for about dialog:", error);
      }

      const aboutOptions = {
        type: "info",
        title: content.title,
        message: "Lazy Project Launcher",
        detail: `${content.version}: ${packageInfo.version}\n${content.author}: ${packageInfo.author}\n\n${packageInfo.description}`,
        buttons: content.buttons,
        defaultId: 1,
        cancelId: 1,
      };

      dialog.showMessageBox(this.mainWindow, aboutOptions).then((result) => {
        if (result.response === 0) {
          // User clicked GitHub button
          const { shell } = require("electron");
          shell.openExternal(
            "https://github.com/yeongpin/lazy-project-launcher"
          );
        }
      });
    } catch (error) {
      console.error("Error showing about dialog:", error);
    }
  }

  async handleCloseRequest(event) {
    if (!this.mainWindow) {
      return false;
    }

    if (this.forceCloseRequested) {
      this.forceCloseRequested = false;
      return false;
    }

    if (!this.hasShownClosePrompt) {
      event.preventDefault();
      await this.showCloseBehaviorPrompt();
      return true;
    }

    if (this.closeToTray) {
      event.preventDefault();
      this.minimizeToTray();
      return true;
    }

    return false;
  }

  async showCloseBehaviorPrompt() {
    if (!this.mainWindow) {
      return;
    }

    try {
      const content = this.getClosePromptContent();
      const result = await dialog.showMessageBox(this.mainWindow, {
        type: "question",
        title: content.title,
        message: content.title,
        detail: content.message,
        buttons: [content.trayLabel, content.exitLabel],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      });

      const minimizeSelected = result.response === 0;
      this.hasShownClosePrompt = true;
      this.closeToTray = minimizeSelected;
      this.saveCloseBehavior({
        closeToTray: this.closeToTray,
        promptShown: this.hasShownClosePrompt,
      });

      if (minimizeSelected) {
        this.minimizeToTray();
        return;
      }

      this.forceCloseRequested = true;
      this.mainWindow.close();
    } catch (error) {
      console.error("Failed to show close preference prompt:", error);
      this.forceCloseRequested = true;
      this.mainWindow.close();
    }
  }

  // Tray functionality
  createTray() {
    if (this.tray) return;

    try {
      // Create tray icon
      const iconPath = path.join(__dirname, "../icon.png");
      let trayIcon = nativeImage.createFromPath(iconPath);

      // Resize icon for tray (16x16 for Windows/Linux)
      if (process.platform !== "darwin") {
        trayIcon = trayIcon.resize({ width: 16, height: 16 });
      }

      this.tray = new Tray(trayIcon);

      // Set tooltip
      this.tray.setToolTip("Lazy Project Launcher");

      // Create tray context menu
      const contextMenu = Menu.buildFromTemplate([
        {
          label: "Show",
          click: () => {
            this.showWindow();
          },
        },
        {
          label: "Hide",
          click: () => {
            if (this.mainWindow) {
              this.mainWindow.hide();
            }
          },
        },
        { type: "separator" },
        {
          label: "Exit",
          click: () => {
            this.closeToTray = false;
            if (this.mainWindow) {
              this.mainWindow.close();
            }
          },
        },
      ]);

      this.tray.setContextMenu(contextMenu);

      // Double-click to show/hide window
      this.tray.on("double-click", () => {
        this.showWindow();
      });

      console.log("Tray created successfully");
    } catch (error) {
      console.error("Failed to create tray:", error);
    }
  }

  minimizeToTray() {
    if (!this.tray) {
      this.createTray();
    }

    if (this.mainWindow) {
      this.mainWindow.hide();
    }
  }

  showWindow() {
    if (this.mainWindow) {
      this.mainWindow.show();
      this.mainWindow.focus();
    }
  }

  destroyTray() {
    if (this.tray) {
      this.tray.destroy();
      this.tray = null;
    }
  }

  // static method, used to trigger import project from outside
  static async triggerImportProject(mainWindow) {
    const frameMenu = new FrameMenu(mainWindow);
    await frameMenu.importProject();
  }
}

module.exports = FrameMenu;
