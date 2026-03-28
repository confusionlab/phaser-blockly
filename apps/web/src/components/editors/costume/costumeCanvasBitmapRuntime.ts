import { BaseBrush, Canvas as FabricCanvas, PencilBrush, Point } from 'fabric';
import {
  getBitmapBrushStampDefinition,
  type BitmapBrushKind,
} from '@/lib/background/brushCore';
import { getCanvas2dContext } from '@/utils/canvas2d';

export interface BitmapStampBrushCommitPayload {
  alphaThreshold: number;
  compositeOperation: GlobalCompositeOperation;
  strokeCanvas: HTMLCanvasElement;
}

interface BitmapStampBrushOptions {
  brushColor: string;
  brushKind: Exclude<BitmapBrushKind, 'hard-round'>;
  brushSize: number;
  compositeOperation: GlobalCompositeOperation;
  onCommit: (payload: BitmapStampBrushCommitPayload) => void | Promise<void>;
}

function cloneCanvasElement(source: HTMLCanvasElement | null): HTMLCanvasElement | null {
  if (!source) {
    return null;
  }

  const clone = document.createElement('canvas');
  clone.width = source.width;
  clone.height = source.height;
  const cloneCtx = clone.getContext('2d', { willReadFrequently: true });
  if (!cloneCtx) {
    return null;
  }
  cloneCtx.drawImage(source, 0, 0);
  return clone;
}

function drawPreviewSourceToContext(
  ctx: CanvasRenderingContext2D,
  sourceCanvas: HTMLCanvasElement | null,
) {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  if (sourceCanvas) {
    ctx.drawImage(sourceCanvas, 0, 0);
  }
  ctx.restore();
}

function renderFabricObjectOntoCanvas(
  sourceCanvas: HTMLCanvasElement,
  object: { objectCaching?: boolean; render?: (ctx: CanvasRenderingContext2D) => void } | null | undefined,
): boolean {
  if (!object || typeof object.render !== 'function') {
    return false;
  }

  const ctx = sourceCanvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    return false;
  }

  const previousObjectCaching = object.objectCaching;
  object.objectCaching = false;
  try {
    object.render(ctx);
  } finally {
    object.objectCaching = previousObjectCaching;
  }

  return true;
}

function getEraserPreviewSourceCanvas(fabricCanvas: FabricCanvas): HTMLCanvasElement | null {
  const liveLowerCanvas = (fabricCanvas as unknown as { lowerCanvasEl?: HTMLCanvasElement }).lowerCanvasEl;
  if (liveLowerCanvas) {
    return liveLowerCanvas;
  }

  try {
    if (typeof fabricCanvas.toCanvasElement === 'function') {
      return fabricCanvas.toCanvasElement(1);
    }
  } catch {
    // Fall back to the live lower canvas if Fabric snapshotting fails.
  }

  return null;
}

export function applyCanvasCursor(fabricCanvas: FabricCanvas, cursor: string) {
  fabricCanvas.defaultCursor = cursor;
  fabricCanvas.hoverCursor = cursor;
  fabricCanvas.moveCursor = cursor;
  fabricCanvas.freeDrawingCursor = cursor;
  if (fabricCanvas.upperCanvasEl) {
    fabricCanvas.upperCanvasEl.style.cursor = cursor;
  }
  if (fabricCanvas.lowerCanvasEl) {
    fabricCanvas.lowerCanvasEl.style.cursor = cursor;
  }
}

export class CompositePencilBrush extends PencilBrush {
  compositeOperation: GlobalCompositeOperation = 'source-over';
  private deferredPreviewCanvas: HTMLCanvasElement | null = null;
  private deferredPreviewToken = 0;
  private activeStrokePreviewToken: number | null = null;
  private lastCreatedPath: { render?: (ctx: CanvasRenderingContext2D) => void } | null = null;
  private previewSourceWasHidden = false;
  private previousLowerCanvasOpacity = '';

  override needsFullRender() {
    return this.compositeOperation === 'destination-out' || super.needsFullRender();
  }

  override _setBrushStyles(ctx: CanvasRenderingContext2D) {
    super._setBrushStyles(ctx);
    ctx.globalCompositeOperation = this.compositeOperation;
  }

  private setPreviewSourceHidden(hidden: boolean) {
    const lowerCanvas = (this.canvas as unknown as { lowerCanvasEl?: HTMLCanvasElement }).lowerCanvasEl;
    if (!lowerCanvas) {
      return;
    }

    if (hidden) {
      if (this.previewSourceWasHidden) {
        return;
      }
      this.previousLowerCanvasOpacity = lowerCanvas.style.opacity;
      lowerCanvas.style.opacity = '0';
      this.previewSourceWasHidden = true;
      return;
    }

    if (!this.previewSourceWasHidden) {
      return;
    }
    lowerCanvas.style.opacity = this.previousLowerCanvasOpacity;
    this.previousLowerCanvasOpacity = '';
    this.previewSourceWasHidden = false;
  }

  private getPreviewSourceCanvas() {
    return this.deferredPreviewCanvas ?? getEraserPreviewSourceCanvas(this.canvas);
  }

  private syncDeferredPreviewToTop() {
    drawPreviewSourceToContext(this.canvas.contextTop, this.deferredPreviewCanvas);
  }

  completeDeferredPreview(token?: number) {
    if (typeof token === 'number' && token !== this.deferredPreviewToken) {
      return;
    }

    this.deferredPreviewCanvas = null;
    this.canvas.clearContext(this.canvas.contextTop);
    this.setPreviewSourceHidden(false);
  }

  override onMouseDown(pointer: Point, { e }: any) {
    if (!this.canvas._isMainEvent(e)) {
      return;
    }

    if (this.compositeOperation === 'destination-out') {
      this.deferredPreviewToken += 1;
      this.activeStrokePreviewToken = this.deferredPreviewToken;
      this.lastCreatedPath = null;
    }

    return super.onMouseDown(pointer, { e });
  }

  override _render(ctx: CanvasRenderingContext2D = this.canvas.contextTop) {
    if (this.compositeOperation === 'destination-out' && ctx === this.canvas.contextTop) {
      const sourceCanvas = this.getPreviewSourceCanvas();
      drawPreviewSourceToContext(this.canvas.contextTop, sourceCanvas);
      this.setPreviewSourceHidden(!!sourceCanvas);
    }

    super._render(ctx);
  }

  override onMouseUp(eventData: any) {
    if (this.compositeOperation !== 'destination-out') {
      try {
        return super.onMouseUp(eventData);
      } finally {
        this.setPreviewSourceHidden(false);
      }
    }

    const previewSource = cloneCanvasElement(this.getPreviewSourceCanvas());
    const previewToken = this.activeStrokePreviewToken;
    this.lastCreatedPath = null;
    const result = super.onMouseUp(eventData);
    this.activeStrokePreviewToken = null;

    if (
      previewSource &&
      renderFabricObjectOntoCanvas(previewSource, this.lastCreatedPath)
    ) {
      this.deferredPreviewCanvas = previewSource;
      this.syncDeferredPreviewToTop();
      this.setPreviewSourceHidden(true);
      return result;
    }

    this.completeDeferredPreview(previewToken ?? undefined);
    return result;
  }

  override createPath(pathData: any) {
    const path = super.createPath(pathData);
    path.set('globalCompositeOperation', this.compositeOperation);
    if (this.compositeOperation === 'destination-out') {
      (path as any).__bitmapDeferredPreviewToken = this.activeStrokePreviewToken;
      this.lastCreatedPath = path;
    }
    return path;
  }
}

export class BitmapStampBrush extends BaseBrush {
  private accumulatedDistance = 0;
  private readonly compositeOperation: GlobalCompositeOperation;
  private deferredPreviewCanvas: HTMLCanvasElement | null = null;
  private deferredPreviewToken = 0;
  private activeStrokePreviewToken: number | null = null;
  private lastPoint: Point | null = null;
  private readonly onCommit: (payload: BitmapStampBrushCommitPayload) => void | Promise<void>;
  private readonly stampDefinition: ReturnType<typeof getBitmapBrushStampDefinition>;
  private strokeCanvas: HTMLCanvasElement | null = null;
  private strokeCtx: CanvasRenderingContext2D | null = null;
  private previewSourceWasHidden = false;
  private previousLowerCanvasOpacity = '';

  constructor(canvas: FabricCanvas, options: BitmapStampBrushOptions) {
    super(canvas as any);
    this.color = options.brushColor;
    this.width = options.brushSize;
    this.compositeOperation = options.compositeOperation;
    this.onCommit = options.onCommit;
    this.stampDefinition = getBitmapBrushStampDefinition(
      options.brushKind,
      options.brushColor,
      options.brushSize,
    );
  }

  override needsFullRender() {
    return true;
  }

  private setPreviewSourceHidden(hidden: boolean) {
    const lowerCanvas = (this.canvas as unknown as { lowerCanvasEl?: HTMLCanvasElement }).lowerCanvasEl;
    if (!lowerCanvas) {
      return;
    }

    if (hidden) {
      if (this.previewSourceWasHidden) {
        return;
      }
      this.previousLowerCanvasOpacity = lowerCanvas.style.opacity;
      lowerCanvas.style.opacity = '0';
      this.previewSourceWasHidden = true;
      return;
    }

    if (!this.previewSourceWasHidden) {
      return;
    }
    lowerCanvas.style.opacity = this.previousLowerCanvasOpacity;
    this.previousLowerCanvasOpacity = '';
    this.previewSourceWasHidden = false;
  }

  private getPreviewSourceCanvas() {
    return this.deferredPreviewCanvas ?? getEraserPreviewSourceCanvas(this.canvas);
  }

  private syncDeferredPreviewToTop() {
    drawPreviewSourceToContext(this.canvas.contextTop, this.deferredPreviewCanvas);
  }

  completeDeferredPreview(token?: number) {
    if (typeof token === 'number' && token !== this.deferredPreviewToken) {
      return;
    }
    if (this.lastPoint) {
      return;
    }

    this.deferredPreviewCanvas = null;
    this.canvas.clearContext(this.canvas.contextTop);
    this.setPreviewSourceHidden(false);
  }

  override onMouseDown(pointer: Point, { e }: any) {
    if (!this.canvas._isMainEvent(e)) {
      return;
    }
    if (this.compositeOperation === 'destination-out') {
      this.deferredPreviewToken += 1;
      this.activeStrokePreviewToken = this.deferredPreviewToken;
    }
    this.prepareStroke();
    this.lastPoint = new Point(pointer.x, pointer.y);
    this.stampAtPoint(pointer);
    this.renderPreview();
  }

  override onMouseMove(pointer: Point, { e }: any) {
    if (!this.canvas._isMainEvent(e)) {
      return;
    }
    if (this.limitedToCanvasSize === true && this._isOutSideCanvas(pointer)) {
      return;
    }
    if (!this.lastPoint) {
      this.onMouseDown(pointer, { e });
      return;
    }

    this.stampSegment(this.lastPoint, pointer);
    this.lastPoint = new Point(pointer.x, pointer.y);
    this.renderPreview();
  }

  override onMouseUp({ e }: any) {
    if (!this.canvas._isMainEvent(e)) {
      return true;
    }

    const strokeCanvas = this.strokeCanvas;
    const alphaThreshold = this.stampDefinition.alphaThreshold;
    const previewSource = this.compositeOperation === 'destination-out'
      ? cloneCanvasElement(this.getPreviewSourceCanvas())
      : null;
    const previewToken = this.activeStrokePreviewToken;
    this.resetStrokeState();

    if (this.compositeOperation === 'destination-out' && previewSource && strokeCanvas) {
      const previewCtx = previewSource.getContext('2d', { willReadFrequently: true });
      if (previewCtx) {
        previewCtx.save();
        previewCtx.globalCompositeOperation = this.compositeOperation;
        previewCtx.drawImage(strokeCanvas, 0, 0);
        previewCtx.restore();
        this.deferredPreviewCanvas = previewSource;
        this.syncDeferredPreviewToTop();
        this.setPreviewSourceHidden(true);
      } else {
        this.canvas.clearContext(this.canvas.contextTop);
        this.setPreviewSourceHidden(false);
      }
    } else {
      this.canvas.clearContext(this.canvas.contextTop);
      this.setPreviewSourceHidden(false);
    }

    if (strokeCanvas) {
      const commitResult = this.onCommit({
        strokeCanvas,
        compositeOperation: this.compositeOperation,
        alphaThreshold,
      });
      if (this.compositeOperation === 'destination-out') {
        void Promise.resolve(commitResult)
          .catch(() => undefined)
          .finally(() => {
            this.completeDeferredPreview(previewToken ?? undefined);
          });
      }
    } else if (this.compositeOperation === 'destination-out') {
      this.completeDeferredPreview(previewToken ?? undefined);
    }

    return false;
  }

  override _render() {
    this.renderPreview();
  }

  private prepareStroke() {
    const width = this.canvas.getWidth();
    const height = this.canvas.getHeight();
    const strokeCanvas = document.createElement('canvas');
    strokeCanvas.width = width;
    strokeCanvas.height = height;
    this.strokeCanvas = strokeCanvas;
    this.strokeCtx = getCanvas2dContext(strokeCanvas, 'readback');
    this.lastPoint = null;
    this.accumulatedDistance = 0;
  }

  private resetStrokeState() {
    this.strokeCanvas = null;
    this.strokeCtx = null;
    this.lastPoint = null;
    this.accumulatedDistance = 0;
  }

  private stampSegment(from: Point, to: Point) {
    const distanceX = to.x - from.x;
    const distanceY = to.y - from.y;
    const distance = Math.sqrt(distanceX * distanceX + distanceY * distanceY);
    if (distance === 0) {
      return;
    }

    const spacing = this.stampDefinition.spacing;
    let cursor = Math.max(0, spacing - this.accumulatedDistance);
    while (cursor <= distance) {
      const progress = cursor / distance;
      this.stampAtPoint(new Point(
        from.x + distanceX * progress,
        from.y + distanceY * progress,
      ));
      cursor += spacing;
    }

    this.accumulatedDistance = distance - (cursor - spacing);
  }

  private stampAtPoint(point: Point) {
    const ctx = this.strokeCtx;
    if (!ctx) {
      return;
    }

    const {
      opacity,
      rotationJitter,
      scaleJitter,
      scatter,
      stamp,
    } = this.stampDefinition;
    const scatterAngle = Math.random() * Math.PI * 2;
    const scatterRadius = scatter > 0 ? Math.random() * scatter : 0;
    const centerX = point.x + Math.cos(scatterAngle) * scatterRadius;
    const centerY = point.y + Math.sin(scatterAngle) * scatterRadius;
    const rotation = rotationJitter > 0 ? (Math.random() * 2 - 1) * rotationJitter : 0;
    const scale = 1 + (scaleJitter > 0 ? (Math.random() * 2 - 1) * scaleJitter : 0);

    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = opacity;
    ctx.translate(centerX, centerY);
    if (rotation !== 0) {
      ctx.rotate(rotation);
    }
    if (scale !== 1) {
      ctx.scale(scale, scale);
    }
    ctx.drawImage(stamp, -stamp.width / 2, -stamp.height / 2);
    ctx.restore();
  }

  private renderPreview() {
    const ctx = this.canvas.contextTop;
    drawPreviewSourceToContext(
      ctx,
      this.compositeOperation === 'destination-out' ? this.getPreviewSourceCanvas() : null,
    );
    if (this.compositeOperation === 'destination-out') {
      this.setPreviewSourceHidden(true);
    }

    if (!this.strokeCanvas) {
      return;
    }

    this._saveAndTransform(ctx);
    ctx.globalCompositeOperation = this.compositeOperation;
    ctx.drawImage(this.strokeCanvas, 0, 0);
    ctx.restore();
  }
}
