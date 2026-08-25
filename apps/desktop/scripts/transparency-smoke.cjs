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
  let image = null;
  let bitmap = null;
  let width = 0;
  let height = 0;
  const renderDeadline = Date.now() + 5_000;
  do {
    await new Promise((resolve) => setTimeout(resolve, 100));
    image = await window.webContents.capturePage();
    ({ width, height } = image.getSize());
    bitmap = image.toBitmap();
    const airshipReady = readPixel(bitmap, width, 400, 80).alpha > 0;
    const restaurantReady = readPixel(bitmap, width, 850, 620).alpha > 0;
    if (airshipReady && restaurantReady) break;
  } while (Date.now() < renderDeadline);
  if (image === null || bitmap === null) {
    throw new Error("Desktop renderer did not produce a capturable frame.");
  }
  const samples = {
    upperLeftEmpty: readPixel(bitmap, width, 60, 90),
    airship: readPixel(bitmap, width, 400, 80),
    centerEmpty: readPixel(bitmap, width, 500, 350),
    restaurant: readPixel(bitmap, width, 850, 620),
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
  const opaqueSamples = [samples.airship, samples.restaurant];
  const opaque = opaqueSamples.every((sample) => sample.alpha > 0);
  const passed = transparent && opaque;

  console.log(
    `TRANSPARENCY_CHECK ${JSON.stringify({
      capturePath,
      size: { width, height },
      samples,
      transparent,
      opaque,
      passed,
    })}`,
  );

  window.destroy();
  app.exit(passed ? 0 : 1);
}

void run().catch((error) => {
  console.error("TRANSPARENCY_CHECK_FAILED", error);
  app.exit(1);
});
