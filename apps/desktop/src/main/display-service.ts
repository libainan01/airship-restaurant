import { screen, type Display, type Rectangle } from "electron";

const MANAGEMENT_MIN_WIDTH = 640;
const MANAGEMENT_MIN_HEIGHT = 480;
const MANAGEMENT_DEFAULT_WIDTH = 1024;
const MANAGEMENT_DEFAULT_HEIGHT = 720;

export function fitBoundsToWorkArea(
  bounds: Readonly<Rectangle>,
  workArea: Readonly<Rectangle>,
): Rectangle {
  const width = Math.min(
    Math.max(bounds.width, MANAGEMENT_MIN_WIDTH),
    workArea.width,
  );
  const height = Math.min(
    Math.max(bounds.height, MANAGEMENT_MIN_HEIGHT),
    workArea.height,
  );
  const maximumX = workArea.x + workArea.width - width;
  const maximumY = workArea.y + workArea.height - height;

  return {
    x: Math.min(Math.max(bounds.x, workArea.x), maximumX),
    y: Math.min(Math.max(bounds.y, workArea.y), maximumY),
    width,
    height,
  };
}

export class DisplayService {
  #onDisplaysChanged: (() => void) | null = null;

  readonly #handleDisplaysChanged = (): void => {
    this.#onDisplaysChanged?.();
  };

  start(onDisplaysChanged: () => void): void {
    if (this.#onDisplaysChanged !== null) {
      throw new Error("DisplayService has already been started.");
    }

    this.#onDisplaysChanged = onDisplaysChanged;
    screen.on("display-added", this.#handleDisplaysChanged);
    screen.on("display-removed", this.#handleDisplaysChanged);
    screen.on("display-metrics-changed", this.#handleDisplaysChanged);
  }

  dispose(): void {
    if (this.#onDisplaysChanged === null) {
      return;
    }

    screen.off("display-added", this.#handleDisplaysChanged);
    screen.off("display-removed", this.#handleDisplaysChanged);
    screen.off("display-metrics-changed", this.#handleDisplaysChanged);
    this.#onDisplaysChanged = null;
  }

  getTargetDisplay(): Display {
    return screen.getPrimaryDisplay();
  }

  getDesktopBounds(): Rectangle {
    return { ...this.getTargetDisplay().workArea };
  }

  getInitialManagementBounds(): Rectangle {
    const workArea = this.getTargetDisplay().workArea;
    const width = Math.min(MANAGEMENT_DEFAULT_WIDTH, workArea.width);
    const height = Math.min(MANAGEMENT_DEFAULT_HEIGHT, workArea.height);

    return {
      x: workArea.x + Math.floor((workArea.width - width) / 2),
      y: workArea.y + Math.floor((workArea.height - height) / 2),
      width,
      height,
    };
  }

  fitManagementBounds(bounds: Readonly<Rectangle>): Rectangle {
    const display = screen.getDisplayMatching(bounds);
    return fitBoundsToWorkArea(bounds, display.workArea);
  }
}
