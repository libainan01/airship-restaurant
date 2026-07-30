import type {
  GameSnapshot,
  SaveDiagnosticsSnapshot,
} from "@airship-restaurant/contracts";
import type { GameRuntime } from "@airship-restaurant/core";
import { app } from "electron";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { GameSaveService } from "./game-save-service";
import type {
  WindowManager,
  WindowStabilityDiagnostics,
} from "./window-manager";

export interface ResidentStabilityOptions {
  readonly durationMs: number;
  readonly sampleIntervalMs: number;
  readonly reportDirectory: string;
}

interface ResidentProcessSample {
  readonly pid: number;
  readonly type: string;
  readonly name: string | null;
  readonly creationTimeUtcMs: number;
  readonly cpuPercent: number;
  readonly cumulativeCpuSeconds: number | null;
  readonly workingSetKb: number;
  readonly peakWorkingSetKb: number;
  readonly privateBytesKb: number | null;
}

interface ResidentStabilitySample {
  readonly sampledAtUtcMs: number;
  readonly elapsedMs: number;
  readonly rendererCount: number;
  readonly runtimeRevision: number;
  readonly gameplayRevision: number | null;
  readonly soldQuantity: number | null;
  readonly copperBalance: number | null;
  readonly save: SaveDiagnosticsSnapshot;
  readonly windows: WindowStabilityDiagnostics;
  readonly totalWorkingSetKb: number;
  readonly processes: readonly ResidentProcessSample[];
}

type ResidentStabilityStatus = "completed" | "interrupted";

function sanitizeTimestamp(utcMs: number): string {
  return new Date(utcMs).toISOString().replaceAll(/[:.]/g, "-");
}

function getGameplayValue(
  snapshot: GameSnapshot,
  field: "sold" | "copper",
): number | null {
  if (snapshot.gameplay === null) {
    return null;
  }
  return field === "sold"
    ? snapshot.gameplay.restaurant.totalSoldQuantity
    : snapshot.gameplay.restaurant.copperBalance;
}

export class ResidentStabilityMonitor {
  readonly #options: ResidentStabilityOptions;
  readonly #runtime: GameRuntime;
  readonly #gameSaveService: GameSaveService;
  readonly #windowManager: WindowManager;
  readonly #samples: ResidentStabilitySample[] = [];
  #startedAtUtcMs: number | null = null;
  #sampleTimer: NodeJS.Timeout | null = null;
  #completionTimer: NodeJS.Timeout | null = null;
  #finishPromise: Promise<string> | null = null;

  constructor(
    options: ResidentStabilityOptions,
    runtime: GameRuntime,
    gameSaveService: GameSaveService,
    windowManager: WindowManager,
  ) {
    this.#options = options;
    this.#runtime = runtime;
    this.#gameSaveService = gameSaveService;
    this.#windowManager = windowManager;
  }

  start(onCompleted: (reportPath: string) => void): void {
    if (this.#startedAtUtcMs !== null) {
      throw new Error("Resident stability monitor is already running.");
    }
    this.#startedAtUtcMs = Date.now();
    this.#captureSample();
    this.#sampleTimer = setInterval(() => {
      this.#captureSample();
    }, this.#options.sampleIntervalMs);
    this.#completionTimer = setTimeout(() => {
      void this.finish("completed")
        .then(onCompleted)
        .catch((error: unknown) => {
          console.error(
            "[ResidentStability] Unable to write report",
            error,
          );
          app.exit(1);
        });
    }, this.#options.durationMs);
    console.log(
      `[ResidentStability] Started ${JSON.stringify({
        durationMs: this.#options.durationMs,
        sampleIntervalMs: this.#options.sampleIntervalMs,
      })}`,
    );
  }

  finish(status: ResidentStabilityStatus): Promise<string> {
    if (this.#finishPromise !== null) {
      return this.#finishPromise;
    }
    if (this.#startedAtUtcMs === null) {
      return Promise.reject(
        new Error("Resident stability monitor was not started."),
      );
    }
    this.#clearTimers();
    this.#captureSample();
    this.#finishPromise = this.#writeReport(status);
    return this.#finishPromise;
  }

  #clearTimers(): void {
    if (this.#sampleTimer !== null) {
      clearInterval(this.#sampleTimer);
      this.#sampleTimer = null;
    }
    if (this.#completionTimer !== null) {
      clearTimeout(this.#completionTimer);
      this.#completionTimer = null;
    }
  }

  #captureSample(): void {
    const startedAtUtcMs = this.#startedAtUtcMs;
    if (startedAtUtcMs === null) {
      return;
    }
    const sampledAtUtcMs = Date.now();
    const snapshot = this.#runtime.getSnapshot();
    const processes = app.getAppMetrics().map(
      (metric): ResidentProcessSample =>
        Object.freeze({
          pid: metric.pid,
          type: metric.type,
          name: metric.name ?? null,
          creationTimeUtcMs: metric.creationTime,
          cpuPercent: metric.cpu.percentCPUUsage,
          cumulativeCpuSeconds:
            metric.cpu.cumulativeCPUUsage ?? null,
          workingSetKb: metric.memory.workingSetSize,
          peakWorkingSetKb: metric.memory.peakWorkingSetSize,
          privateBytesKb: metric.memory.privateBytes ?? null,
        }),
    );
    const totalWorkingSetKb = processes.reduce(
      (total, processSample) =>
        total + processSample.workingSetKb,
      0,
    );
    this.#samples.push(
      Object.freeze({
        sampledAtUtcMs,
        elapsedMs: sampledAtUtcMs - startedAtUtcMs,
        rendererCount:
          this.#windowManager.getRendererWebContents().length,
        runtimeRevision: snapshot.revision,
        gameplayRevision: snapshot.gameplay?.revision ?? null,
        soldQuantity: getGameplayValue(snapshot, "sold"),
        copperBalance: getGameplayValue(snapshot, "copper"),
        save: this.#gameSaveService.getDiagnostics(),
        windows: this.#windowManager.getStabilityDiagnostics(),
        totalWorkingSetKb,
        processes: Object.freeze(processes),
      }),
    );
  }

  async #writeReport(
    status: ResidentStabilityStatus,
  ): Promise<string> {
    const startedAtUtcMs = this.#startedAtUtcMs as number;
    const finishedAtUtcMs = Date.now();
    const first = this.#samples[0];
    const last = this.#samples.at(-1);
    if (first === undefined || last === undefined) {
      throw new Error("Resident stability report has no samples.");
    }
    const peakTotalWorkingSetKb = Math.max(
      ...this.#samples.map((sample) => sample.totalWorkingSetKb),
    );
    const peakCombinedCpuPercent = Math.max(
      ...this.#samples.map((sample) =>
        sample.processes.reduce(
          (total, processSample) =>
            total + processSample.cpuPercent,
          0,
        ),
      ),
    );
    const report = {
      schemaVersion: 1,
      status,
      startedAtUtcMs,
      finishedAtUtcMs,
      requestedDurationMs: this.#options.durationMs,
      actualDurationMs: finishedAtUtcMs - startedAtUtcMs,
      sampleIntervalMs: this.#options.sampleIntervalMs,
      summary: {
        sampleCount: this.#samples.length,
        initialWorkingSetKb: first.totalWorkingSetKb,
        finalWorkingSetKb: last.totalWorkingSetKb,
        workingSetGrowthKb:
          last.totalWorkingSetKb - first.totalWorkingSetKb,
        peakTotalWorkingSetKb,
        peakCombinedCpuPercent,
        minimumRendererCount: Math.min(
          ...this.#samples.map((sample) => sample.rendererCount),
        ),
        maximumRendererCount: Math.max(
          ...this.#samples.map((sample) => sample.rendererCount),
        ),
        saveErrorSamples: this.#samples.filter(
          (sample) => sample.save.status === "error",
        ).length,
        runtimeRevisionDelta:
          last.runtimeRevision - first.runtimeRevision,
        gameplayRevisionDelta:
          last.gameplayRevision === null ||
          first.gameplayRevision === null
            ? null
            : last.gameplayRevision - first.gameplayRevision,
        soldQuantityDelta:
          last.soldQuantity === null || first.soldQuantity === null
            ? null
            : last.soldQuantity - first.soldQuantity,
        copperBalanceDelta:
          last.copperBalance === null ||
          first.copperBalance === null
            ? null
            : last.copperBalance - first.copperBalance,
        finalWindowDiagnostics: last.windows,
      },
      samples: this.#samples,
    };
    await fs.mkdir(this.#options.reportDirectory, {
      recursive: true,
    });
    const reportPath = path.join(
      this.#options.reportDirectory,
      `resident-${sanitizeTimestamp(startedAtUtcMs)}.json`,
    );
    await fs.writeFile(
      reportPath,
      `${JSON.stringify(report, null, 2)}\n`,
      "utf8",
    );
    console.log(
      `[ResidentStability] Finished ${JSON.stringify({
        status,
        reportPath,
        summary: report.summary,
      })}`,
    );
    return reportPath;
  }
}
