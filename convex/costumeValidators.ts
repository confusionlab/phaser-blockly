import { v } from "convex/values";

export const boundsValidator = v.object({
  x: v.number(),
  y: v.number(),
  width: v.number(),
  height: v.number(),
});

export const costumeVectorDocumentValidator = v.object({
  engine: v.literal("fabric"),
  version: v.literal(1),
  fabricJson: v.string(),
});

export const costumeLayerBaseValidator = {
  id: v.string(),
  name: v.string(),
  visible: v.boolean(),
  locked: v.boolean(),
  opacity: v.number(),
  blendMode: v.literal("normal"),
  mask: v.null(),
  effects: v.array(v.null()),
};

export const costumeBitmapLayerValidator = v.object({
  ...costumeLayerBaseValidator,
  kind: v.literal("bitmap"),
  width: v.number(),
  height: v.number(),
  bitmap: v.object({
    assetId: v.union(v.string(), v.null()),
  }),
});

export const costumeVectorLayerValidator = v.object({
  ...costumeLayerBaseValidator,
  kind: v.literal("vector"),
  vector: costumeVectorDocumentValidator,
});

export const costumeLayerValidator = v.union(
  costumeBitmapLayerValidator,
  costumeVectorLayerValidator,
);

export const costumeDocumentValidator = v.object({
  version: v.literal(1),
  activeLayerId: v.string(),
  layers: v.array(costumeLayerValidator),
});
