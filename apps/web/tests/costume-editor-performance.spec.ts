import { expect, test, type Page } from '@playwright/test';
import { bootstrapEditorProject } from './helpers/bootstrapEditorProject';

const COSTUME_EDITOR_TEST_URL = process.env.POCHA_E2E_BASE_URL ?? '/';

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
): Promise<void> {
  const box = await getCostumeCanvasBox(page);
  const startX = box.x + box.width * startXFactor;
  const startY = box.y + box.height * startYFactor;
  const endX = box.x + box.width * endXFactor;
  const endY = box.y + box.height * endYFactor;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(endX, endY, { steps: 10 });
  await page.mouse.up();
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

function summarizePerf(records: CostumeCommitPerfRecord[]): CostumeCommitPerfSummary {
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
  };
}

async function collectBitmapCommitBenchmark(
  page: Page,
  mode: 'brush' | 'eraser',
  measuredStrokeCount: number,
): Promise<{ summary: CostumeCommitPerfSummary; records: CostumeCommitPerfRecord[] }> {
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
  await clearCostumeCommitPerf(page);

  for (let index = 0; index < measuredStrokeCount; index += 1) {
    const yFactor = 0.22 + index * 0.045;
    await drawAcrossCostumeCanvas(page, 0.20, yFactor, 0.62, yFactor);
  }

  await expect.poll(async () => {
    const records = await readCostumeCommitPerf(page);
    return records.filter((record) => record.mode === 'bitmap' && record.previewReadyAtMs !== null).length;
  }, { timeout: 15000 }).toBe(measuredStrokeCount);

  const records = (await readCostumeCommitPerf(page))
    .filter((record) => record.mode === 'bitmap' && record.previewReadyAtMs !== null)
    .slice(-measuredStrokeCount);

  return {
    summary: summarizePerf(records),
    records,
  };
}

test.describe('costume editor performance benchmark', () => {
  test('bitmap brush stroke commit stays within the benchmark budget', async ({ page }, testInfo) => {
    const benchmark = await collectBitmapCommitBenchmark(page, 'brush', 10);
    await testInfo.attach('costume-brush-benchmark.json', {
      body: JSON.stringify(benchmark, null, 2),
      contentType: 'application/json',
    });

    console.log('[CostumePerf] brush', benchmark.summary);

    expect(benchmark.summary.count).toBe(10);
    expect(benchmark.summary.p95StateReadyMs).toBeLessThan(80);
    expect(benchmark.summary.p95PreviewReadyMs).toBeLessThan(80);
    expect(benchmark.summary.p95HistorySnapshotMs).toBeLessThan(60);
    expect(benchmark.summary.p95StateStoreSyncMs).toBeLessThan(10);
    expect(benchmark.summary.p95PreviewRenderMs).toBeLessThan(10);
  });

  test('bitmap eraser stroke commit stays within the benchmark budget', async ({ page }, testInfo) => {
    const benchmark = await collectBitmapCommitBenchmark(page, 'eraser', 10);
    await testInfo.attach('costume-eraser-benchmark.json', {
      body: JSON.stringify(benchmark, null, 2),
      contentType: 'application/json',
    });

    console.log('[CostumePerf] eraser', benchmark.summary);

    expect(benchmark.summary.count).toBe(10);
    expect(benchmark.summary.p95StateReadyMs).toBeLessThan(90);
    expect(benchmark.summary.p95PreviewReadyMs).toBeLessThan(90);
    expect(benchmark.summary.p95HistorySnapshotMs).toBeLessThan(70);
    expect(benchmark.summary.p95StateStoreSyncMs).toBeLessThan(10);
    expect(benchmark.summary.p95PreviewRenderMs).toBeLessThan(10);
  });
});
