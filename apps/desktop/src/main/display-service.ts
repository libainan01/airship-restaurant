import type {
  DisplayOption,
  WindowBoundsDto,
} from "@airship-restaurant/contracts";
import { screen, type Display, type Rectangle } from "electron";

const MANAGEMENT_MIN_WIDTH = 640;
const MANAGEMENT_MIN_HEIGHT = 480;
const MANAGEMENT_DEFAULT_WIDTH = 1024;
const MANAGEMENT_DEFAULT_HEIGHT = 720;
const TRANSPARENT_WINDOW_WIDTH_INSET = 1;

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

export function getTransparentDesktopBounds(
  workArea: Readonly<Rectangle>,
): Rectangle {
  return {
    ...workArea,
    // Windows DWM can promote an exactly work-area-sized transparent
    // BrowserWindow to an opaque fullscreen surface. One DIP avoids it.
    width: Math.max(1, workArea.width - TRANSPARENT_WINDOW_WIDTH_INSET),
  };
}

function toBoundsDto(bounds: Readonly<Rectangle>): WindowBoundsDto {
  return {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
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

  getPrimaryDisplayId(): string {
    return String(screen.getPrimaryDisplay().id);
  }

  hasDisplay(displayId: string): boolean {
    return screen
      .getAllDisplays()
      .some((display) => String(display.id) === displayId);
  }

  getTargetDisplay(displayId: string): Display {
    return (
      screen
        .getAllDisplays()
        .find((display) => String(display.id) === displayId) ??
      screen.getPrimaryDisplay()
    );
  }

  listDisplays(): readonly DisplayOption[] {
    const primaryId = this.getPrimaryDisplayId();
    return screen.getAllDisplays().map((display, index) => ({
      id: String(display.id),
      label:
        display.label.trim().length > 0
          ? display.label
          : `显示器 ${index + 1}`,
      bounds: toBoundsDto(display.bounds),
      workArea: toBoundsDto(display.workArea),
      scaleFactor: display.scaleFactor,
      isPrimary: String(display.id) === primaryId,
    }));
  }

  getDesktopBounds(displayId: string): Rectangle {
    return getTransparentDesktopBounds(
      this.getTargetDisplay(displayId).workArea,
    );
  }

  getInitialManagementBounds(
    displayId: string,
    savedBounds: Readonly<Rectangle> | null,
  ): Rectangle {
    if (savedBounds !== null) {
      return this.fitManagementBounds(savedBounds);
    }

    const workArea = this.getTargetDisplay(displayId).workArea;
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
