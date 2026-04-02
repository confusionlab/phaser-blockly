import { v } from "convex/values";
import { boundsValidator, costumeDocumentValidator } from "./costumeValidators";

export const hierarchyFolderValidator = v.object({
  id: v.string(),
  name: v.string(),
  parentId: v.union(v.string(), v.null()),
  order: v.number(),
});

export const physicsValidator = v.object({
  enabled: v.boolean(),
  bodyType: v.union(v.literal("dynamic"), v.literal("static")),
  gravityY: v.number(),
  velocityX: v.number(),
  velocityY: v.number(),
  bounce: v.number(),
  friction: v.number(),
  allowRotation: v.boolean(),
});

export const colliderValidator = v.object({
  type: v.union(
    v.literal("none"),
    v.literal("box"),
    v.literal("circle"),
    v.literal("capsule"),
  ),
  offsetX: v.number(),
  offsetY: v.number(),
  width: v.number(),
  height: v.number(),
  radius: v.number(),
});

export const variableValidator = v.object({
  id: v.string(),
  name: v.string(),
  type: v.union(
    v.literal("string"),
    v.literal("number"),
    v.literal("boolean"),
  ),
  cardinality: v.optional(v.union(v.literal("single"), v.literal("array"))),
  defaultValue: v.union(
    v.number(),
    v.string(),
    v.boolean(),
    v.array(v.union(v.number(), v.string(), v.boolean())),
  ),
  scope: v.union(v.literal("global"), v.literal("local")),
  objectId: v.optional(v.string()),
});

export const soundValidator = v.object({
  id: v.string(),
  name: v.string(),
  assetId: v.string(),
  trimStart: v.optional(v.number()),
  trimEnd: v.optional(v.number()),
  duration: v.optional(v.number()),
});

export const backgroundScrollFactorValidator = v.object({
  x: v.number(),
  y: v.number(),
});

export const backgroundBitmapContentRefValidator = v.object({
  chunks: v.record(v.string(), v.string()),
});

export const backgroundVectorDocumentValidator = v.object({
  engine: v.literal("fabric"),
  version: v.literal(1),
  fabricJson: v.string(),
});

export const backgroundLayerBaseValidator = {
  id: v.string(),
  name: v.string(),
  visible: v.boolean(),
  locked: v.boolean(),
  opacity: v.number(),
  blendMode: v.literal("normal"),
  mask: v.null(),
  effects: v.array(v.null()),
};

export const backgroundBitmapLayerValidator = v.object({
  ...backgroundLayerBaseValidator,
  kind: v.literal("bitmap"),
  bitmap: backgroundBitmapContentRefValidator,
});

export const backgroundVectorLayerValidator = v.object({
  ...backgroundLayerBaseValidator,
  kind: v.literal("vector"),
  vector: backgroundVectorDocumentValidator,
});

export const backgroundDocumentValidator = v.object({
  version: v.literal(1),
  activeLayerId: v.string(),
  chunkSize: v.number(),
  softChunkLimit: v.number(),
  hardChunkLimit: v.number(),
  layers: v.array(v.union(backgroundBitmapLayerValidator, backgroundVectorLayerValidator)),
});

export const backgroundValidator = v.object({
  type: v.union(v.literal("color"), v.literal("image"), v.literal("tiled")),
  value: v.string(),
  scrollFactor: v.optional(backgroundScrollFactorValidator),
  version: v.optional(v.literal(1)),
  chunkSize: v.optional(v.number()),
  chunks: v.optional(v.record(v.string(), v.string())),
  softChunkLimit: v.optional(v.number()),
  hardChunkLimit: v.optional(v.number()),
  document: v.optional(backgroundDocumentValidator),
});

export const cameraConfigValidator = v.object({
  followTarget: v.union(v.string(), v.null()),
  bounds: v.union(
    v.object({
      x: v.number(),
      y: v.number(),
      width: v.number(),
      height: v.number(),
    }),
    v.null(),
  ),
  zoom: v.number(),
});

export const groundConfigValidator = v.object({
  enabled: v.boolean(),
  y: v.number(),
  color: v.string(),
});

export const worldPointValidator = v.object({
  x: v.number(),
  y: v.number(),
});

export const worldBoundaryConfigValidator = v.object({
  enabled: v.boolean(),
  points: v.array(worldPointValidator),
});

export const costumeValidator = v.object({
  id: v.string(),
  name: v.string(),
  bounds: v.optional(boundsValidator),
  document: costumeDocumentValidator,
});

export const componentDefinitionValidator = v.object({
  id: v.string(),
  name: v.string(),
  folderId: v.optional(v.union(v.string(), v.null())),
  order: v.optional(v.number()),
  blocklyXml: v.string(),
  costumes: v.array(costumeValidator),
  currentCostumeIndex: v.number(),
  physics: v.union(physicsValidator, v.null()),
  collider: v.union(colliderValidator, v.null()),
  sounds: v.array(soundValidator),
  localVariables: v.optional(v.array(variableValidator)),
});

export const gameObjectValidator = v.object({
  id: v.string(),
  name: v.string(),
  spriteAssetId: v.union(v.string(), v.null()),
  x: v.number(),
  y: v.number(),
  scaleX: v.number(),
  scaleY: v.number(),
  lockScaleProportions: v.optional(v.boolean()),
  rotation: v.number(),
  visible: v.boolean(),
  parentId: v.union(v.string(), v.null()),
  order: v.number(),
  layer: v.optional(v.number()),
  folderId: v.optional(v.union(v.string(), v.null())),
  componentId: v.optional(v.string()),
  physics: v.union(physicsValidator, v.null()),
  collider: v.union(colliderValidator, v.null()),
  blocklyXml: v.string(),
  costumes: v.array(costumeValidator),
  currentCostumeIndex: v.number(),
  sounds: v.array(soundValidator),
  localVariables: v.array(variableValidator),
});

export const sceneTemplateValidator = v.object({
  scene: v.object({
    id: v.string(),
    name: v.string(),
    order: v.number(),
    folderId: v.optional(v.union(v.string(), v.null())),
    background: v.union(backgroundValidator, v.null()),
    objects: v.array(gameObjectValidator),
    objectFolders: v.array(hierarchyFolderValidator),
    cameraConfig: cameraConfigValidator,
    ground: v.optional(groundConfigValidator),
    worldBoundary: v.optional(worldBoundaryConfigValidator),
  }),
  components: v.array(componentDefinitionValidator),
  componentFolders: v.array(hierarchyFolderValidator),
});

type LegacyNumericVariableType = "integer" | "float";
type TemplateVariableScalarValue = number | string | boolean;
type TemplateVariableValue = TemplateVariableScalarValue | TemplateVariableScalarValue[];

type LegacyTemplateVariable = Omit<typeof variableValidator.type, "type" | "defaultValue"> & {
  type: typeof variableValidator.type["type"] | LegacyNumericVariableType;
  defaultValue: unknown;
};

function coerceLegacyNumericTemplateValue(
  cardinality: typeof variableValidator.type["cardinality"],
  value: unknown,
): TemplateVariableValue {
  const coerceScalar = (entry: unknown): number => {
    const numeric = Number(entry);
    return Number.isFinite(numeric) ? numeric : 0;
  };

  if (cardinality === "array") {
    if (Array.isArray(value)) {
      return value.map((entry) => coerceScalar(entry));
    }
    if (value === null || value === undefined) {
      return [];
    }
    return [coerceScalar(value)];
  }

  return coerceScalar(value);
}

export function migrateLegacyTemplateVariables(
  variables: LegacyTemplateVariable[] | undefined,
): Array<typeof variableValidator.type> {
  return Array.isArray(variables)
    ? variables.map((variable) => {
        if (variable.type !== "integer" && variable.type !== "float") {
          return variable as typeof variableValidator.type;
        }

        return {
          ...variable,
          type: "number",
          defaultValue: coerceLegacyNumericTemplateValue(variable.cardinality, variable.defaultValue),
        };
      })
    : [];
}

export function migrateLegacySceneTemplate(
  template: typeof sceneTemplateValidator.type,
): typeof sceneTemplateValidator.type {
  return {
    ...template,
    scene: {
      ...template.scene,
      objects: template.scene.objects.map((object) => ({
        ...object,
        localVariables: migrateLegacyTemplateVariables(object.localVariables),
      })),
    },
    components: template.components.map((component) => ({
      ...component,
      localVariables: migrateLegacyTemplateVariables(component.localVariables),
    })),
  };
}
