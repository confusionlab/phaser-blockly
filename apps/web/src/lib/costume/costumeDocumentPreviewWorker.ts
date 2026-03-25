/// <reference lib="webworker" />

import { calculateBoundsFromImageData } from '@/utils/imageBounds';
import type {
  CostumeDocumentPreviewWorkerRequest,
  CostumeDocumentPreviewWorkerResponse,
} from './costumeDocumentPreviewProtocol';

async function renderPreview(request: CostumeDocumentPreviewWorkerRequest): Promise<{
  blob: Blob;
  bounds: ReturnType<typeof calculateBoundsFromImageData>;
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
      ctx.drawImage(bitmap, 0, 0, request.canvasSize, request.canvasSize);
      ctx.restore();
    } finally {
      bitmap.close();
    }
  }

  const imageData = ctx.getImageData(0, 0, request.canvasSize, request.canvasSize);
  const previewBlob = await canvas.convertToBlob({
    type: 'image/webp',
    quality: 0.85,
  });

  return {
    blob: previewBlob,
    bounds: calculateBoundsFromImageData(imageData),
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
