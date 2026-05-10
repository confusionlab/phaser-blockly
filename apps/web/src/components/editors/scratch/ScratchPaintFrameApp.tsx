import { useEffect, useMemo, useState } from 'react';
import { IntlProvider } from 'react-intl';
import { Provider as ReduxProvider } from 'react-redux';
import { combineReducers, createStore } from 'redux';
import PaintEditor, { ScratchPaintReducer } from 'scratch-paint/dist/scratch-paint';
import {
  SCRATCH_PAINT_FRAME_LOAD,
  SCRATCH_PAINT_FRAME_RENAME,
  SCRATCH_PAINT_FRAME_READY,
  SCRATCH_PAINT_FRAME_UPDATE,
  getScratchPaintFrameTargetOrigin,
  type ScratchPaintFrameLoadMessage,
  type ScratchPaintFrameMessage,
  type ScratchPaintImageState,
} from './ScratchPaintFrameTypes';

function createScratchPaintStore() {
  return createStore(combineReducers({ scratchPaint: ScratchPaintReducer }));
}

function isFrameLoadMessage(data: unknown): data is ScratchPaintFrameLoadMessage {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as ScratchPaintFrameMessage).type === SCRATCH_PAINT_FRAME_LOAD
  );
}

export function ScratchPaintFrameApp() {
  const scratchStore = useMemo(() => createScratchPaintStore(), []);
  const [imageState, setImageState] = useState<ScratchPaintImageState | null>(null);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.source !== window.parent || !isFrameLoadMessage(event.data)) {
        return;
      }
      setImageState(event.data.payload);
    };

    window.addEventListener('message', handleMessage);
    window.parent.postMessage({ type: SCRATCH_PAINT_FRAME_READY }, getScratchPaintFrameTargetOrigin());
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  return (
    <div className="h-screen w-screen overflow-hidden bg-card [&_.paint-editor_paint-editor_*]:font-sans">
      {imageState ? (
        <ReduxProvider store={scratchStore}>
          <IntlProvider locale="en" defaultLocale="en">
            <PaintEditor
              image={imageState.image}
              imageFormat={imageState.imageFormat}
              imageId={imageState.imageId}
              name={imageState.name}
              rotationCenterX={imageState.rotationCenterX}
              rotationCenterY={imageState.rotationCenterY}
              rtl={false}
              zoomLevelId={imageState.imageId}
              onUpdateImage={(isVector, image, rotationCenterX, rotationCenterY) => {
                window.parent.postMessage({
                  type: SCRATCH_PAINT_FRAME_UPDATE,
                  isVector,
                  image,
                  rotationCenterX,
                  rotationCenterY,
                }, getScratchPaintFrameTargetOrigin());
              }}
              onUpdateName={(name) => {
                window.parent.postMessage({
                  type: SCRATCH_PAINT_FRAME_RENAME,
                  name,
                }, getScratchPaintFrameTargetOrigin());
              }}
            />
          </IntlProvider>
        </ReduxProvider>
      ) : null}
    </div>
  );
}
