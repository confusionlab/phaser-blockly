export type ScratchImageFormat = 'png' | 'svg' | 'jpg';

export interface ScratchPaintImageState {
  image: string;
  imageFormat: ScratchImageFormat;
  imageId: string;
  name: string;
  rotationCenterX: number;
  rotationCenterY: number;
}

export const SCRATCH_PAINT_FRAME_READY = 'pochacoding:scratch-paint-frame:ready' as const;
export const SCRATCH_PAINT_FRAME_LOAD = 'pochacoding:scratch-paint-frame:load' as const;
export const SCRATCH_PAINT_FRAME_UPDATE = 'pochacoding:scratch-paint-frame:update' as const;
export const SCRATCH_PAINT_FRAME_RENAME = 'pochacoding:scratch-paint-frame:rename' as const;

export interface ScratchPaintFrameReadyMessage {
  type: typeof SCRATCH_PAINT_FRAME_READY;
}

export interface ScratchPaintFrameLoadMessage {
  type: typeof SCRATCH_PAINT_FRAME_LOAD;
  payload: ScratchPaintImageState;
}

export interface ScratchPaintFrameUpdateMessage {
  type: typeof SCRATCH_PAINT_FRAME_UPDATE;
  isVector: boolean;
  image: string | ImageData;
  rotationCenterX?: number;
  rotationCenterY?: number;
}

export interface ScratchPaintFrameRenameMessage {
  type: typeof SCRATCH_PAINT_FRAME_RENAME;
  name: string;
}

export type ScratchPaintFrameMessage =
  | ScratchPaintFrameReadyMessage
  | ScratchPaintFrameLoadMessage
  | ScratchPaintFrameUpdateMessage
  | ScratchPaintFrameRenameMessage;
