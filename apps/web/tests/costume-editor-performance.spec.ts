import { expect, test, type Page } from '@playwright/test';
import { bootstrapEditorProject } from './helpers/bootstrapEditorProject';

const COSTUME_EDITOR_TEST_URL = process.env.POCHA_E2E_BASE_URL ?? '/';

test.describe.configure({ mode: 'serial' });

type CostumeCommitPerfPhase =
  | 'historySnapshotMs'
  | 'historyDispatchMs'
  | 'handleHistoryChangeMs'
  | 'stateStoreSyncMs'
  | 'previewRenderMs'
  | 'previewStoreSyncMs';

type CostumeCommitPerfRecord = {
  id: string;
  sessionKey: string | null;
  mode: 'bitmap' | 'vector';
  source: string;
  startedAtMs: number;
  stateReadyAtMs: number | null;
  previewReadyAtMs: number | null;
  completedAtMs: number | null;
  phases: Partial<Record<CostumeCommitPerfPhase, number>>;
};

type CostumeCommitPerfSummary = {
  count: number;
  medianStateReadyMs: number;
  p95StateReadyMs: number;
  medianPreviewReadyMs: number;
  p95PreviewReadyMs: number;
  medianHistorySnapshotMs: number;
  p95HistorySnapshotMs: number;
  medianStateStoreSyncMs: number;
  p95StateStoreSyncMs: number;
  medianPreviewRenderMs: number;
  p95PreviewRenderMs: number;
  medianFrameGapMs: number;
  p95FrameGapMs: number;
  maxFrameGapMs: number;
};

type CursorFreezeMonitorSamples = {
  longTaskDurations: number[];
  overlayGapSamples: number[];
  pointerGapSamples: number[];
};

type CursorFreezeSummary = {
  longTaskCount: number;
  maxLongTaskMs: number;
  maxOverlayGapMs: number;
  maxPointerGapMs: number;
  medianOverlayGapMs: number;
  medianPointerGapMs: number;
  p95OverlayGapMs: number;
  p95PointerGapMs: number;
};

type CostumeBitmapStrokeBenchmark = {
  commit: {
    records: CostumeCommitPerfRecord[];
    summary: CostumeCommitPerfSummary;
  };
  cursorBaseline: CursorFreezeSummary;
  cursorFreeze: CursorFreezeSummary;
};

async function openEditorFromProjectList(page: Page): Promise<void> {
  await bootstrapEditorProject(page, { projectName: `Costume Perf ${Date.now()}` });
}

async function waitForCostumeCanvasReady(page: Page): Promise<void> {
  const activeLayerVisual = page.getByTestId('costume-active-layer-visual');
  await expect(activeLayerVisual).toBeVisible({ timeout: 10000 });
  await expect(activeLayerVisual).toHaveAttribute('data-host-ready', 'true', { timeout: 10000 });
}

async function openCostumeEditor(page: Page): Promise<void> {
  await openEditorFromProjectList(page);
  await page.getByRole('button', { name: /add object/i }).click();
  await page.getByRole('radio', { name: /^costume$/i }).click();
  await expect(page.getByTestId('layer-add-button')).toBeVisible({ timeout: 10000 });
  await waitForCostumeCanvasReady(page);
}

async function getCostumeCanvasBox(page: Page) {
  const canvasSurface = page.getByTestId('costume-canvas-surface');
  await expect(canvasSurface).toBeVisible({ timeout: 10000 });
  const box = await canvasSurface.boundingBox();
  expect(box).not.toBeNull();
  if (!box) {
    throw new Error('Costume canvas surface is missing a bounding box.');
  }
  return box;
}

async function drawAcrossCostumeCanvas(
  page: Page,
  startXFactor: number,
  startYFactor: number,
  endXFactor: number,
  endYFactor: number,
  options: { steps?: number } = {},
): Promise<void> {
  const box = await getCostumeCanvasBox(page);
  const startX = box.x + box.width * startXFactor;
  const startY = box.y + box.height * startYFactor;
  const endX = box.x + box.width * endXFactor;
  const endY = box.y + box.height * endYFactor;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(endX, endY, { steps: options.steps ?? 10 });
  await page.mouse.up();
}

async function moveAcrossCostumeCanvas(
  page: Page,
  startXFactor: number,
  startYFactor: number,
  endXFactor: number,
  endYFactor: number,
  options: { steps?: number } = {},
): Promise<void> {
  const box = await getCostumeCanvasBox(page);
  const startX = box.x + box.width * startXFactor;
  const startY = box.y + box.height * startYFactor;
  const endX = box.x + box.width * endXFactor;
  const endY = box.y + box.height * endYFactor;

  await page.mouse.move(startX, startY);
  await page.mouse.move(endX, endY, { steps: options.steps ?? 10 });
}

async function clearCostumeCommitPerf(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const perf = await import('/src/lib/perf/costumeCommitPerformance.ts');
    perf.clearCostumeCommitPerfRecords();
  });
}

async function readCostumeCommitPerf(page: Page): Promise<CostumeCommitPerfRecord[]> {
  return await page.evaluate(async () => {
    const perf = await import('/src/lib/perf/costumeCommitPerformance.ts');
    return perf.getCostumeCommitPerfRecords();
  });
}

async function startFrameGapMonitor(page: Page): Promise<void> {
  await page.evaluate(() => {
    const runtimeWindow = window as typeof window & {
      __POCHA_FRAME_GAP_MONITOR__?: {
        stop: () => number[];
      };
    };

    runtimeWindow.__POCHA_FRAME_GAP_MONITOR__?.stop();

    const samples: number[] = [];
    let frameId = 0;
    let active = true;
    let lastTimestamp: number | null = null;

    const tick = (timestamp: number) => {
      if (!active) {
        return;
      }
      if (lastTimestamp !== null) {
        samples.push(timestamp - lastTimestamp);
      }
      lastTimestamp = timestamp;
      frameId = window.requestAnimationFrame(tick);
    };

    frameId = window.requestAnimationFrame(tick);
    runtimeWindow.__POCHA_FRAME_GAP_MONITOR__ = {
      stop: () => {
        active = false;
        if (frameId) {
          window.cancelAnimationFrame(frameId);
        }
        return [...samples];
      },
    };
  });
}

async function stopFrameGapMonitor(page: Page): Promise<number[]> {
  return await page.evaluate(async () => {
    const runtimeWindow = window as typeof window & {
      __POCHA_FRAME_GAP_MONITOR__?: {
        stop: () => number[];
      };
    };

    await new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => resolve());
      });
    });

    return runtimeWindow.__POCHA_FRAME_GAP_MONITOR__?.stop() ?? [];
  });
}

async function startCursorFreezeMonitor(page: Page): Promise<void> {
  await page.evaluate(() => {
    const runtimeWindow = window as typeof window & {
      __POCHA_CURSOR_FREEZE_MONITOR__?: {
        stop: () => CursorFreezeMonitorSamples;
      };
    };

    runtimeWindow.__POCHA_CURSOR_FREEZE_MONITOR__?.stop();

    const container = document.querySelector('[data-testid="costume-canvas-container"]');
    const overlay = document.querySelector('[data-testid="costume-brush-cursor-overlay"]');
    if (!(container instanceof HTMLElement) || !(overlay instanceof HTMLElement)) {
      throw new Error('Costume cursor freeze monitor could not find the expected canvas elements.');
    }

    const pointerGapSamples: number[] = [];
    const overlayGapSamples: number[] = [];
    const longTaskDurations: number[] = [];
    let lastPointerAtMs: number | null = null;
    let lastOverlayAtMs: number | null = null;
    let lastOverlayTransform = overlay.style.transform;

    const handlePointerMove = () => {
      const now = performance.now();
      if (lastPointerAtMs !== null) {
        pointerGapSamples.push(now - lastPointerAtMs);
      }
      lastPointerAtMs = now;
    };

    const overlayObserver = new MutationObserver(() => {
      const nextTransform = overlay.style.transform;
      if (nextTransform === lastOverlayTransform) {
        return;
      }

      lastOverlayTransform = nextTransform;
      const now = performance.now();
      if (lastOverlayAtMs !== null) {
        overlayGapSamples.push(now - lastOverlayAtMs);
      }
      lastOverlayAtMs = now;
    });

    let longTaskObserver: PerformanceObserver | null = null;
    if (typeof PerformanceObserver !== 'undefined') {
      try {
        longTaskObserver = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            longTaskDurations.push(entry.duration);
          }
        });
        longTaskObserver.observe({ entryTypes: ['longtask'] });
      } catch {
        longTaskObserver = null;
      }
    }

    container.addEventListener('pointermove', handlePointerMove);
    overlayObserver.observe(overlay, {
      attributeFilter: ['style'],
      attributes: true,
    });

    runtimeWindow.__POCHA_CURSOR_FREEZE_MONITOR__ = {
      stop: () => {
        container.removeEventListener('pointermove', handlePointerMove);
        overlayObserver.disconnect();
        longTaskObserver?.disconnect();
        return {
          pointerGapSamples: [...pointerGapSamples],
          overlayGapSamples: [...overlayGapSamples],
          longTaskDurations: [...longTaskDurations],
        };
      },
    };
  });
}

async function stopCursorFreezeMonitor(page: Page): Promise<CursorFreezeMonitorSamples> {
  return await page.evaluate(async () => {
    const runtimeWindow = window as typeof window & {
      __POCHA_CURSOR_FREEZE_MONITOR__?: {
        stop: () => CursorFreezeMonitorSamples;
      };
    };

    await new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => resolve());
      });
    });

    return runtimeWindow.__POCHA_CURSOR_FREEZE_MONITOR__?.stop() ?? {
      pointerGapSamples: [],
      overlayGapSamples: [],
      longTaskDurations: [],
    };
  });
}

function percentile(values: number[], ratio: number): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return sorted[index] ?? 0;
}

function roundMs(value: number): number {
  return Math.round(value * 100) / 100;
}

function summarizePerf(records: CostumeCommitPerfRecord[], frameGapSamples: number[]): CostumeCommitPerfSummary {
  const stateReadyDurations = records
    .map((record) => (record.stateReadyAtMs ?? record.completedAtMs) !== null ? (record.stateReadyAtMs ?? record.completedAtMs ?? 0) - record.startedAtMs : null)
    .filter((value): value is number => value !== null);
  const previewReadyDurations = records
    .map((record) => record.previewReadyAtMs !== null ? record.previewReadyAtMs - record.startedAtMs : null)
    .filter((value): value is number => value !== null);
  const historySnapshotDurations = records.map((record) => record.phases.historySnapshotMs ?? 0);
  const stateStoreSyncDurations = records.map((record) => record.phases.stateStoreSyncMs ?? 0);
  const previewRenderDurations = records.map((record) => record.phases.previewRenderMs ?? 0);

  return {
    count: records.length,
    medianStateReadyMs: roundMs(percentile(stateReadyDurations, 0.5)),
    p95StateReadyMs: roundMs(percentile(stateReadyDurations, 0.95)),
    medianPreviewReadyMs: roundMs(percentile(previewReadyDurations, 0.5)),
    p95PreviewReadyMs: roundMs(percentile(previewReadyDurations, 0.95)),
    medianHistorySnapshotMs: roundMs(percentile(historySnapshotDurations, 0.5)),
    p95HistorySnapshotMs: roundMs(percentile(historySnapshotDurations, 0.95)),
    medianStateStoreSyncMs: roundMs(percentile(stateStoreSyncDurations, 0.5)),
    p95StateStoreSyncMs: roundMs(percentile(stateStoreSyncDurations, 0.95)),
    medianPreviewRenderMs: roundMs(percentile(previewRenderDurations, 0.5)),
    p95PreviewRenderMs: roundMs(percentile(previewRenderDurations, 0.95)),
    medianFrameGapMs: roundMs(percentile(frameGapSamples, 0.5)),
    p95FrameGapMs: roundMs(percentile(frameGapSamples, 0.95)),
    maxFrameGapMs: roundMs(frameGapSamples.length > 0 ? Math.max(...frameGapSamples) : 0),
  };
}

function summarizeCursorFreeze(samples: CursorFreezeMonitorSamples): CursorFreezeSummary {
  return {
    medianPointerGapMs: roundMs(percentile(samples.pointerGapSamples, 0.5)),
    p95PointerGapMs: roundMs(percentile(samples.pointerGapSamples, 0.95)),
    maxPointerGapMs: roundMs(samples.pointerGapSamples.length > 0 ? Math.max(...samples.pointerGapSamples) : 0),
    medianOverlayGapMs: roundMs(percentile(samples.overlayGapSamples, 0.5)),
    p95OverlayGapMs: roundMs(percentile(samples.overlayGapSamples, 0.95)),
    maxOverlayGapMs: roundMs(samples.overlayGapSamples.length > 0 ? Math.max(...samples.overlayGapSamples) : 0),
    longTaskCount: samples.longTaskDurations.length,
    maxLongTaskMs: roundMs(samples.longTaskDurations.length > 0 ? Math.max(...samples.longTaskDurations) : 0),
  };
}

async function collectCursorFreezeBenchmark(
  page: Page,
  interaction: 'move-only' | 'strokes',
  measuredStrokeCount: number,
): Promise<CursorFreezeSummary> {
  await startCursorFreezeMonitor(page);

  for (let index = 0; index < measuredStrokeCount; index += 1) {
    const yFactor = 0.22 + index * 0.045;
    if (interaction === 'move-only') {
      await moveAcrossCostumeCanvas(page, 0.20, yFactor, 0.62, yFactor, { steps: 4 });
      continue;
    }

    await drawAcrossCostumeCanvas(page, 0.20, yFactor, 0.62, yFactor, { steps: 4 });
  }

  return summarizeCursorFreeze(await stopCursorFreezeMonitor(page));
}

async function collectBitmapCommitBenchmark(
  page: Page,
  mode: 'brush' | 'eraser',
  measuredStrokeCount: number,
): Promise<CostumeBitmapStrokeBenchmark> {
  await page.addInitScript(() => {
    (window as typeof window & { __POCHA_COSTUME_COMMIT_PERF_ENABLED__?: boolean }).__POCHA_COSTUME_COMMIT_PERF_ENABLED__ = true;
  });

  await page.goto(COSTUME_EDITOR_TEST_URL);
  await page.waitForLoadState('networkidle');
  await openCostumeEditor(page);

  if (mode === 'eraser') {
    await page.getByRole('button', { name: /^rectangle$/i }).click();
    await drawAcrossCostumeCanvas(page, 0.16, 0.16, 0.64, 0.64);
    await waitForCostumeCanvasReady(page);
  }

  await page.getByRole('button', { name: new RegExp(`^${mode}$`, 'i') }).click();
  const cursorBaseline = await collectCursorFreezeBenchmark(page, 'move-only', measuredStrokeCount);
  await clearCostumeCommitPerf(page);
  await startFrameGapMonitor(page);
  const cursorFreeze = await collectCursorFreezeBenchmark(page, 'strokes', measuredStrokeCount);

  await expect.poll(async () => {
    const records = await readCostumeCommitPerf(page);
    return records.filter((record) => record.mode === 'bitmap' && record.previewReadyAtMs !== null).length;
  }, { timeout: 15000 }).toBe(measuredStrokeCount);

  const frameGapSamples = await stopFrameGapMonitor(page);
  const records = (await readCostumeCommitPerf(page))
    .filter((record) => record.mode === 'bitmap' && record.previewReadyAtMs !== null)
    .slice(-measuredStrokeCount);

  return {
    commit: {
      summary: summarizePerf(records, frameGapSamples),
      records,
    },
    cursorBaseline,
    cursorFreeze,
  };
}

test.describe('costume editor performance benchmark', () => {
  test('bitmap brush stroke commit stays within the benchmark budget', async ({ page }, testInfo) => {
    const benchmark = await collectBitmapCommitBenchmark(page, 'brush', 10);
    await testInfo.attach('costume-brush-benchmark.json', {
      body: JSON.stringify(benchmark, null, 2),
      contentType: 'application/json',
    });

    console.log('[CostumePerf] brush', benchmark.commit.summary, benchmark.cursorBaseline, benchmark.cursorFreeze);

    expect(benchmark.commit.summary.count).toBe(10);
    expect(benchmark.commit.summary.p95StateReadyMs).toBeLessThan(25);
    expect(benchmark.commit.summary.p95PreviewReadyMs).toBeLessThan(25);
    expect(benchmark.commit.summary.p95HistorySnapshotMs).toBeLessThan(20);
    expect(benchmark.commit.summary.p95StateStoreSyncMs).toBeLessThan(10);
    expect(benchmark.commit.summary.p95PreviewRenderMs).toBeLessThan(10);
    expect(benchmark.commit.summary.medianFrameGapMs).toBeLessThan(18);
    expect(benchmark.commit.summary.p95FrameGapMs).toBeLessThan(90);
    expect(benchmark.cursorFreeze.longTaskCount).toBe(0);
    expect(benchmark.cursorFreeze.p95PointerGapMs).toBeLessThan(benchmark.cursorBaseline.p95PointerGapMs + 80);
    expect(benchmark.cursorFreeze.p95OverlayGapMs).toBeLessThan(benchmark.cursorBaseline.p95OverlayGapMs + 80);
    expect(benchmark.cursorFreeze.maxPointerGapMs).toBeLessThan(benchmark.cursorBaseline.maxPointerGapMs + 120);
  });

  test('bitmap eraser stroke commit stays within the benchmark budget', async ({ page }, testInfo) => {
    const benchmark = await collectBitmapCommitBenchmark(page, 'eraser', 10);
    await testInfo.attach('costume-eraser-benchmark.json', {
      body: JSON.stringify(benchmark, null, 2),
      contentType: 'application/json',
    });

    console.log('[CostumePerf] eraser', benchmark.commit.summary, benchmark.cursorBaseline, benchmark.cursorFreeze);

    expect(benchmark.commit.summary.count).toBe(10);
    expect(benchmark.commit.summary.p95StateReadyMs).toBeLessThan(25);
    expect(benchmark.commit.summary.p95PreviewReadyMs).toBeLessThan(25);
    expect(benchmark.commit.summary.p95HistorySnapshotMs).toBeLessThan(20);
    expect(benchmark.commit.summary.p95StateStoreSyncMs).toBeLessThan(10);
    expect(benchmark.commit.summary.p95PreviewRenderMs).toBeLessThan(10);
    expect(benchmark.commit.summary.medianFrameGapMs).toBeLessThan(18);
    expect(benchmark.commit.summary.p95FrameGapMs).toBeLessThan(90);
    expect(benchmark.cursorFreeze.longTaskCount).toBe(0);
    expect(benchmark.cursorFreeze.p95PointerGapMs).toBeLessThan(benchmark.cursorBaseline.p95PointerGapMs + 80);
    expect(benchmark.cursorFreeze.p95OverlayGapMs).toBeLessThan(benchmark.cursorBaseline.p95OverlayGapMs + 80);
    expect(benchmark.cursorFreeze.maxPointerGapMs).toBeLessThan(benchmark.cursorBaseline.maxPointerGapMs + 120);
  });
});
