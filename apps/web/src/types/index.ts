import { CURRENT_PROJECT_SCHEMA_VERSION } from '@/lib/persistence/schemaVersion';

// Project Types

export interface Project {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
  schemaVersion: number;
  scenes: Scene[];
  sceneFolders: SceneFolder[];
  messages: MessageDefinition[];
  globalVariables: Variable[];
  settings: ProjectSettings;
  components: ComponentDefinition[];
  componentFolders: ComponentFolder[];
}

export interface HierarchyFolder {
  id: string;
  name: string;
  parentId: string | null;
  order: number;
}

// Component Definition - the "master" that instances reference
export interface ComponentDefinition {
  id: string;
  name: string;
  folderId?: string | null;
  order?: number;
  blocklyXml: string;
  costumes: Costume[];
  currentCostumeIndex: number;
  physics: PhysicsConfig | null;
  collider: ColliderConfig | null;
  sounds: Sound[];
  localVariables?: Variable[];
}

export interface ProjectSettings {
  canvasWidth: number;
  canvasHeight: number;
  backgroundColor: string;
}

// Scene Types

export interface Scene {
  id: string;
  name: string;
  order: number;
  folderId?: string | null;
  background: BackgroundConfig | null;
  objects: GameObject[];
  objectFolders: SceneFolder[];
  cameraConfig: CameraConfig;
  ground?: GroundConfig;
  worldBoundary?: WorldBoundaryConfig;
}

export type SceneFolder = HierarchyFolder;
export type ComponentFolder = HierarchyFolder;

export interface GroundConfig {
  enabled: boolean;
  y: number;
  color: string;
}

export interface WorldPoint {
  x: number;
  y: number;
}

export interface WorldBoundaryConfig {
  enabled: boolean;
  points: WorldPoint[];
}

export interface CameraConfig {
  followTarget: string | null;
  bounds: { x: number; y: number; width: number; height: number } | null;
  zoom: number;
}

export interface BackgroundConfig {
  type: 'color' | 'image' | 'tiled';
  value: string;
  scrollFactor?: { x: number; y: number };
  version?: 1;
  chunkSize?: number;
  chunks?: Record<string, string>; // Derived runtime chunk cache; not persisted.
  softChunkLimit?: number;
  hardChunkLimit?: number;
  document?: BackgroundDocument;
}

export type BackgroundLayerKind = 'bitmap' | 'vector';
export type BackgroundLayerBlendMode = 'normal';
export type BackgroundLayerEffect = never;

export interface BackgroundBitmapContentRef {
  chunks: Record<string, string>;
}

export interface BackgroundVectorDocument {
  engine: 'fabric';
  version: 1;
  fabricJson: string;
}

export interface BackgroundLayerBase {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  opacity: number;
  blendMode: BackgroundLayerBlendMode;
  mask: null;
  effects: BackgroundLayerEffect[];
}

export interface BackgroundBitmapLayer extends BackgroundLayerBase {
  kind: 'bitmap';
  bitmap: BackgroundBitmapContentRef;
}

export interface BackgroundVectorLayer extends BackgroundLayerBase {
  kind: 'vector';
  vector: BackgroundVectorDocument;
}

export type BackgroundLayer = BackgroundBitmapLayer | BackgroundVectorLayer;

export interface BackgroundDocument {
  version: 1;
  activeLayerId: string;
  chunkSize: number;
  softChunkLimit: number;
  hardChunkLimit: number;
  layers: BackgroundLayer[];
}

// GameObject Types

export interface GameObject {
  id: string;
  name: string;
  spriteAssetId: string | null;
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  lockScaleProportions?: boolean;
  rotation: number;
  visible: boolean;
  parentId: string | null;
  order: number;
  // Legacy fields retained for migration compatibility.
  layer?: number;
  folderId?: string | null;
  // If componentId is set, physics/blocklyXml/costumes/sounds/collider come from the component
  componentId?: string;
  // Instance-level overrides (only used if componentId is not set)
  physics: PhysicsConfig | null;
  collider: ColliderConfig | null;
  blocklyXml: string;
  costumes: Costume[];
  currentCostumeIndex: number;
  sounds: Sound[];
  // Local variables for this object
  localVariables: Variable[];
}

export interface CostumeBounds {
  x: number;      // Left edge of visible content
  y: number;      // Top edge of visible content
  width: number;  // Width of visible content
  height: number; // Height of visible content
}

export interface CostumeAssetFrame {
  x: number;
  y: number;
  width: number;
  height: number;
  sourceWidth: number;
  sourceHeight: number;
}

export type CostumeLayerKind = 'bitmap' | 'vector';
export type CostumeLayerBlendMode = 'normal';
export type CostumeLayerEffect = never;

export interface CostumeBitmapContentRef {
  assetId: string | null;
  assetFrame?: CostumeAssetFrame;
  persistedAssetId?: string;
}

export interface CostumeVectorDocument {
  engine: 'fabric';
  version: 1;
  fabricJson: string;
}

export interface CostumeLayerBase {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  opacity: number;
  blendMode: CostumeLayerBlendMode;
  mask: null;
  effects: CostumeLayerEffect[];
}

export interface CostumeBitmapLayer extends CostumeLayerBase {
  kind: 'bitmap';
  width: number;
  height: number;
  bitmap: CostumeBitmapContentRef;
}

export interface CostumeVectorLayer extends CostumeLayerBase {
  kind: 'vector';
  vector: CostumeVectorDocument;
}

export type CostumeLayer = CostumeBitmapLayer | CostumeVectorLayer;

export interface CostumeDocument {
  version: 1;
  activeLayerId: string;
  layers: CostumeLayer[];
}

export type AnimatedCostumePlayback = 'play-once' | 'loop' | 'ping-pong';

export interface AnimatedCostumeCelBase {
  id: string;
  startFrame: number;
  durationFrames: number;
}

export interface AnimatedCostumeBitmapCel extends AnimatedCostumeCelBase {
  kind: 'bitmap';
  bitmap: CostumeBitmapContentRef;
}

export interface AnimatedCostumeVectorCel extends AnimatedCostumeCelBase {
  kind: 'vector';
  vector: CostumeVectorDocument;
}

export type AnimatedCostumeCel =
  | AnimatedCostumeBitmapCel
  | AnimatedCostumeVectorCel;

export interface AnimatedCostumeTrackBase {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  opacity: number;
  blendMode: CostumeLayerBlendMode;
  mask: null;
  effects: CostumeLayerEffect[];
}

export interface AnimatedCostumeBitmapTrack extends AnimatedCostumeTrackBase {
  kind: 'bitmap';
  width: number;
  height: number;
  cels: AnimatedCostumeBitmapCel[];
}

export interface AnimatedCostumeVectorTrack extends AnimatedCostumeTrackBase {
  kind: 'vector';
  cels: AnimatedCostumeVectorCel[];
}

export type AnimatedCostumeTrack =
  | AnimatedCostumeBitmapTrack
  | AnimatedCostumeVectorTrack;

export interface AnimatedCostumeClip {
  version: 1;
  totalFrames: number;
  fps: number;
  playback: AnimatedCostumePlayback;
  activeTrackId: string;
  tracks: AnimatedCostumeTrack[];
}

/**
 * @deprecated Use CostumeLayerKind for active layer kind instead.
 */
export type CostumeEditorMode = CostumeLayerKind;

export interface CostumeBase {
  id: string;
  name: string;
  assetId: string; // Derived flattened runtime preview source
  bounds?: CostumeBounds; // Derived visible pixel bounds from the layered document
  assetFrame?: CostumeAssetFrame; // Derived placement metadata for the flattened runtime preview
}

export interface StaticCostume extends CostumeBase {
  kind: 'static';
  document: CostumeDocument; // Canonical source of truth for persisted artwork
}

export interface AnimatedCostume extends CostumeBase {
  kind: 'animated';
  document: CostumeDocument; // Derived poster frame document for previews and incremental editor consumers
  clip: AnimatedCostumeClip; // Canonical source of truth for persisted animation
}

export type Costume = StaticCostume | AnimatedCostume;

export interface Sound {
  id: string;
  name: string;
  assetId: string; // Reference to Asset
  // Trimming: times in seconds (optional, defaults to full audio)
  trimStart?: number;
  trimEnd?: number;
  // Duration of the original audio in seconds (cached for performance)
  duration?: number;
}

export interface ColliderConfig {
  type: 'none' | 'box' | 'circle' | 'capsule';
  // Offset from object origin (center) in canvas space
  offsetX: number;
  offsetY: number;
  // Dimensions (interpretation depends on type)
  width: number;   // box width, capsule width
  height: number;  // box height, capsule height
  radius: number;  // circle radius
}

export interface PhysicsConfig {
  enabled: boolean;
  bodyType: 'dynamic' | 'static';
  gravityY: number;
  velocityX: number;
  velocityY: number;
  bounce: number;
  friction: number;
  allowRotation: boolean;
}

// Asset Types

export interface Asset {
  id: string;
  name: string;
  type: 'sprite' | 'background' | 'sound';
  data: Blob;
  thumbnail?: string;
  frameWidth?: number;
  frameHeight?: number;
}

// Reusable Object Types

export interface ReusableObject {
  id: string;
  name: string;
  thumbnail: string;
  spriteAssetId: string | null;
  defaultPhysics: PhysicsConfig | null;
  blocklyXml: string;
  createdAt: Date;
  tags: string[];
}

// Variable Types

export type VariableType = 'string' | 'number' | 'boolean';
export type VariableCardinality = 'single' | 'array';
export type VariableScalarValue = number | string | boolean;
export type VariableValue = VariableScalarValue | VariableScalarValue[];

export interface Variable {
  id: string;
  name: string;
  type: VariableType;
  cardinality?: VariableCardinality;
  defaultValue: VariableValue;
  scope: 'global' | 'local';
  // For local variables, which object they belong to (optional, for filtering)
  objectId?: string;
}

export interface MessageDefinition {
  id: string;
  name: string;
}

// Editor State Types

export interface EditorState {
  selectedObjectId: string | null;
  selectedSceneId: string | null;
  isPlaying: boolean;
}

// Helper function to create default objects

export function createDefaultProject(name: string): Project {
  const sceneId = crypto.randomUUID();
  return {
    id: crypto.randomUUID(),
    name,
    createdAt: new Date(),
    updatedAt: new Date(),
    schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
    scenes: [createDefaultScene(sceneId, 'Scene 1', 0)],
    sceneFolders: [],
    messages: [],
    globalVariables: [],
    components: [],
    componentFolders: [],
    settings: {
      canvasWidth: 800,
      canvasHeight: 600,
      backgroundColor: '#87CEEB',
    },
  };
}

export function createDefaultMessage(name: string): MessageDefinition {
  return {
    id: crypto.randomUUID(),
    name,
  };
}

export function createDefaultScene(id: string, name: string, order: number): Scene {
  return {
    id,
    name,
    order,
    folderId: null,
    background: { type: 'color', value: '#87CEEB' },
    objects: [],
    objectFolders: [],
    cameraConfig: {
      followTarget: null,
      bounds: null,
      zoom: 1,
    },
    worldBoundary: {
      enabled: false,
      points: [],
    },
  };
}

// Generate a simple colored circle SVG as a data URL
function generateCircleCostume(color: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
    <circle cx="32" cy="32" r="28" fill="${color}" stroke="#333" stroke-width="2"/>
  </svg>`;
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}

// Generate a random pastel color
function randomPastelColor(): string {
  const hue = Math.floor(Math.random() * 360);
  return `hsl(${hue}, 70%, 70%)`;
}

export function createDefaultGameObject(name: string): GameObject {
  const color = randomPastelColor();
  const initialLayerId = crypto.randomUUID();
  const defaultCostume: Costume = {
    id: crypto.randomUUID(),
    name: 'costume1',
    kind: 'static',
    assetId: generateCircleCostume(color),
    document: {
      version: 1,
      activeLayerId: initialLayerId,
      layers: [
        {
          id: initialLayerId,
          name: 'Layer 1',
          kind: 'bitmap',
          visible: true,
          locked: false,
          opacity: 1,
          blendMode: 'normal',
          mask: null,
          effects: [],
          width: 1024,
          height: 1024,
          bitmap: {
            assetId: generateCircleCostume(color),
          },
        },
      ],
    },
  };

  return {
    id: crypto.randomUUID(),
    name,
    spriteAssetId: null,
    x: 0,
    y: 0,
    scaleX: 1,
    scaleY: 1,
    lockScaleProportions: true,
    rotation: 0,
    visible: true,
    parentId: null,
    order: 0,
    layer: 0,
    folderId: null,
    physics: null,
    collider: null,
    blocklyXml: '',
    costumes: [defaultCostume],
    currentCostumeIndex: 0,
    sounds: [],
    localVariables: [],
  };
}

export function createDefaultColliderConfig(type: ColliderConfig['type'] = 'circle'): ColliderConfig {
  return {
    type,
    offsetX: 0,
    offsetY: 0,
    width: 64,
    height: 64,
    radius: 32,
  };
}

export function createDefaultPhysicsConfig(): PhysicsConfig {
  return {
    enabled: true,
    bodyType: 'dynamic',
    gravityY: 1, // Matter.js gravity scale: 1 = normal gravity, 0 = none, 2 = double
    velocityX: 0,
    velocityY: 0,
    bounce: 0.2,
    friction: 0.1, // Surface friction: 0 = frictionless, 1 = very grippy
    allowRotation: false,
  };
}

// Helper to get effective properties of a GameObject (resolving component reference)
export function getEffectiveObjectProps(
  obj: GameObject,
  components: ComponentDefinition[]
): {
  blocklyXml: string;
  costumes: Costume[];
  currentCostumeIndex: number;
  physics: PhysicsConfig | null;
  collider: ColliderConfig | null;
  sounds: Sound[];
  localVariables: Variable[];
} {
  if (obj.componentId) {
    const component = components.find(c => c.id === obj.componentId);
    if (component) {
      return {
        blocklyXml: component.blocklyXml,
        costumes: component.costumes,
        currentCostumeIndex: component.currentCostumeIndex,
        physics: component.physics,
        collider: component.collider ?? null,
        sounds: component.sounds,
        localVariables: component.localVariables ?? [],
      };
    }
  }
  return {
    blocklyXml: obj.blocklyXml,
    costumes: obj.costumes,
    currentCostumeIndex: obj.currentCostumeIndex,
    physics: obj.physics,
    collider: obj.collider,
    sounds: obj.sounds,
    localVariables: obj.localVariables ?? [],
  };
}

// Pastel purple color for components
export const COMPONENT_COLOR = 'hsl(270, 70%, 75%)';
