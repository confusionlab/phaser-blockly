import type { CostumeAssetFrame, CostumeBounds } from '@/types';
import type {
  CostumeDocumentPreviewWorkerRequest,
  CostumeDocumentPreviewWorkerResponse,
  RenderableCostumePreviewLayer,
} from './costumeDocumentPreviewProtocol';

type PendingPreviewRequest = {
  reject: (reason?: unknown) => void;
  resolve: (result: { assetFrame?: CostumeAssetFrame | null; bounds: CostumeBounds | null; dataUrl: string }) => void;
};

let previewWorker: Worker | null = null;
let nextRequestId = 1;
const pendingPreviewRequests = new Map<number, PendingPreviewRequest>();

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
        return;
      }
      reject(new Error('Preview worker returned a non-string data URL payload.'));
    };
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read preview blob as a data URL.'));
    reader.readAsDataURL(blob);
  });
}

function handleWorkerMessage(event: MessageEvent<CostumeDocumentPreviewWorkerResponse>) {
  const response = event.data;
  const pending = pendingPreviewRequests.get(response.requestId);
  if (!pending) {
    return;
  }

  pendingPreviewRequests.delete(response.requestId);
  if (response.type === 'error') {
    pending.reject(new Error(response.message));
    return;
  }

  void blobToDataUrl(response.blob).then((dataUrl) => {
    pending.resolve({
      assetFrame: response.assetFrame,
      dataUrl,
      bounds: response.bounds,
    });
  }).catch((error) => {
    pending.reject(error);
  });
}

function ensurePreviewWorker(): Worker {
  if (!previewWorker) {
    previewWorker = new Worker(
      new URL('./costumeDocumentPreviewWorker.ts', import.meta.url),
      { type: 'module' },
    );
    previewWorker.addEventListener('message', handleWorkerMessage);
  }
  return previewWorker;
}

export function canUseCostumeDocumentPreviewWorker(): boolean {
  return typeof window !== 'undefined'
    && typeof Worker !== 'undefined'
    && typeof OffscreenCanvas !== 'undefined'
    && typeof createImageBitmap === 'function';
}

export function renderCostumePreviewLayersInWorker(
  canvasSize: number,
  layers: RenderableCostumePreviewLayer[],
  options: { trimTransparentFrame?: boolean; mimeType?: string; quality?: number } = {},
): Promise<{ assetFrame?: CostumeAssetFrame | null; bounds: CostumeBounds | null; dataUrl: string }> {
  const worker = ensurePreviewWorker();
  const requestId = nextRequestId++;
  const request: CostumeDocumentPreviewWorkerRequest = {
    requestId,
    canvasSize,
    layers,
    mimeType: options.mimeType,
    quality: options.quality,
    trimTransparentFrame: options.trimTransparentFrame === true,
  };

  return new Promise((resolve, reject) => {
    pendingPreviewRequests.set(requestId, { resolve, reject });
    worker.postMessage(request);
  });
}
