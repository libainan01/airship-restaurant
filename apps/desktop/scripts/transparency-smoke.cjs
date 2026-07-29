const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const tempDirectory = app.getPath("temp");
app.setPath(
  "userData",
  path.join(tempDirectory, "airship-restaurant-transparency-smoke"),
);

const capturePath =
  process.argv[2] ||
  path.join(tempDirectory, "airship-formal-transparency.png");

function readPixel(bitmap, width, x, y) {
  const offset = (y * width + x) * 4;
  return {
    blue: bitmap[offset],
    green: bitmap[offset + 1],
    red: bitmap[offset + 2],
    alpha: bitmap[offset + 3],
  };
}

async function run() {
  await app.whenReady();

  const window = new BrowserWindow({
    width: 1000,
    height: 700,
    show: false,
    transparent: true,
    frame: false,
    hasShadow: false,
    backgroundColor: "#00000000",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      backgroundThrottling: false,
    },
  });

  await window.loadFile(
    path.join(__dirname, "..", "dist", "renderer", "desktop.html"),
  );
  await new Promise((resolve) => setTimeout(resolve, 250));

  const image = await window.webContents.capturePage();
  const { width, height } = image.getSize();
  const bitmap = image.toBitmap();
  const samples = {
    upperLeftEmpty: readPixel(bitmap, width, 60, 90),
    airship: readPixel(bitmap, width, 500, 72),
    centerEmpty: readPixel(bitmap, width, 500, 350),
    restaurant: readPixel(bitmap, width, 120, 590),
  };

  fs.mkdirSync(path.dirname(capturePath), { recursive: true });
  fs.writeFileSync(capturePath, image.toPNG());

  const transparentSamples = [
    samples.upperLeftEmpty,
    samples.centerEmpty,
  ];
  const transparent = transparentSamples.every(
    (sample) => sample.alpha === 0,
  );

  console.log(
    `TRANSPARENCY_CHECK ${JSON.stringify({
      capturePath,
      size: { width, height },
      samples,
      transparent,
    })}`,
  );

  window.destroy();
  app.exit(transparent ? 0 : 1);
}

void run().catch((error) => {
  console.error("TRANSPARENCY_CHECK_FAILED", error);
  app.exit(1);
});
