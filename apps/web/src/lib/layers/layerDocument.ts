export interface SharedLayerDocumentLayer {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  opacity: number;
}

export interface SharedLayerDocument<TLayer extends SharedLayerDocumentLayer> {
  activeLayerId: string;
  layers: TLayer[];
}

export function getDocumentLayerById<TLayer extends SharedLayerDocumentLayer>(
  document: SharedLayerDocument<TLayer> | null | undefined,
  layerId: string | null | undefined,
): TLayer | null {
  if (!document || !layerId) {
    return null;
  }
  return document.layers.find((layer) => layer.id === layerId) ?? null;
}

export function getActiveDocumentLayer<TLayer extends SharedLayerDocumentLayer>(
  document: SharedLayerDocument<TLayer> | null | undefined,
): TLayer | null {
  if (!document) {
    return null;
  }
  return getDocumentLayerById(document, document.activeLayerId) ?? document.layers[0] ?? null;
}

export function getDocumentLayerIndex<TLayer extends SharedLayerDocumentLayer>(
  document: SharedLayerDocument<TLayer> | null | undefined,
  layerId: string | null | undefined,
): number {
  if (!document || !layerId) {
    return -1;
  }
  return document.layers.findIndex((layer) => layer.id === layerId);
}

export function setActiveDocumentLayer<TLayer extends SharedLayerDocumentLayer, TDocument extends SharedLayerDocument<TLayer>>(
  document: TDocument,
  layerId: string,
  cloneDocument: (document: TDocument) => TDocument,
): TDocument {
  if (!document.layers.some((layer) => layer.id === layerId)) {
    return cloneDocument(document);
  }

  const nextDocument = cloneDocument(document);
  nextDocument.activeLayerId = layerId;
  return nextDocument;
}

export function insertDocumentLayerAfterActive<TLayer extends SharedLayerDocumentLayer, TDocument extends SharedLayerDocument<TLayer>>(
  document: TDocument,
  layer: TLayer,
  options: {
    cloneDocument: (document: TDocument) => TDocument;
    cloneLayer: (layer: TLayer) => TLayer;
    maxLayers: number;
  },
): TDocument {
  const nextDocument = options.cloneDocument(document);
  const activeLayerIndex = getDocumentLayerIndex(nextDocument, nextDocument.activeLayerId);
  const insertionIndex = activeLayerIndex >= 0 ? activeLayerIndex + 1 : nextDocument.layers.length;
  const nextLayers = [...nextDocument.layers];
  nextLayers.splice(Math.min(insertionIndex, nextLayers.length), 0, options.cloneLayer(layer));
  nextDocument.layers = nextLayers.slice(0, options.maxLayers);
  nextDocument.activeLayerId = layer.id;
  return nextDocument;
}

export function duplicateDocumentLayer<TLayer extends SharedLayerDocumentLayer, TDocument extends SharedLayerDocument<TLayer>>(
  document: TDocument,
  layerId: string,
  options: {
    cloneDocument: (document: TDocument) => TDocument;
    cloneLayer: (layer: TLayer) => TLayer;
    createLayerId: () => string;
    maxLayers: number;
  },
): TDocument | null {
  if (document.layers.length >= options.maxLayers) {
    return null;
  }

  const layer = getDocumentLayerById(document, layerId);
  if (!layer) {
    return null;
  }

  const duplicate = options.cloneLayer(layer);
  duplicate.id = options.createLayerId();
  duplicate.name = `${layer.name} copy`;

  const nextDocument = options.cloneDocument(document);
  const layerIndex = getDocumentLayerIndex(nextDocument, layerId);
  const nextLayers = [...nextDocument.layers];
  nextLayers.splice(layerIndex + 1, 0, duplicate);
  nextDocument.layers = nextLayers;
  nextDocument.activeLayerId = duplicate.id;
  return nextDocument;
}

export function removeDocumentLayer<TLayer extends SharedLayerDocumentLayer, TDocument extends SharedLayerDocument<TLayer>>(
  document: TDocument,
  layerId: string,
  cloneDocument: (document: TDocument) => TDocument,
): TDocument | null {
  if (document.layers.length <= 1) {
    return null;
  }

  const layerIndex = getDocumentLayerIndex(document, layerId);
  if (layerIndex < 0) {
    return null;
  }

  const nextDocument = cloneDocument(document);
  nextDocument.layers = nextDocument.layers.filter((layer) => layer.id !== layerId);
  if (nextDocument.activeLayerId === layerId) {
    nextDocument.activeLayerId = nextDocument.layers[Math.max(0, layerIndex - 1)]?.id ?? nextDocument.layers[0]?.id ?? '';
  }
  return nextDocument;
}

export function moveDocumentLayer<TLayer extends SharedLayerDocumentLayer, TDocument extends SharedLayerDocument<TLayer>>(
  document: TDocument,
  layerId: string,
  direction: 'up' | 'down',
  cloneDocument: (document: TDocument) => TDocument,
): TDocument | null {
  const layerIndex = getDocumentLayerIndex(document, layerId);
  if (layerIndex < 0) {
    return null;
  }

  const targetIndex = direction === 'up' ? layerIndex + 1 : layerIndex - 1;
  if (targetIndex < 0 || targetIndex >= document.layers.length) {
    return null;
  }

  const nextDocument = cloneDocument(document);
  const nextLayers = [...nextDocument.layers];
  const [layer] = nextLayers.splice(layerIndex, 1);
  nextLayers.splice(targetIndex, 0, layer);
  nextDocument.layers = nextLayers;
  return nextDocument;
}
