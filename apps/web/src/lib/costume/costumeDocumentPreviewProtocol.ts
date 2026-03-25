import type { CostumeBounds } from '@/types';

export interface RenderableCostumePreviewLayer {
  opacity: number;
  source: string;
}

export interface CostumeDocumentPreviewWorkerRequest {
  canvasSize: number;
  layers: RenderableCostumePreviewLayer[];
  requestId: number;
}

export interface CostumeDocumentPreviewWorkerSuccessResponse {
  blob: Blob;
  bounds: CostumeBounds | null;
  requestId: number;
  type: 'success';
}

export interface CostumeDocumentPreviewWorkerErrorResponse {
  message: string;
  requestId: number;
  type: 'error';
}

export type CostumeDocumentPreviewWorkerResponse =
  | CostumeDocumentPreviewWorkerSuccessResponse
  | CostumeDocumentPreviewWorkerErrorResponse;
