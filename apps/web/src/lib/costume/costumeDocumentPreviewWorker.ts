/// <reference lib="webworker" />

import { calculateAlphaBoundsPairFromImageData, type AlphaBoundsPair } from '@/utils/imageBounds';
import type {
  CostumeDocumentPreviewWorkerRequest,
  CostumeDocumentPreviewWorkerResponse,
} from './costumeDocumentPreviewProtocol';

async function renderPreview(request: CostumeDocumentPreviewWorkerRequest): Promise<{
  assetFrame?: import('@/types').CostumeAssetFrame | null;
  blob: Blob;
  bounds: AlphaBoundsPair['bounds'];
}> {
  const canvas = new OffscreenCanvas(request.canvasSize, request.canvasSize);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    throw new Error('Preview worker failed to create a 2D rendering context.');
  }

  for (const layer of request.layers) {
    if (!layer.source || layer.opacity <= 0) {
      continue;
    }

    const response = await fetch(layer.source);
    if (!response.ok) {
      throw new Error(`Preview worker failed to load layer source: ${response.status}`);
    }

    const blob = await response.blob();
    const bitmap = await createImageBitmap(blob);
    try {
      ctx.save();
      ctx.globalAlpha = layer.opacity;
      if (layer.assetFrame) {
        ctx.drawImage(
          bitmap,
          layer.assetFrame.x,
          layer.assetFrame.y,
          layer.assetFrame.width,
          layer.assetFrame.height,
        );
      } else {
        ctx.drawImage(bitmap, 0, 0, request.canvasSize, request.canvasSize);
      }
      ctx.restore();
    } finally {
      bitmap.close();
    }
  }

  const imageData = ctx.getImageData(0, 0, request.canvasSize, request.canvasSize);
  const { bounds, cropBounds } = calculateAlphaBoundsPairFromImageData(imageData);
  let targetCanvas: OffscreenCanvas = canvas;
  let assetFrame: import('@/types').CostumeAssetFrame | null | undefined;

  if (
    request.trimTransparentFrame === true &&
    cropBounds &&
    (
      cropBounds.x !== 0 ||
      cropBounds.y !== 0 ||
      cropBounds.width !== request.canvasSize ||
      cropBounds.height !== request.canvasSize
    )
  ) {
    targetCanvas = new OffscreenCanvas(cropBounds.width, cropBounds.height);
    const targetCtx = targetCanvas.getContext('2d');
    if (!targetCtx) {
      throw new Error('Preview worker failed to create a cropped rendering surface.');
    }
    targetCtx.drawImage(
      canvas,
      cropBounds.x,
      cropBounds.y,
      cropBounds.width,
      cropBounds.height,
      0,
      0,
      cropBounds.width,
      cropBounds.height,
    );
    assetFrame = {
      x: cropBounds.x,
      y: cropBounds.y,
      width: cropBounds.width,
      height: cropBounds.height,
      sourceWidth: request.canvasSize,
      sourceHeight: request.canvasSize,
    };
  }

  const previewBlob = await targetCanvas.convertToBlob({
    type: request.mimeType ?? 'image/webp',
    ...(request.mimeType === 'image/png'
      ? {}
      : { quality: request.quality ?? 0.85 }),
  });

  return {
    assetFrame,
    blob: previewBlob,
    bounds,
  };
}

const workerScope = self as DedicatedWorkerGlobalScope;

workerScope.onmessage = (event: MessageEvent<CostumeDocumentPreviewWorkerRequest>) => {
  void (async () => {
    const request = event.data;
    try {
      const rendered = await renderPreview(request);
      const response: CostumeDocumentPreviewWorkerResponse = {
        type: 'success',
        requestId: request.requestId,
        assetFrame: rendered.assetFrame,
        blob: rendered.blob,
        bounds: rendered.bounds,
      };
      workerScope.postMessage(response);
    } catch (error) {
      const response: CostumeDocumentPreviewWorkerResponse = {
        type: 'error',
        requestId: request.requestId,
        message: error instanceof Error ? error.message : 'Unknown preview worker failure.',
      };
      workerScope.postMessage(response);
    }
  })();
};

export {};
