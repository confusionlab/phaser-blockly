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
    const requestScratchResize = () => {
      window.dispatchEvent(new Event('resize'));
    };

    const frameId = window.requestAnimationFrame(requestScratchResize);
    const observer = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(() => requestScratchResize());

    observer?.observe(document.documentElement);
    return () => {
      window.cancelAnimationFrame(frameId);
      observer?.disconnect();
    };
  }, [imageState?.imageId]);

  useEffect(() => {
    let dragFrameId = 0;
    let isDragging = false;

    const repaintWhileDragging = () => {
      window.dispatchEvent(new Event('resize'));
      if (isDragging) {
        dragFrameId = window.requestAnimationFrame(repaintWhileDragging);
      }
    };

    const startDragPaintLoop = () => {
      if (isDragging) {
        return;
      }
      isDragging = true;
      dragFrameId = window.requestAnimationFrame(repaintWhileDragging);
    };

    const stopDragPaintLoop = () => {
      isDragging = false;
      if (dragFrameId) {
        window.cancelAnimationFrame(dragFrameId);
        dragFrameId = 0;
      }
      window.dispatchEvent(new Event('resize'));
    };

    document.addEventListener('mousedown', startDragPaintLoop, { capture: true });
    document.addEventListener('touchstart', startDragPaintLoop, { capture: true });
    window.addEventListener('mouseup', stopDragPaintLoop, { capture: true });
    window.addEventListener('touchend', stopDragPaintLoop, { capture: true });
    window.addEventListener('touchcancel', stopDragPaintLoop, { capture: true });
    window.addEventListener('blur', stopDragPaintLoop);

    return () => {
      document.removeEventListener('mousedown', startDragPaintLoop, { capture: true });
      document.removeEventListener('touchstart', startDragPaintLoop, { capture: true });
      window.removeEventListener('mouseup', stopDragPaintLoop, { capture: true });
      window.removeEventListener('touchend', stopDragPaintLoop, { capture: true });
      window.removeEventListener('touchcancel', stopDragPaintLoop, { capture: true });
      window.removeEventListener('blur', stopDragPaintLoop);
      stopDragPaintLoop();
    };
  }, []);

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
