import {
  cloneBackgroundDocument,
  ensureBackgroundDocument,
  getTiledBackgroundDocument,
} from '@/lib/background/backgroundDocument';
import { normalizeChunkDataMap } from '@/lib/background/chunkStore';
import {
  cloneAnimatedCostumeClip,
  cloneCostumeDocument,
  ensureCostumeDocument,
  isBitmapCostumeLayer,
  sanitizeCostume,
} from '@/lib/costume/costumeDocument';
import type {
  AnimatedCostume,
  AnimatedCostumeBitmapCel,
  AnimatedCostumeBitmapTrack,
  AnimatedCostumeClip,
  AnimatedCostumeVectorCel,
  AnimatedCostumeVectorTrack,
  BackgroundConfig,
  BackgroundDocument,
  ComponentDefinition,
  Costume,
  CostumeBitmapContentRef,
  CostumeBitmapLayer,
  CostumeDocument,
  CostumeLayer,
  GameObject,
  Project,
  Scene,
  StaticCostume,
} from '@/types';

export type RuntimeProjectData = Omit<Project, 'id' | 'name' | 'createdAt' | 'updatedAt'>;

export type PersistedCostumeBitmapContentRef = Omit<CostumeBitmapContentRef, 'persistedAssetId'>;

export type PersistedCostumeBitmapLayer = Omit<CostumeBitmapLayer, 'bitmap'> & {
  bitmap: PersistedCostumeBitmapContentRef;
};

export type PersistedCostumeLayer =
  | PersistedCostumeBitmapLayer
  | Exclude<CostumeLayer, CostumeBitmapLayer>;

export type PersistedCostumeDocument = Omit<CostumeDocument, 'layers'> & {
  layers: PersistedCostumeLayer[];
};

export type PersistedAnimatedCostumeBitmapCel = Omit<AnimatedCostumeBitmapCel, 'bitmap'> & {
  bitmap: PersistedCostumeBitmapContentRef;
};

export type PersistedAnimatedCostumeVectorCel = AnimatedCostumeVectorCel;

export type PersistedAnimatedCostumeCel =
  | PersistedAnimatedCostumeBitmapCel
  | PersistedAnimatedCostumeVectorCel;

export type PersistedAnimatedCostumeBitmapTrack = Omit<AnimatedCostumeBitmapTrack, 'cels'> & {
  cels: PersistedAnimatedCostumeBitmapCel[];
};

export type PersistedAnimatedCostumeVectorTrack = Omit<AnimatedCostumeVectorTrack, 'cels'> & {
  cels: PersistedAnimatedCostumeVectorCel[];
};

export type PersistedAnimatedCostumeTrack =
  | PersistedAnimatedCostumeBitmapTrack
  | PersistedAnimatedCostumeVectorTrack;

export type PersistedAnimatedCostumeClip = Omit<AnimatedCostumeClip, 'tracks'> & {
  tracks: PersistedAnimatedCostumeTrack[];
};

export type PersistedStaticCostume = Omit<StaticCostume, 'assetId' | 'bounds' | 'assetFrame' | 'document'> & {
  document: PersistedCostumeDocument;
};

export type PersistedAnimatedCostume = Omit<AnimatedCostume, 'assetId' | 'bounds' | 'assetFrame' | 'document' | 'clip'> & {
  document: PersistedCostumeDocument;
  clip: PersistedAnimatedCostumeClip;
};

export type PersistedCostume = PersistedStaticCostume | PersistedAnimatedCostume;

export type PersistedBackgroundConfig = Omit<BackgroundConfig, 'chunks'> & {
  document?: BackgroundDocument;
};

export type PersistedGameObject = Omit<GameObject, 'costumes'> & {
  costumes: PersistedCostume[];
};

export type PersistedScene = Omit<Scene, 'objects' | 'background'> & {
  background: PersistedBackgroundConfig | null;
  objects: PersistedGameObject[];
};

export type PersistedComponentDefinition = Omit<ComponentDefinition, 'costumes'> & {
  costumes: PersistedCostume[];
};

export type PersistedProjectData = Omit<RuntimeProjectData, 'scenes' | 'components'> & {
  scenes: PersistedScene[];
  components: PersistedComponentDefinition[];
};

type LegacyCostumePersistenceShape = PersistedCostume & {
  assetId?: unknown;
  bounds?: unknown;
  assetFrame?: unknown;
  persistedAssetId?: unknown;
  renderSignature?: unknown;
};

type LegacyBackgroundPersistenceShape = PersistedBackgroundConfig & {
  chunks?: unknown;
};

function toTypedBackgroundConfig(background: LegacyBackgroundPersistenceShape): BackgroundConfig {
  const chunks = normalizeChunkDataMap(
    background.chunks && typeof background.chunks === 'object'
      ? background.chunks as Record<string, string>
      : undefined,
  );
  const {
    chunks: _chunks,
    ...rest
  } = background;

  return {
    ...rest,
    ...(Object.keys(chunks).length > 0 ? { chunks } : {}),
  };
}

function cloneValue<T>(value: T): T {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

function canonicalizePersistedCostumeDocument(costume: LegacyCostumePersistenceShape): PersistedCostumeDocument {
  const document = cloneCostumeDocument(ensureCostumeDocument(costume));
  for (const layer of document.layers) {
    if (!isBitmapCostumeLayer(layer)) {
      continue;
    }
    delete (layer.bitmap as { persistedAssetId?: string }).persistedAssetId;
  }
  return document;
}

function canonicalizePersistedAnimatedClip(
  clip: PersistedAnimatedCostumeClip | AnimatedCostumeClip,
): PersistedAnimatedCostumeClip {
  const nextClip = cloneValue(clip);
  return {
    ...nextClip,
    tracks: Array.isArray(nextClip.tracks)
      ? nextClip.tracks.map((track) => {
          if (track.kind === 'bitmap') {
            return {
              ...track,
              cels: track.cels.map((cel) => ({
                ...cel,
                bitmap: {
                  assetId: cel.bitmap.assetId,
                  assetFrame: cel.bitmap.assetFrame ? { ...cel.bitmap.assetFrame } : undefined,
                },
              })),
            } satisfies PersistedAnimatedCostumeBitmapTrack;
          }

          return {
            ...track,
            cels: track.cels.map((cel) => ({ ...cel, vector: { ...cel.vector } })),
          } satisfies PersistedAnimatedCostumeVectorTrack;
        })
      : [],
  };
}

function canonicalizePersistedCostume(costume: PersistedCostume | Costume): PersistedCostume {
  const nextCostume = cloneValue(costume) as LegacyCostumePersistenceShape;
  const {
    assetId: _assetId,
    bounds: _bounds,
    assetFrame: _assetFrame,
    persistedAssetId: _persistedAssetId,
    renderSignature: _renderSignature,
    ...rest
  } = nextCostume;

  if (nextCostume.kind === 'animated') {
    return {
      ...rest,
      kind: 'animated',
      document: canonicalizePersistedCostumeDocument(nextCostume),
      clip: canonicalizePersistedAnimatedClip(
        cloneAnimatedCostumeClip((costume as AnimatedCostume).clip),
      ),
    } satisfies PersistedAnimatedCostume;
  }

  return {
    ...rest,
    kind: 'static',
    document: canonicalizePersistedCostumeDocument(nextCostume),
  } satisfies PersistedStaticCostume;
}

function canonicalizePersistedBackground(
  background: PersistedBackgroundConfig | BackgroundConfig | null | undefined,
): PersistedBackgroundConfig | null {
  if (!background) {
    return null;
  }

  const nextBackground = cloneValue(background) as LegacyBackgroundPersistenceShape;
  const {
    document: _document,
    chunks: _chunks,
    ...rest
  } = nextBackground;

  const document = getTiledBackgroundDocument(toTypedBackgroundConfig(nextBackground));
  if (document) {
    return {
      ...rest,
      document,
    };
  }

  return {
    ...rest,
  };
}

function canonicalizePersistedGameObject(gameObject: PersistedGameObject | GameObject): PersistedGameObject {
  const nextObject = cloneValue(gameObject);
  return {
    ...nextObject,
    costumes: Array.isArray(nextObject.costumes)
      ? nextObject.costumes.map((costume) => canonicalizePersistedCostume(costume))
      : [],
  };
}

export function canonicalizePersistedScene(scene: PersistedScene | Scene): PersistedScene {
  const nextScene = cloneValue(scene);
  return {
    ...nextScene,
    background: canonicalizePersistedBackground(nextScene.background),
    objects: Array.isArray(nextScene.objects)
      ? nextScene.objects.map((object) => canonicalizePersistedGameObject(object))
      : [],
  };
}

export function canonicalizePersistedComponentDefinition(
  component: PersistedComponentDefinition | ComponentDefinition,
): PersistedComponentDefinition {
  const nextComponent = cloneValue(component);
  return {
    ...nextComponent,
    costumes: Array.isArray(nextComponent.costumes)
      ? nextComponent.costumes.map((costume) => canonicalizePersistedCostume(costume))
      : [],
  };
}

function inflatePersistedCostume(costume: PersistedCostume): Costume {
  const nextCostume = cloneValue(costume);
  return sanitizeCostume({
    ...nextCostume,
    assetId: '',
    document: cloneCostumeDocument(ensureCostumeDocument(nextCostume)),
  }) as Costume;
}

function inflatePersistedGameObject(gameObject: PersistedGameObject): GameObject {
  const nextObject = cloneValue(gameObject);
  return {
    ...nextObject,
    costumes: Array.isArray(nextObject.costumes)
      ? nextObject.costumes.map((costume) => inflatePersistedCostume(costume))
      : [],
  };
}

export function inflatePersistedScene(scene: PersistedScene): Scene {
  const nextScene = cloneValue(scene);
  return {
    ...nextScene,
    background: nextScene.background
      ? {
          ...nextScene.background,
          document: nextScene.background.document
            ? cloneBackgroundDocument(ensureBackgroundDocument(nextScene.background))
            : nextScene.background.document,
        }
      : null,
    objects: Array.isArray(nextScene.objects)
      ? nextScene.objects.map((object) => inflatePersistedGameObject(object))
      : [],
  };
}

export function inflatePersistedComponentDefinition(component: PersistedComponentDefinition): ComponentDefinition {
  const nextComponent = cloneValue(component);
  return {
    ...nextComponent,
    costumes: Array.isArray(nextComponent.costumes)
      ? nextComponent.costumes.map((costume) => inflatePersistedCostume(costume))
      : [],
  };
}

export function canonicalizePersistedProjectData(
  projectData: PersistedProjectData | RuntimeProjectData,
): PersistedProjectData {
  const nextProject = cloneValue(projectData) as PersistedProjectData & RuntimeProjectData;
  return {
    ...nextProject,
    scenes: Array.isArray(nextProject.scenes)
      ? nextProject.scenes.map((scene) => canonicalizePersistedScene(scene))
      : [],
    components: Array.isArray(nextProject.components)
      ? nextProject.components.map((component) => canonicalizePersistedComponentDefinition(component))
      : [],
  };
}

export function inflatePersistedProjectData(projectData: PersistedProjectData): RuntimeProjectData {
  const nextProject = canonicalizePersistedProjectData(projectData);
  return {
    ...nextProject,
    scenes: nextProject.scenes.map((scene) => inflatePersistedScene(scene)),
    components: nextProject.components.map((component) => inflatePersistedComponentDefinition(component)),
  };
}

export function parsePersistedProjectData(serializedData: string): PersistedProjectData {
  return canonicalizePersistedProjectData(JSON.parse(serializedData) as PersistedProjectData);
}

export function stringifyPersistedProjectData(projectData: PersistedProjectData | RuntimeProjectData): string {
  return JSON.stringify(canonicalizePersistedProjectData(projectData));
}
