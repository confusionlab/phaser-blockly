import { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { IntlProvider } from 'react-intl';
import { Provider as ReduxProvider } from 'react-redux';
import { combineReducers, createStore } from 'redux';
import PaintEditor, { ScratchPaintReducer } from 'scratch-paint/dist/scratch-paint';
import {
  SCRATCH_PAINT_FRAME_LOAD,
  SCRATCH_PAINT_FRAME_READY,
  SCRATCH_PAINT_FRAME_RENAME,
  SCRATCH_PAINT_FRAME_UPDATE,
  type ScratchPaintFrameLoadMessage,
  type ScratchPaintFrameMessage,
  type ScratchPaintImageState,
} from '@pochacoding/scratch-paint-protocol';
import './index.css';

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

function getParentTargetOrigin(): string {
  const referrer = document.referrer ? new URL(document.referrer).origin : '';
  if (referrer && referrer !== 'null') {
    return referrer;
  }

  const ancestorOrigins = window.location.ancestorOrigins;
  const ancestorOrigin = ancestorOrigins?.[0];
  return ancestorOrigin && ancestorOrigin !== 'null' ? ancestorOrigin : '*';
}

function postToParent(message: ScratchPaintFrameMessage) {
  window.parent.postMessage(message, getParentTargetOrigin());
}

function ScratchPaintFrameApp() {
  const scratchStore = useMemo(() => createScratchPaintStore(), []);
  const [imageState, setImageState] = useState<ScratchPaintImageState | null>(null);

  useEffect(() => {
    let readyIntervalId = 0;

    const handleMessage = (event: MessageEvent) => {
      if (event.source !== window.parent || !isFrameLoadMessage(event.data)) {
        return;
      }
      if (readyIntervalId) {
        window.clearInterval(readyIntervalId);
        readyIntervalId = 0;
      }
      setImageState(event.data.payload);
    };

    window.addEventListener('message', handleMessage);
    postToParent({ type: SCRATCH_PAINT_FRAME_READY });
    readyIntervalId = window.setInterval(() => {
      postToParent({ type: SCRATCH_PAINT_FRAME_READY });
    }, 250);

    return () => {
      if (readyIntervalId) {
        window.clearInterval(readyIntervalId);
      }
      window.removeEventListener('message', handleMessage);
    };
  }, []);

  return (
    <div style={{ height: '100vh', width: '100vw', overflow: 'hidden' }}>
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
                postToParent({
                  type: SCRATCH_PAINT_FRAME_UPDATE,
                  imageId: imageState.imageId,
                  isVector,
                  image,
                  rotationCenterX,
                  rotationCenterY,
                });
              }}
              onUpdateName={(name) => {
                postToParent({
                  type: SCRATCH_PAINT_FRAME_RENAME,
                  imageId: imageState.imageId,
                  name,
                });
              }}
            />
          </IntlProvider>
        </ReduxProvider>
      ) : null}
    </div>
  );
}

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Root element not found');
}

createRoot(rootElement).render(<ScratchPaintFrameApp />);
