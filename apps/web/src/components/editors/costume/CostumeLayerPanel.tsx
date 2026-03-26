import type { CostumeDocument, CostumeLayer } from '@/types';
import { MAX_COSTUME_LAYERS, getCostumeLayerIndex } from '@/lib/costume/costumeDocument';
import {
  getCostumeLayerThumbnailSignature,
  renderCostumeLayerThumbnailToDataUrl,
} from '@/lib/costume/costumeDocumentRender';
import { LayerPanel } from '@/components/editors/shared/LayerPanel';

interface CostumeLayerPanelProps {
  document: CostumeDocument;
  activeLayer: CostumeLayer | null;
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
  onMergeDown: (layerId: string) => void;
  onRasterizeLayer: (layerId: string) => void;
}

export function CostumeLayerPanel(props: CostumeLayerPanelProps) {
  return (
    <LayerPanel
      document={props.document}
      activeLayer={props.activeLayer}
      maxLayers={MAX_COSTUME_LAYERS}
      getLayerIndex={(layerId) => getCostumeLayerIndex(props.document, layerId)}
      getLayerThumbnailSignature={(layer, size) => getCostumeLayerThumbnailSignature(layer as CostumeLayer, size)}
      renderLayerThumbnailToDataUrl={(layer, size) => renderCostumeLayerThumbnailToDataUrl(layer as CostumeLayer, size)}
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
      onMergeDown={props.onMergeDown}
      onRasterizeLayer={props.onRasterizeLayer}
      showMergeAction
      showRasterizeAction
      thumbnailTestId="costume-layer-thumbnail"
    />
  );
}
