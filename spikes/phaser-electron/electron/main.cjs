const { app, BrowserWindow, ipcMain, screen } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const isDev = process.argv.includes("--dev");
const isSmokeTest = process.argv.includes("--smoke-test");
const benchmarkArgument = process.argv.find((argument) =>
  argument.startsWith("--benchmark-seconds="),
);
const captureArgument = process.argv.find((argument) =>
  argument.startsWith("--capture-path="),
);
const benchmarkSeconds = Math.max(
  0,
  Number.parseInt(benchmarkArgument?.split("=")[1] ?? "0", 10) || 0,
);
const capturePath =
  captureArgument?.slice("--capture-path=".length) ||
  path.join(app.getPath("temp"), "airship-presence-spike.png");

let mainWindow = null;
let cursorPollTimer = null;
let metricsTimer = null;
let ignoredByMouse = null;
let activeDisplayId = null;

function getActiveDisplay() {
  if (activeDisplayId !== null) {
    const savedDisplay = screen
      .getAllDisplays()
      .find((display) => display.id === activeDisplayId);
    if (savedDisplay) {
      return savedDisplay;
    }
  }

  const cursorPoint = screen.getCursorScreenPoint();
  return screen.getDisplayNearestPoint(cursorPoint);
}

function applyDisplayWorkArea() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  const display = getActiveDisplay();
  activeDisplayId = display.id;
  mainWindow.setBounds(display.workArea, false);
  mainWindow.webContents.send("desktop:environment-changed", {
    displayId: display.id,
    workArea: display.workArea,
    scaleFactor: display.scaleFactor,
  });
}

function setInteractive(interactive, reason = "unknown") {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  const shouldIgnore = !interactive;
  if (benchmarkSeconds > 0 || isSmokeTest) {
    console.log(
      `PRESENCE_INPUT ${JSON.stringify({ interactive, reason })}`,
    );
  }
  if (ignoredByMouse === shouldIgnore) {
    return;
  }

  mainWindow.setIgnoreMouseEvents(shouldIgnore, {
    forward: shouldIgnore,
  });
  ignoredByMouse = shouldIgnore;
  mainWindow.webContents.send("desktop:passthrough-state", {
    interactive,
    reason,
  });
}

function startCursorPolling() {
  clearInterval(cursorPollTimer);
  cursorPollTimer = setInterval(() => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }

    const cursor = screen.getCursorScreenPoint();
    const bounds = mainWindow.getBounds();
    mainWindow.webContents.send("desktop:cursor-position", {
      x: cursor.x - bounds.x,
      y: cursor.y - bounds.y,
      inside:
        cursor.x >= bounds.x &&
        cursor.y >= bounds.y &&
        cursor.x < bounds.x + bounds.width &&
        cursor.y < bounds.y + bounds.height,
    });
  }, 33);
}

async function collectMetrics() {
  const processMetrics = app.getAppMetrics().map((metric) => ({
    pid: metric.pid,
    type: metric.type,
    cpuPercent: Number(metric.cpu.percentCPUUsage.toFixed(2)),
    workingSetKb: metric.memory.workingSetSize,
    peakWorkingSetKb: metric.memory.peakWorkingSetSize,
  }));
  const mainMemory = await process.getProcessMemoryInfo();
  return {
    timestamp: new Date().toISOString(),
    mainPrivateKb: mainMemory.private,
    mainResidentSetKb: mainMemory.residentSet,
    processes: processMetrics,
  };
}

function startMetricsSampling() {
  clearInterval(metricsTimer);
  metricsTimer = setInterval(async () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }
    const metrics = await collectMetrics();
    mainWindow.webContents.send("desktop:metrics", metrics);
    if (benchmarkSeconds > 0 || isSmokeTest) {
      console.log(`PRESENCE_METRICS ${JSON.stringify(metrics)}`);
    }
  }, 5000);
}

async function captureAndReport() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  const image = await mainWindow.webContents.capturePage();
  fs.mkdirSync(path.dirname(capturePath), { recursive: true });
  fs.writeFileSync(capturePath, image.toPNG());
  const metrics = await collectMetrics();
  console.log(
    `PRESENCE_SPIKE_OK ${JSON.stringify({
      capturePath,
      metrics,
      ignoredByMouse,
    })}`,
  );
}

function scheduleAutomatedRun() {
  if (!isSmokeTest && benchmarkSeconds <= 0) {
    return;
  }

  const durationSeconds = benchmarkSeconds > 0 ? benchmarkSeconds : 6;
  setTimeout(() => setInteractive(true, "smoke-interactive"), 1000);
  setTimeout(() => setInteractive(false, "smoke-passthrough"), 2000);
  setTimeout(async () => {
    try {
      await captureAndReport();
      app.exit(0);
    } catch (error) {
      console.error("PRESENCE_SPIKE_FAILED", error);
      app.exit(1);
    }
  }, durationSeconds * 1000);
}

function createWindow() {
  const display = getActiveDisplay();
  activeDisplayId = display.id;

  mainWindow = new BrowserWindow({
    ...display.workArea,
    title: "空艇餐厅 · 桌面陪伴技术验证",
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    alwaysOnTop: true,
    focusable: false,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    hasShadow: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });

  mainWindow.setAlwaysOnTop(true, "floating");
  setInteractive(false, "startup");

  if (isDev) {
    mainWindow.loadURL("http://127.0.0.1:5173");
  } else {
    mainWindow.loadFile(
      path.join(__dirname, "..", "dist", "renderer", "index.html"),
    );
  }

  mainWindow.once("ready-to-show", () => {
    mainWindow.showInactive();
  });
  mainWindow.webContents.once("did-finish-load", () => {
    applyDisplayWorkArea();
    startCursorPolling();
    startMetricsSampling();
    scheduleAutomatedRun();
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
    clearInterval(cursorPollTimer);
    clearInterval(metricsTimer);
  });
}

ipcMain.on("desktop:set-interactive", (event, payload) => {
  if (!mainWindow || event.sender !== mainWindow.webContents) {
    return;
  }
  setInteractive(Boolean(payload?.interactive), payload?.reason);
});

ipcMain.on("desktop:set-always-on-top", (event, enabled) => {
  if (!mainWindow || event.sender !== mainWindow.webContents) {
    return;
  }
  mainWindow.setAlwaysOnTop(Boolean(enabled), "floating");
});

ipcMain.on("desktop:report-test-points", (event, points) => {
  if (
    !mainWindow ||
    event.sender !== mainWindow.webContents ||
    (!isSmokeTest && benchmarkSeconds <= 0)
  ) {
    return;
  }

  const bounds = mainWindow.getBounds();
  const screenPoints = Object.fromEntries(
    Object.entries(points ?? {}).map(([key, point]) => {
      const dipPoint = {
        x: bounds.x + Number(point.x),
        y: bounds.y + Number(point.y),
      };
      return [
        key,
        {
          local: point,
          dip: dipPoint,
          physical: screen.dipToScreenPoint(dipPoint),
        },
      ];
    }),
  );
  console.log(`PRESENCE_TEST_POINTS ${JSON.stringify(screenPoints)}`);
});

ipcMain.on("desktop:quit", (event) => {
  if (mainWindow && event.sender === mainWindow.webContents) {
    app.quit();
  }
});

ipcMain.handle("desktop:get-environment", () => {
  const display = getActiveDisplay();
  return {
    platform: process.platform,
    electronVersion: process.versions.electron,
    chromiumVersion: process.versions.chrome,
    displayId: display.id,
    workArea: display.workArea,
    scaleFactor: display.scaleFactor,
  };
});

app.whenReady().then(() => {
  createWindow();
  screen.on("display-added", applyDisplayWorkArea);
  screen.on("display-removed", applyDisplayWorkArea);
  screen.on("display-metrics-changed", applyDisplayWorkArea);
});

app.on("window-all-closed", () => {
  app.quit();
});
