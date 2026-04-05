import { memo, useCallback } from 'react';
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
  onReorderLayer: (layerId: string, targetIndex: number) => void;
  onToggleVisibility: (layerId: string) => void;
  onToggleLocked: (layerId: string) => void;
  onRenameLayer: (layerId: string, name: string) => void;
  onOpacityChange: (layerId: string, opacity: number) => void;
}

export const BackgroundLayerPanel = memo(function BackgroundLayerPanel(props: BackgroundLayerPanelProps) {
  const getLayerThumbnailSignature = useCallback((layer: BackgroundLayer, size: number) => (
    getBackgroundLayerThumbnailSignature(layer, props.document.chunkSize, size)
  ), [props.document.chunkSize]);

  const renderLayerThumbnailToDataUrl = useCallback((layer: BackgroundLayer, size: number) => (
    renderBackgroundLayerThumbnailToDataUrl(layer, props.document.chunkSize, size)
  ), [props.document.chunkSize]);

  return (
    <LayerPanel
      document={props.document}
      activeLayer={props.activeLayer}
      maxLayers={MAX_BACKGROUND_LAYERS}
      getLayerIndex={(layerId) => getBackgroundLayerIndex(props.document, layerId)}
      getLayerThumbnailSignature={(layer, size) => getLayerThumbnailSignature(layer as BackgroundLayer, size)}
      renderLayerThumbnailToDataUrl={(layer, size) => renderLayerThumbnailToDataUrl(layer as BackgroundLayer, size)}
      onSelectLayer={props.onSelectLayer}
      onAddBitmapLayer={props.onAddBitmapLayer}
      onAddVectorLayer={props.onAddVectorLayer}
      onDuplicateLayer={props.onDuplicateLayer}
      onDeleteLayer={props.onDeleteLayer}
      onReorderLayer={props.onReorderLayer}
      onToggleVisibility={props.onToggleVisibility}
      onToggleLocked={props.onToggleLocked}
      onRenameLayer={props.onRenameLayer}
      onOpacityChange={props.onOpacityChange}
    />
  );
});
