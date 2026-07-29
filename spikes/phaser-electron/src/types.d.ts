interface DesktopPoint {
  x: number;
  y: number;
  inside: boolean;
}

interface DesktopEnvironment {
  platform: string;
  electronVersion: string;
  chromiumVersion: string;
  displayId: number;
  workArea: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  scaleFactor: number;
}

interface DesktopMetrics {
  timestamp: string;
  mainPrivateKb: number;
  mainResidentSetKb: number;
  processes: Array<{
    pid: number;
    type: string;
    cpuPercent: number;
    workingSetKb: number;
    peakWorkingSetKb: number;
  }>;
}

interface DesktopShellBridge {
  setInteractive(interactive: boolean, reason: string): void;
  setAlwaysOnTop(enabled: boolean): void;
  reportTestPoints(
    points: Record<string, { x: number; y: number }>,
  ): void;
  quit(): void;
  getEnvironment(): Promise<DesktopEnvironment>;
  onCursorPosition(callback: (point: DesktopPoint) => void): () => void;
  onPassthroughState(
    callback: (state: { interactive: boolean; reason: string }) => void,
  ): () => void;
  onMetrics(callback: (metrics: DesktopMetrics) => void): () => void;
}

interface Window {
  desktopShell?: DesktopShellBridge;
}
