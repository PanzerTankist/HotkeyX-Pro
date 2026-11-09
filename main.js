
const {
  app,
  BrowserWindow,
  ipcMain,
  globalShortcut,
  dialog,
  Tray,
  Menu,
  nativeImage
} = require("electron");

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

// Windows taskbar application identity.
if (process.platform === "win32") {
  app.setAppUserModelId("com.hotkeyx.pro");
}

const APP_ICON = path.join(__dirname, "assets", "hotkeyx-256.png");

let mainWindow = null;
let tray = null;
let shortcuts = [];
let isQuitting = false;

function getAppIcon() {
  if (fs.existsSync(APP_ICON)) {
    const icon = nativeImage.createFromPath(APP_ICON);
    if (!icon.isEmpty()) return icon;
  }

  console.warn("HotkeyX Pro icon not found:", APP_ICON);
  return nativeImage.createEmpty();
}

const hasLock = app.requestSingleInstanceLock();

if (!hasLock) {
  app.quit();
} else {
  app.on("second-instance", showWindow);

  app.whenReady().then(() => {
    shortcuts = loadSettings();
    createWindow();
    createTray();
    registerShortcuts();
  });
}

/* ---------- Settings ---------- */

function settingsPath() {
  return path.join(app.getPath("userData"), "shortcuts.json");
}

function loadSettings() {
  try {
    const data = JSON.parse(fs.readFileSync(settingsPath(), "utf8"));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function saveSettings() {
  try {
    fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
    fs.writeFileSync(
      settingsPath(),
      JSON.stringify(shortcuts, null, 2),
      "utf8"
    );
  } catch (error) {
    console.error("Failed to save settings:", error);
  }
}

function notifyRenderer() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("shortcuts-updated", shortcuts);
  }
}

/* ---------- Window ---------- */

function showWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }

  if (mainWindow.isMinimized()) mainWindow.restore();

  mainWindow.show();
  mainWindow.focus();
}

function createWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    showWindow();
    return;
  }

  mainWindow = new BrowserWindow({
    width: 1160,
    height: 760,
    minWidth: 820,
    minHeight: 560,
    title: "HotkeyX Pro",
    icon: getAppIcon(),
    backgroundColor: "#101820",
    frame: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, "index.html"));

  mainWindow.on("close", event => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  mainWindow.on("maximize", () => {
    mainWindow?.webContents.send("window-maximize-change", true);
  });

  mainWindow.on("unmaximize", () => {
    mainWindow?.webContents.send("window-maximize-change", false);
  });

  mainWindow.webContents.on("did-finish-load", () => {
    notifyRenderer();

    mainWindow?.webContents.send(
      "window-maximize-change",
      mainWindow.isMaximized()
    );
  });

  mainWindow.webContents.on(
    "did-fail-load",
    (_event, code, description) => {
      console.error("Failed to load index.html:", code, description);
    }
  );
}

/* ---------- System tray ---------- */

function createTray() {
  if (tray) return;

  const icon = getAppIcon();

  if (icon.isEmpty()) {
    console.error("Unable to create tray: application icon is missing.");
    return;
  }

  tray = new Tray(icon);
  tray.setToolTip("HotkeyX Pro — running in the background");

  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: "Open HotkeyX Pro",
        click: showWindow
      },
      { type: "separator" },
      {
        label: "Exit",
        click: () => {
          isQuitting = true;
          app.quit();
        }
      }
    ])
  );

  tray.on("click", showWindow);
  tray.on("double-click", showWindow);
}

/* ---------- Launch applications ---------- */

function launchProgram(item) {
  if (!item.path || !fs.existsSync(item.path)) {
    mainWindow?.webContents.send("launch-error", {
      message: `File not found: ${item.path || item.name}`
    });
    return;
  }

  try {
    const child = spawn(
      item.path,
      Array.isArray(item.args) ? item.args : [],
      {
        cwd: path.dirname(item.path),
        detached: true,
        stdio: "ignore",
        windowsHide: false
      }
    );

    child.on("error", error => {
      mainWindow?.webContents.send("launch-error", {
        message: `Failed to launch ${item.name}: ${error.message}`
      });
    });

    child.unref();
  } catch (error) {
    mainWindow?.webContents.send("launch-error", {
      message: error.message
    });
  }
}

/* ---------- Keyboard shortcuts ---------- */

function registerShortcuts() {
  globalShortcut.unregisterAll();

  const used = new Set();

  shortcuts = shortcuts.map(item => {
    const accelerator = String(item.accelerator || "").trim();
    let status = "invalid";

    if (accelerator && !used.has(accelerator.toLowerCase())) {
      try {
        if (globalShortcut.register(accelerator, () => launchProgram(item))) {
          status = "active";
          used.add(accelerator.toLowerCase());
        } else {
          status = "conflict";
        }
      } catch {
        status = "conflict";
      }
    } else if (accelerator) {
      status = "conflict";
    }

    return { ...item, status };
  });

  notifyRenderer();
}

/* ---------- Application scanning filters ---------- */

const ignoredDirectories = new Set([
  "node_modules",
  ".git",
  ".svn",
  "temp",
  "tmp",
  "cache",
  "logs",
  "locales",
  "resources",
  "redist",
  "drivers",
  "diagnostics",
  "support",
  "uninstall",
  "updates",
  "crashreports",
  "crashdumps",
  "documentation",
  "docs"
]);

const ignoredFiles = [
  /^unins.*\.exe$/i,
  /^uninstall.*\.exe$/i,
  /^installer.*\.exe$/i,
  /^install.*\.exe$/i,
  /^setup.*\.exe$/i,
  /^update(r)?[-_.].*\.exe$/i,
  /^crashpad.*\.exe$/i,
  /^crashreport.*\.exe$/i,
  /^reportcrash.*\.exe$/i,
  /^vc_redist.*\.exe$/i,
  /^vcredist.*\.exe$/i,
  /^dxsetup.*\.exe$/i,
  /^maintenancetool\.exe$/i,
  /^repair\.exe$/i,
  /^webview2setup\.exe$/i,
  /^helper.*\.exe$/i,
  /^elevate\.exe$/i
];

function isIgnoredFile(name) {
  return (
    name.startsWith(".") ||
    ignoredFiles.some(pattern => pattern.test(name))
  );
}

async function scanPrograms(folder) {
  const results = [];
  const seenPaths = new Set();
  const seenNames = new Set();

  const maxDepth = 5;
  const maxResults = 300;

  async function walk(currentFolder, depth) {
    if (depth > maxDepth || results.length >= maxResults) return;

    let entries;

    try {
      entries = await fs.promises.readdir(currentFolder, {
        withFileTypes: true
      });
    } catch {
      return;
    }

    entries.sort((a, b) =>
      a.name.localeCompare(b.name, undefined, {
        sensitivity: "base"
      })
    );

    for (const entry of entries) {
      if (results.length >= maxResults) break;

      const fullPath = path.join(currentFolder, entry.name);

      if (entry.isSymbolicLink()) continue;

      if (entry.isDirectory()) {
        if (
          entry.name.startsWith(".") ||
          ignoredDirectories.has(entry.name.toLowerCase())
        ) {
          continue;
        }

        await walk(fullPath, depth + 1);
        continue;
      }

      if (!entry.isFile() || isIgnoredFile(entry.name)) continue;

      const extension = path.extname(entry.name).toLowerCase();

      if (process.platform === "win32" && extension !== ".exe") {
        continue;
      }

      if (
        process.platform === "linux" &&
        ![".appimage", ".bin", ""].includes(extension)
      ) {
        continue;
      }

      if (process.platform === "darwin") continue;

      const normalizedPath = path.resolve(fullPath).toLowerCase();
      const normalizedName = path
        .basename(entry.name, extension)
        .trim()
        .toLowerCase();

      if (!normalizedName || seenPaths.has(normalizedPath)) continue;
      if (seenNames.has(normalizedName)) continue;

      try {
        const stat = await fs.promises.stat(fullPath);
        if (!stat.isFile() || stat.size === 0) continue;
      } catch {
        continue;
      }

      seenPaths.add(normalizedPath);
      seenNames.add(normalizedName);

      results.push({
        name: path.basename(entry.name, extension),
        path: fullPath
      });
    }
  }

  await walk(folder, 0);
  return results;
}

/* ---------- Automatic Affinity detection ---------- */

async function findAffinityPackage() {
  const script = `
    $ErrorActionPreference = 'SilentlyContinue'

    $package = Get-AppxPackage Canva.Affinity

    if ($package) {
      $appFolder = Join-Path $package.InstallLocation 'App'

      if (Test-Path -LiteralPath $appFolder) {
        $exe = Get-ChildItem -LiteralPath $appFolder -Filter '*.exe' -File -Recurse -ErrorAction SilentlyContinue |
          Where-Object {
            $_.Name -match '^Affinity.*\\.exe$'
          } |
          Select-Object -First 1 -ExpandProperty FullName

        if ($exe) {
          $exe
        }
      }
    }
  `;

  return new Promise(resolve => {
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-Command", script],
      { windowsHide: true }
    );

    let stdout = "";

    child.stdout.on("data", data => {
      stdout += data.toString();
    });

    child.on("error", error => {
      console.error("Failed to start PowerShell:", error.message);
      resolve("");
    });

    child.on("close", () => {
      resolve(stdout.trim());
    });
  });
}

/* ---------- Application catalog ---------- */

ipcMain.handle("get-program-catalog", async () => {
  const localAppData = process.env.LOCALAPPDATA || "";
  const userProfile = process.env.USERPROFILE || "";

  const folders = [
    process.env.ProgramFiles || "C:\\Program Files",
    process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)",
    localAppData
      ? path.join(localAppData, "Programs")
      : "",
    path.join(userProfile, "Desktop"),
    path.join(userProfile, "OneDrive", "Desktop"),
    path.join(process.env.PUBLIC || "C:\\Users\\Public", "Desktop"),
    localAppData
      ? path.join(localAppData, "Microsoft", "WindowsApps")
      : ""
  ].filter(Boolean);

  const results = [];
  const seenPaths = new Set();

  function addProgram(name, filePath) {
    if (!filePath || !/\.exe$/i.test(filePath)) return;
    if (!fs.existsSync(filePath)) return;

    const key = path.resolve(filePath).toLowerCase();

    if (seenPaths.has(key)) return;

    seenPaths.add(key);

    results.push({
      name: name || path.basename(filePath, ".exe"),
      path: filePath
    });
  }

  // Scan standard application folders.
  for (const folder of folders) {
    if (!fs.existsSync(folder)) continue;

    const programs = await scanPrograms(folder);

    for (const program of programs) {
      addProgram(program.name, program.path);
    }
  }

  // Find the actual Affinity executable inside the App folder.
  if (process.platform === "win32") {
    try {
      const affinityPath = await findAffinityPackage();

      console.log("Affinity executable path:", affinityPath || "not found");

      if (affinityPath && fs.existsSync(affinityPath)) {
        addProgram("Affinity", affinityPath);
      }
    } catch (error) {
      console.error("Error searching for Affinity:", error);
    }
  }

  // Read shortcuts from the Desktop and Start Menu.
  const shortcutFolders = [
    path.join(userProfile, "Desktop"),
    path.join(userProfile, "OneDrive", "Desktop"),
    path.join(process.env.PUBLIC || "C:\\Users\\Public", "Desktop"),
    path.join(
      process.env.APPDATA || "",
      "Microsoft",
      "Windows",
      "Start Menu",
      "Programs"
    ),
    path.join(
      process.env.ProgramData || "",
      "Microsoft",
      "Windows",
      "Start Menu",
      "Programs"
    )
  ].filter(Boolean);

  for (const folder of shortcutFolders) {
    if (!fs.existsSync(folder)) continue;

    const escapedFolder = folder.replace(/'/g, "''");

    const script = `
      $ErrorActionPreference = 'SilentlyContinue'
      $shell = New-Object -ComObject WScript.Shell

      Get-ChildItem -LiteralPath '${escapedFolder}' -Filter '*.lnk' -Recurse -File |
      ForEach-Object {
        $s = $shell.CreateShortcut($_.FullName)

        [PSCustomObject]@{
          name = $_.BaseName
          path = $s.TargetPath
          args = $s.Arguments
        } | ConvertTo-Json -Compress
      }
    `;

    const output = await new Promise(resolve => {
      const child = spawn(
        "powershell.exe",
        ["-NoProfile", "-Command", script],
        { windowsHide: true }
      );

      let stdout = "";

      child.stdout.on("data", data => {
        stdout += data.toString();
      });

      child.on("close", () => resolve(stdout));
      child.on("error", () => resolve(""));
    });

    for (const line of output.split(/\r?\n/)) {
      try {
        const item = JSON.parse(line);

        if (item && item.path) {
          addProgram(item.name, item.path);
        }
      } catch {
        // Ignore malformed output lines.
      }
    }
  }

  return results.sort((a, b) =>
    a.name.localeCompare(b.name, "en")
  );
});

/* ---------- Choose a folder to scan ---------- */

ipcMain.handle("scan-program-folder", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Choose a folder containing applications",
    properties: ["openDirectory"]
  });

  if (result.canceled || !result.filePaths[0]) {
    return {
      canceled: true,
      folder: "",
      programs: []
    };
  }

  const folder = result.filePaths[0];

  return {
    canceled: false,
    folder,
    programs: await scanPrograms(folder)
  };
});

/* ---------- Manually select an application ---------- */

ipcMain.handle("pick-program", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Choose an application",
    properties: ["openFile"],
    filters: process.platform === "win32"
      ? [
          { name: "Applications", extensions: ["exe"] },
          { name: "All files", extensions: ["*"] }
        ]
      : [{ name: "All files", extensions: ["*"] }]
  });

  if (result.canceled || !result.filePaths[0]) return null;

  const filePath = result.filePaths[0];

  return {
    name: path.basename(filePath, path.extname(filePath)),
    path: filePath
  };
});

/* ---------- Save keyboard shortcuts ---------- */

ipcMain.handle("get-shortcuts", () => shortcuts);

ipcMain.handle("save-shortcuts", (_event, data) => {
  if (!Array.isArray(data) || data.length > 200) {
    return {
      ok: false,
      error: "Invalid application list."
    };
  }

  const cleanItems = [];
  const seenPaths = new Set();

  for (const item of data) {
    if (
      !item ||
      typeof item.name !== "string" ||
      typeof item.path !== "string" ||
      typeof item.accelerator !== "string" ||
      item.name.length > 120 ||
      item.path.length > 2048 ||
      item.accelerator.length > 80
    ) {
      return {
        ok: false,
        error: "Invalid application data."
      };
    }

    const normalizedPath = path.resolve(item.path).toLowerCase();

    if (seenPaths.has(normalizedPath)) continue;
    seenPaths.add(normalizedPath);

    cleanItems.push({
      name: item.name.trim(),
      path: item.path,
      accelerator: item.accelerator.trim(),
      args: Array.isArray(item.args) ? item.args : []
    });
  }

  shortcuts = cleanItems;
  registerShortcuts();
  saveSettings();

  return {
    ok: true,
    items: shortcuts
  };
});

/* ---------- Window controls ---------- */

ipcMain.on("window-minimize", event => {
  BrowserWindow.fromWebContents(event.sender)?.minimize();
});

ipcMain.on("window-close", event => {
  BrowserWindow.fromWebContents(event.sender)?.hide();
});

ipcMain.on("window-toggle-maximize", event => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;

  win.isMaximized() ? win.unmaximize() : win.maximize();
});

/* ---------- Application shutdown ---------- */

app.on("activate", showWindow);

app.on("before-quit", () => {
  isQuitting = true;
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();

  if (tray) {
    tray.destroy();
    tray = null;
  }
});
