import type { CostumeAssetFrame, CostumeBounds } from '@/types';

export interface RenderableCostumePreviewLayer {
  assetFrame?: CostumeAssetFrame | null;
  opacity: number;
  source: string;
}

export interface CostumeDocumentPreviewWorkerRequest {
  canvasSize: number;
  layers: RenderableCostumePreviewLayer[];
  trimTransparentFrame?: boolean;
  requestId: number;
}

export interface CostumeDocumentPreviewWorkerSuccessResponse {
  assetFrame?: CostumeAssetFrame | null;
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
