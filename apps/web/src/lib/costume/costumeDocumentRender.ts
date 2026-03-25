import { StaticCanvas } from 'fabric';
import type { CostumeBounds, CostumeDocument, CostumeLayer } from '@/types';
import { calculateBoundsFromCanvas } from '@/utils/imageBounds';
import { COSTUME_CANVAS_SIZE, isBitmapCostumeLayer, isVectorCostumeLayer } from './costumeDocument';

async function loadImage(source: string): Promise<HTMLImageElement> {
  return await new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Failed to load costume layer image: ${source.slice(0, 64)}`));
    image.src = source;
  });
}

async function renderLayerOntoContext(
  ctx: CanvasRenderingContext2D,
  layer: CostumeLayer,
): Promise<void> {
  if (!layer.visible || layer.opacity <= 0) {
    return;
  }

  ctx.save();
  ctx.globalAlpha = layer.opacity;

  try {
    if (isBitmapCostumeLayer(layer)) {
      if (!layer.bitmap.assetId) {
        return;
      }
      const image = await loadImage(layer.bitmap.assetId);
      ctx.drawImage(image, 0, 0, COSTUME_CANVAS_SIZE, COSTUME_CANVAS_SIZE);
      return;
    }

    if (!isVectorCostumeLayer(layer)) {
      return;
    }

    const vectorCanvasElement = document.createElement('canvas');
    vectorCanvasElement.width = COSTUME_CANVAS_SIZE;
    vectorCanvasElement.height = COSTUME_CANVAS_SIZE;
    const vectorCanvas = new StaticCanvas(vectorCanvasElement, {
      width: COSTUME_CANVAS_SIZE,
      height: COSTUME_CANVAS_SIZE,
      renderOnAddRemove: false,
    });

    try {
      const parsed = JSON.parse(layer.vector.fabricJson);
      await vectorCanvas.loadFromJSON(parsed);
      vectorCanvas.renderAll();
      ctx.drawImage(vectorCanvasElement, 0, 0);
    } finally {
      vectorCanvas.dispose();
    }
  } finally {
    ctx.restore();
  }
}

export async function renderCostumeLayerStackToCanvas(layers: CostumeLayer[]): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas');
  canvas.width = COSTUME_CANVAS_SIZE;
  canvas.height = COSTUME_CANVAS_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return canvas;
  }

  for (const layer of layers) {
    await renderLayerOntoContext(ctx, layer);
  }

  return canvas;
}

export async function renderCostumeLayerStackToDataUrl(layers: CostumeLayer[]): Promise<string> {
  const canvas = await renderCostumeLayerStackToCanvas(layers);
  return canvas.toDataURL('image/png');
}

export async function renderCostumeDocumentSlice(
  document: CostumeDocument,
  options: { activeLayerId: string; placement: 'below' | 'above' },
): Promise<string> {
  const activeLayerIndex = document.layers.findIndex((layer) => layer.id === options.activeLayerId);
  if (activeLayerIndex < 0) {
    return renderCostumeLayerStackToDataUrl([]);
  }

  const layers = options.placement === 'below'
    ? document.layers.slice(0, activeLayerIndex)
    : document.layers.slice(activeLayerIndex + 1);
  return await renderCostumeLayerStackToDataUrl(layers);
}

export async function renderCostumeDocument(document: CostumeDocument): Promise<{
  canvas: HTMLCanvasElement;
  dataUrl: string;
  bounds: CostumeBounds | null;
}> {
  const canvas = await renderCostumeLayerStackToCanvas(document.layers);
  return {
    canvas,
    dataUrl: canvas.toDataURL('image/webp', 0.85),
    bounds: calculateBoundsFromCanvas(canvas),
  };
}
