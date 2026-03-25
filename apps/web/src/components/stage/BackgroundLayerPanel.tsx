import type { BackgroundDocument, BackgroundLayer } from '@/types';
import { LayerPanel } from '@/components/editors/shared/LayerPanel';
import { MAX_BACKGROUND_LAYERS, getBackgroundLayerIndex } from '@/lib/background/backgroundDocument';
import {
  getBackgroundLayerThumbnailSignature,
  renderBackgroundLayerThumbnailToDataUrl,
} from '@/lib/background/backgroundDocumentRender';

interface BackgroundLayerPanelProps {
  document: BackgroundDocument;
  activeLayer: BackgroundLayer | null;
  onSelectLayer: (layerId: string) => void;
  onAddBitmapLayer: () => void;
  onAddVectorLayer: () => void;
  onDuplicateLayer: (layerId: string) => void;
  onDeleteLayer: (layerId: string) => void;
  onMoveLayer: (layerId: string, direction: 'up' | 'down') => void;
  onToggleVisibility: (layerId: string) => void;
  onToggleLocked: (layerId: string) => void;
  onRenameLayer: (layerId: string, name: string) => void;
  onOpacityChange: (layerId: string, opacity: number) => void;
}

export function BackgroundLayerPanel(props: BackgroundLayerPanelProps) {
  return (
    <LayerPanel
      document={props.document}
      activeLayer={props.activeLayer}
      maxLayers={MAX_BACKGROUND_LAYERS}
      getLayerIndex={(layerId) => getBackgroundLayerIndex(props.document, layerId)}
      getLayerThumbnailSignature={(layer, size) => (
        getBackgroundLayerThumbnailSignature(layer as BackgroundLayer, props.document.chunkSize, size)
      )}
      renderLayerThumbnailToDataUrl={(layer, size) => (
        renderBackgroundLayerThumbnailToDataUrl(layer as BackgroundLayer, props.document.chunkSize, size)
      )}
      onSelectLayer={props.onSelectLayer}
      onAddBitmapLayer={props.onAddBitmapLayer}
      onAddVectorLayer={props.onAddVectorLayer}
      onDuplicateLayer={props.onDuplicateLayer}
      onDeleteLayer={props.onDeleteLayer}
      onMoveLayer={props.onMoveLayer}
      onToggleVisibility={props.onToggleVisibility}
      onToggleLocked={props.onToggleLocked}
      onRenameLayer={props.onRenameLayer}
      onOpacityChange={props.onOpacityChange}
    />
  );
}
