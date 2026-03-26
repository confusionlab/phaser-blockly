import type { CostumeBitmapLayer, CostumeLayer, CostumeVectorLayer } from '@/types';
import { COSTUME_CANVAS_SIZE, isVectorCostumeLayer } from './costumeDocument';
import { optimizeCostumeRasterCanvas } from './costumeAssetOptimization';
import {
  renderCostumeLayerStackToCanvas,
  renderCostumeLayerToCanvas,
} from './costumeDocumentRender';

function createBitmapLayerFromCanvas(
  template: CostumeLayer,
  sourceCanvas: HTMLCanvasElement,
  options?: {
    opacity?: number;
    visible?: boolean;
  },
): CostumeBitmapLayer {
  const optimized = optimizeCostumeRasterCanvas(sourceCanvas);
  return {
    id: template.id,
    name: template.name,
    visible: options?.visible ?? template.visible,
    locked: template.locked,
    opacity: options?.opacity ?? template.opacity,
    blendMode: template.blendMode,
    mask: null,
    effects: [...template.effects],
    kind: 'bitmap',
    width: COSTUME_CANVAS_SIZE,
    height: COSTUME_CANVAS_SIZE,
    bitmap: {
      assetId: optimized.dataUrl,
      assetFrame: optimized.assetFrame,
    },
  };
}

function canMergeVectorsWithoutFlattening(
  lowerLayer: CostumeVectorLayer,
  upperLayer: CostumeVectorLayer,
): boolean {
  return (
    lowerLayer.visible &&
    upperLayer.visible &&
    lowerLayer.opacity >= 0.999 &&
    upperLayer.opacity >= 0.999
  );
}

function mergeOpaqueVectorLayers(
  lowerLayer: CostumeVectorLayer,
  upperLayer: CostumeVectorLayer,
): CostumeVectorLayer | null {
  try {
    const lowerJson = JSON.parse(lowerLayer.vector.fabricJson) as { objects?: unknown[]; [key: string]: unknown };
    const upperJson = JSON.parse(upperLayer.vector.fabricJson) as { objects?: unknown[]; [key: string]: unknown };
    return {
      ...lowerLayer,
      vector: {
        engine: 'fabric',
        version: 1,
        fabricJson: JSON.stringify({
          ...lowerJson,
          objects: [
            ...(Array.isArray(lowerJson.objects) ? lowerJson.objects : []),
            ...(Array.isArray(upperJson.objects) ? upperJson.objects : []),
          ],
        }),
      },
    };
  } catch {
    return null;
  }
}

export async function rasterizeCostumeLayer(layer: CostumeLayer): Promise<CostumeBitmapLayer | null> {
  const layerCanvas = await renderCostumeLayerToCanvas(layer);
  if (!layerCanvas) {
    return null;
  }
  return createBitmapLayerFromCanvas(layer, layerCanvas);
}

export async function mergeCostumeLayers(
  lowerLayer: CostumeLayer,
  upperLayer: CostumeLayer,
): Promise<CostumeLayer> {
  if (
    isVectorCostumeLayer(lowerLayer) &&
    isVectorCostumeLayer(upperLayer) &&
    canMergeVectorsWithoutFlattening(lowerLayer, upperLayer)
  ) {
    const mergedVectorLayer = mergeOpaqueVectorLayers(lowerLayer, upperLayer);
    if (mergedVectorLayer) {
      return mergedVectorLayer;
    }
  }

  const mergedCanvas = await renderCostumeLayerStackToCanvas([lowerLayer, upperLayer]);
  return createBitmapLayerFromCanvas(lowerLayer, mergedCanvas, {
    opacity: 1,
    visible: lowerLayer.visible || upperLayer.visible,
  });
}
