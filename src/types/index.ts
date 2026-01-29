// Project Types

export interface Project {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
  scenes: Scene[];
  globalVariables: Variable[];
  settings: ProjectSettings;
  components: ComponentDefinition[];
}

// Component Definition - the "master" that instances reference
export interface ComponentDefinition {
  id: string;
  name: string;
  blocklyXml: string;
  costumes: Costume[];
  currentCostumeIndex: number;
  physics: PhysicsConfig | null;
  sounds: Sound[];
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
  background: BackgroundConfig | null;
  objects: GameObject[];
  cameraConfig: CameraConfig;
  ground?: GroundConfig;
}

export interface GroundConfig {
  enabled: boolean;
  y: number;
  color: string;
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
  rotation: number;
  visible: boolean;
  layer: number;
  // If componentId is set, physics/blocklyXml/costumes/sounds come from the component
  componentId?: string;
  // Instance-level overrides (only used if componentId is not set)
  physics: PhysicsConfig | null;
  blocklyXml: string;
  costumes: Costume[];
  currentCostumeIndex: number;
  sounds: Sound[];
}

export interface Costume {
  id: string;
  name: string;
  assetId: string; // Reference to Asset
}

export interface Sound {
  id: string;
  name: string;
  assetId: string; // Reference to Asset
}

export interface PhysicsConfig {
  enabled: boolean;
  bodyType: 'dynamic' | 'static';
  gravityY: number;
  velocityX: number;
  velocityY: number;
  bounceX: number;
  bounceY: number;
  collideWorldBounds: boolean;
  immovable: boolean;
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

export interface Variable {
  id: string;
  name: string;
  type: 'number' | 'string' | 'boolean';
  defaultValue: number | string | boolean;
  scope: 'global' | 'local';
}

// Editor State Types

export interface EditorState {
  selectedObjectId: string | null;
  selectedSceneId: string | null;
  isPlaying: boolean;
  zoom: number;
  panX: number;
  panY: number;
}

// Helper function to create default objects

export function createDefaultProject(name: string): Project {
  const sceneId = crypto.randomUUID();
  return {
    id: crypto.randomUUID(),
    name,
    createdAt: new Date(),
    updatedAt: new Date(),
    scenes: [createDefaultScene(sceneId, 'Scene 1', 0)],
    globalVariables: [],
    components: [],
    settings: {
      canvasWidth: 800,
      canvasHeight: 600,
      backgroundColor: '#87CEEB',
    },
  };
}

export function createDefaultScene(id: string, name: string, order: number): Scene {
  return {
    id,
    name,
    order,
    background: { type: 'color', value: '#87CEEB' },
    objects: [],
    cameraConfig: {
      followTarget: null,
      bounds: null,
      zoom: 1,
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
  const defaultCostume: Costume = {
    id: crypto.randomUUID(),
    name: 'costume1',
    assetId: generateCircleCostume(color),
  };

  return {
    id: crypto.randomUUID(),
    name,
    spriteAssetId: null,
    x: 400,
    y: 300,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    visible: true,
    layer: 0,
    physics: null,
    blocklyXml: '',
    costumes: [defaultCostume],
    currentCostumeIndex: 0,
    sounds: [],
  };
}

export function createDefaultPhysicsConfig(): PhysicsConfig {
  return {
    enabled: true,
    bodyType: 'dynamic',
    gravityY: 300,
    velocityX: 0,
    velocityY: 0,
    bounceX: 0,
    bounceY: 0.2,
    collideWorldBounds: true,
    immovable: false,
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
  sounds: Sound[];
} {
  if (obj.componentId) {
    const component = components.find(c => c.id === obj.componentId);
    if (component) {
      return {
        blocklyXml: component.blocklyXml,
        costumes: component.costumes,
        currentCostumeIndex: component.currentCostumeIndex,
        physics: component.physics,
        sounds: component.sounds,
      };
    }
  }
  return {
    blocklyXml: obj.blocklyXml,
    costumes: obj.costumes,
    currentCostumeIndex: obj.currentCostumeIndex,
    physics: obj.physics,
    sounds: obj.sounds,
  };
}

// Pastel purple color for components
export const COMPONENT_COLOR = 'hsl(270, 70%, 75%)';
