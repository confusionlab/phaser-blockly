declare module 'scratch-paint/dist/scratch-paint' {
  import type { ComponentType } from 'react';
  import type { Reducer } from 'redux';

  export interface ScratchPaintEditorProps {
    image?: string | HTMLImageElement;
    imageFormat?: 'svg' | 'png' | 'jpg';
    imageId?: string;
    name?: string;
    rotationCenterX?: number;
    rotationCenterY?: number;
    rtl?: boolean;
    zoomLevelId?: string;
    onUpdateImage: (
      isVector: boolean,
      image: string | ImageData,
      rotationCenterX?: number,
      rotationCenterY?: number,
    ) => void;
    onUpdateName: (name: string) => void;
  }

  const PaintEditor: ComponentType<ScratchPaintEditorProps>;
  export const ScratchPaintReducer: Reducer;
  export default PaintEditor;
}
