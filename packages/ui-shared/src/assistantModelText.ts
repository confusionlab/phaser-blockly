import type {
  AssistantBackgroundConfig,
  AssistantColliderConfig,
  AssistantFolderSummary,
  AssistantGroundConfig,
  AssistantPhysicsConfig,
  AssistantProjectOperation,
  AssistantReferenceLink,
  AssistantReferenceReport,
  AssistantValidationIssue,
} from './assistant';
import type { AssistantBlockCatalogEntry } from './assistantBlocks';
import {
  buildAssistantModelComponent,
  buildAssistantModelObject,
  buildAssistantModelScene,
  buildAssistantModelSnapshot,
} from './assistantReadModel';

type AssistantPromptSnapshot = ReturnType<typeof buildAssistantModelSnapshot>;
type AssistantModelSceneTextInput = ReturnType<typeof buildAssistantModelScene>;
type AssistantModelObjectTextInput = ReturnType<typeof buildAssistantModelObject> & {
  logicOwner?: { type: 'object'; objectId: string } | { type: 'component'; componentId: string };
  linkedComponent?: { id: string; name: string } | null;
};
type AssistantModelComponentTextInput = ReturnType<typeof buildAssistantModelComponent>;

type AssistantStateSummaryTextInput = {
  projectId: string;
  projectName: string;
  sceneCount: number;
  objectCount: number;
  folderCount: number;
  componentCount: number;
  scenes: Array<{
    id: string;
    name: string;
    objectCount: number;
    folderCount: number;
  }>;
};

type AssistantSearchResultsTextInput = {
  scenes: Array<{ id: string; name: string }>;
  folders: Array<{ id: string; name: string; sceneId: string }>;
  objects: Array<{ id: string; name: string; sceneId: string; componentId: string | null }>;
  components: Array<{ id: string; name: string }>;
  variables: Array<{ id: string; name: string; scope: string; objectId: string | null }>;
  messages: Array<{ id: string; name: string }>;
};

type AssistantMutationResultTextInput = {
  operation: AssistantProjectOperation;
  createdEntities: Array<{ type: 'scene' | 'folder' | 'object' | 'component'; id: string; name: string }>;
  affectedEntityIds: string[];
  validationIssues: AssistantValidationIssue[];
  stateSummary: AssistantStateSummaryTextInput;
};

type AssistantToolErrorTextInput = {
  code: string;
  message: string;
  details?: unknown;
};

type AssistantBlockSearchResultsTextInput = {
  query: string;
  category?: string;
  kind?: string;
  matches: AssistantBlockCatalogEntry[];
};

type AssistantBlockDetailTextInput = AssistantBlockCatalogEntry;

const MAX_LIST_PREVIEW_ITEMS = 6;

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, '');
}

function formatId(value: string | null | undefined): string {
  return value && value.trim() ? value : 'none';
}

function formatNameList(items: readonly { name: string }[]): string {
  if (items.length === 0) {
    return 'none';
  }

  const names = items
    .slice(0, MAX_LIST_PREVIEW_ITEMS)
    .map((item) => item.name.trim())
    .filter(Boolean);
  if (items.length <= MAX_LIST_PREVIEW_ITEMS) {
    return names.join(', ');
  }

  return `${names.join(', ')} (+${items.length - MAX_LIST_PREVIEW_ITEMS} more)`;
}

function formatVariableList(
  items: readonly {
    name: string;
    type: string;
    cardinality?: 'single' | 'array';
    defaultValue: string | number | boolean | Array<string | number | boolean>;
  }[],
): string {
  if (items.length === 0) {
    return 'none';
  }

  const preview = items.slice(0, MAX_LIST_PREVIEW_ITEMS).map((item) => {
    const typeLabel = item.cardinality === 'array' ? `${item.type}[]` : item.type;
    return `${item.name}:${typeLabel}=${JSON.stringify(item.defaultValue)}`;
  });

  if (items.length <= MAX_LIST_PREVIEW_ITEMS) {
    return preview.join(', ');
  }

  return `${preview.join(', ')} (+${items.length - MAX_LIST_PREVIEW_ITEMS} more)`;
}

function formatBackground(background: AssistantBackgroundConfig | null): string {
  if (!background) {
    return 'none';
  }

  if (background.type === 'color') {
    return `color ${background.color}`;
  }

  const scrollFactor = background.scrollFactor
    ? ` scroll=(${formatNumber(background.scrollFactor.x)}, ${formatNumber(background.scrollFactor.y)})`
    : '';
  return `${background.type} asset=${background.hasAsset ? 'present' : 'missing'}${scrollFactor}`;
}

function formatGround(ground: AssistantGroundConfig | null | undefined): string {
  if (!ground?.enabled) {
    return 'disabled';
  }

  return `enabled y=${formatNumber(ground.y)} color=${ground.color}`;
}

function formatCamera(cameraConfig: {
  followTarget: string | null;
  bounds: { x: number; y: number; width: number; height: number } | null;
  zoom: number;
}): string {
  const bounds = cameraConfig.bounds
    ? `(${formatNumber(cameraConfig.bounds.x)}, ${formatNumber(cameraConfig.bounds.y)}, ${formatNumber(cameraConfig.bounds.width)}, ${formatNumber(cameraConfig.bounds.height)})`
    : 'none';
  return `follow=${formatId(cameraConfig.followTarget)} zoom=${formatNumber(cameraConfig.zoom)} bounds=${bounds}`;
}

function formatPhysics(physics: AssistantPhysicsConfig | null): string {
  if (!physics) {
    return 'none';
  }

  return [
    physics.bodyType,
    `enabled=${physics.enabled}`,
    `gravityY=${formatNumber(physics.gravityY)}`,
    `velocity=(${formatNumber(physics.velocityX)}, ${formatNumber(physics.velocityY)})`,
    `bounce=${formatNumber(physics.bounce)}`,
    `friction=${formatNumber(physics.friction)}`,
    `allowRotation=${physics.allowRotation}`,
  ].join(' ');
}

function formatCollider(collider: AssistantColliderConfig | null): string {
  if (!collider || collider.type === 'none') {
    return 'none';
  }

  return [
    collider.type,
    `offset=(${formatNumber(collider.offsetX)}, ${formatNumber(collider.offsetY)})`,
    `size=(${formatNumber(collider.width)}, ${formatNumber(collider.height)})`,
    `radius=${formatNumber(collider.radius)}`,
  ].join(' ');
}

function appendLogic(
  lines: string[],
  logic: {
    summary: string;
    fullEditableWith?: 'set_object_block_program' | 'set_component_block_program';
    exactEditableWith?: string;
    generatedCode?: string;
    generatedCodeTruncated?: boolean;
  },
  indent: string,
) {
  lines.push(`${indent}Logic summary: ${logic.summary}`);
  if (logic.fullEditableWith) {
    lines.push(`${indent}Full toolbox replacement: ${logic.fullEditableWith}`);
  }
  if (logic.exactEditableWith) {
    lines.push(`${indent}Exact tree editing: ${logic.exactEditableWith}`);
  }
  if (!logic.generatedCode) {
    return;
  }

  lines.push(`${indent}Generated JS:`);
  for (const line of logic.generatedCode.split('\n')) {
    lines.push(`${indent}  ${line}`);
  }
  if (logic.generatedCodeTruncated) {
    lines.push(`${indent}  [preview truncated]`);
  }
}

function appendObjectDetail(lines: string[], object: AssistantModelObjectTextInput, indent: string, heading: string) {
  lines.push(
    `${indent}${heading} "${object.name}" [id=${object.id}, order=${object.order}, parent=${formatId(object.parentId)}, component=${formatId(object.componentId)}]`,
  );
  lines.push(
    `${indent}  Transform: position=(${formatNumber(object.x)}, ${formatNumber(object.y)}) scale=(${formatNumber(object.scaleX)}, ${formatNumber(object.scaleY)}) rotation=${formatNumber(object.rotation)} visible=${object.visible}`,
  );
  lines.push(`${indent}  Physics: ${formatPhysics(object.physics)}`);
  lines.push(`${indent}  Collider: ${formatCollider(object.collider)}`);
  lines.push(`${indent}  Costumes: ${formatNameList(object.costumes)}`);
  lines.push(`${indent}  Sounds: ${formatNameList(object.sounds)}`);
  lines.push(`${indent}  Local variables: ${formatVariableList(object.localVariables)}`);
  if (object.linkedComponent) {
    lines.push(`${indent}  Linked component: "${object.linkedComponent.name}" [id=${object.linkedComponent.id}]`);
  }
  if (object.logicOwner) {
    lines.push(
      `${indent}  Logic owner: ${
        object.logicOwner.type === 'component'
          ? `component ${object.logicOwner.componentId}`
          : `object ${object.logicOwner.objectId}`
      }`,
    );
  }
  appendLogic(lines, object.logic, `${indent}  `);
}

function appendComponentDetail(lines: string[], component: AssistantModelComponentTextInput, indent: string, heading: string) {
  lines.push(`${indent}${heading} "${component.name}" [id=${component.id}]`);
  lines.push(`${indent}  Physics: ${formatPhysics(component.physics)}`);
  lines.push(`${indent}  Collider: ${formatCollider(component.collider)}`);
  lines.push(`${indent}  Costumes: ${formatNameList(component.costumes)}`);
  lines.push(`${indent}  Sounds: ${formatNameList(component.sounds)}`);
  lines.push(`${indent}  Local variables: ${formatVariableList(component.localVariables)}`);
  appendLogic(lines, component.logic, `${indent}  `);
}

export function formatAssistantProjectSummary(summary: AssistantStateSummaryTextInput): string {
  const lines = [
    `Project summary: "${summary.projectName}" [id=${summary.projectId}] scenes=${summary.sceneCount} objects=${summary.objectCount} folders=${summary.folderCount} components=${summary.componentCount}`,
  ];

  if (summary.scenes.length === 0) {
    lines.push('Scenes: none');
    return lines.join('\n');
  }

  lines.push('Scenes:');
  summary.scenes.forEach((scene, index) => {
    lines.push(`  ${index + 1}. "${scene.name}" [id=${scene.id}] objects=${scene.objectCount} folders=${scene.folderCount}`);
  });
  return lines.join('\n');
}

export function formatAssistantModelSceneDetail(scene: AssistantModelSceneTextInput): string {
  const lines = [
    `Scene "${scene.name}" [id=${scene.id}, order=${scene.order}]`,
    `  Background: ${formatBackground(scene.background)}`,
    `  Camera: ${formatCamera(scene.cameraConfig)}`,
    `  Ground: ${formatGround(scene.ground)}`,
    `  Folders: ${
      scene.objectFolders.length === 0
        ? 'none'
        : scene.objectFolders
          .map((folder) => `${folder.name}[id=${folder.id}, parent=${formatId(folder.parentId)}, order=${folder.order}]`)
          .join(', ')
    }`,
  ];

  if (scene.objects.length === 0) {
    lines.push('  Objects: none');
    return lines.join('\n');
  }

  lines.push('  Objects:');
  scene.objects.forEach((object, index) => {
    appendObjectDetail(lines, object, '    ', `${index + 1}.`);
  });
  return lines.join('\n');
}

export function formatAssistantModelObjectDetail(object: AssistantModelObjectTextInput): string {
  const lines: string[] = [];
  appendObjectDetail(lines, object, '', 'Object');
  return lines.join('\n');
}

export function formatAssistantModelComponentDetail(component: AssistantModelComponentTextInput): string {
  const lines: string[] = [];
  appendComponentDetail(lines, component, '', 'Component');
  return lines.join('\n');
}

export function formatAssistantFolderDetail(folder: AssistantFolderSummary): string {
  const lines = [
    `Folder "${folder.folder.name}" [id=${folder.folder.id}, order=${folder.folder.order}]`,
    `  Scene: "${folder.scene.name}" [id=${folder.scene.id}]`,
    `  Parent folder: ${
      folder.parentFolder ? `"${folder.parentFolder.name}" [id=${folder.parentFolder.id}]` : 'none'
    }`,
    `  Child folders: ${
      folder.childFolders.length === 0
        ? 'none'
        : folder.childFolders.map((child) => `"${child.name}" [id=${child.id}]`).join(', ')
    }`,
    `  Child objects: ${
      folder.childObjects.length === 0
        ? 'none'
        : folder.childObjects
          .map((child) => `"${child.name}" [id=${child.id}, order=${child.order}, component=${formatId(child.componentId)}]`)
          .join(', ')
    }`,
  ];

  return lines.join('\n');
}

export function formatAssistantSearchResults(results: AssistantSearchResultsTextInput): string {
  const lines = ['Search results:'];
  const sections: Array<[string, string[]]> = [
    ['Scenes', results.scenes.map((scene) => `"${scene.name}" [id=${scene.id}]`)],
    ['Folders', results.folders.map((folder) => `"${folder.name}" [id=${folder.id}, scene=${folder.sceneId}]`)],
    [
      'Objects',
      results.objects.map(
        (object) => `"${object.name}" [id=${object.id}, scene=${object.sceneId}, component=${formatId(object.componentId)}]`,
      ),
    ],
    ['Components', results.components.map((component) => `"${component.name}" [id=${component.id}]`)],
    [
      'Variables',
      results.variables.map(
        (variable) => `${variable.name} [id=${variable.id}, scope=${variable.scope}, object=${formatId(variable.objectId)}]`,
      ),
    ],
    ['Messages', results.messages.map((message) => `"${message.name}" [id=${message.id}]`)],
  ];

  const nonEmptySections = sections.filter(([, items]) => items.length > 0);
  if (nonEmptySections.length === 0) {
    lines.push('  none');
    return lines.join('\n');
  }

  nonEmptySections.forEach(([label, items]) => {
    lines.push(`  ${label}:`);
    items.forEach((item, index) => {
      lines.push(`    ${index + 1}. ${item}`);
    });
  });
  return lines.join('\n');
}

function formatBlockSignature(entry: AssistantBlockCatalogEntry): string {
  const parts = [entry.type, entry.kind];
  if (entry.inputNames.length > 0) {
    parts.push(`inputs=${entry.inputNames.join(',')}`);
  }
  if (entry.statementInputNames.length > 0) {
    parts.push(`statements=${entry.statementInputNames.join(',')}`);
  }
  if (entry.fieldNames.length > 0) {
    parts.push(`fields=${entry.fieldNames.join(',')}`);
  }
  return parts.join(' | ');
}

export function formatAssistantBlockSearchResults(results: AssistantBlockSearchResultsTextInput): string {
  const lines = [
    `Block search results: query="${results.query || '*'}"${results.category ? ` category=${results.category}` : ''}${results.kind ? ` kind=${results.kind}` : ''}`,
  ];

  if (results.matches.length === 0) {
    lines.push('  none');
    return lines.join('\n');
  }

  results.matches.forEach((entry, index) => {
    lines.push(`  ${index + 1}. [${entry.category}] ${formatBlockSignature(entry)} | ${entry.summary}`);
  });
  return lines.join('\n');
}

export function formatAssistantBlockDetail(entry: AssistantBlockDetailTextInput): string {
  const lines = [
    `Block "${entry.type}"`,
    `  Category: ${entry.category}`,
    `  Kind: ${entry.kind}`,
    `  Summary: ${entry.summary}`,
    `  Inputs: ${entry.inputNames.length === 0 ? 'none' : entry.inputNames.join(', ')}`,
    `  Statement inputs: ${entry.statementInputNames.length === 0 ? 'none' : entry.statementInputNames.join(', ')}`,
    `  Fields: ${entry.fieldNames.length === 0 ? 'none' : entry.fieldNames.join(', ')}`,
  ];
  return lines.join('\n');
}

function formatReferenceLink(link: AssistantReferenceLink): string {
  const parts: string[] = [link.relation.replaceAll('_', ' ')];
  if (link.sceneName || link.sceneId) {
    parts.push(`scene=${link.sceneName ?? link.sceneId}`);
  }
  if (link.folderName || link.folderId) {
    parts.push(`folder=${link.folderName ?? link.folderId}`);
  }
  if (link.objectName || link.objectId) {
    parts.push(`object=${link.objectName ?? link.objectId}`);
  }
  if (link.componentName || link.componentId) {
    parts.push(`component=${link.componentName ?? link.componentId}`);
  }
  return parts.join(' | ');
}

export function formatAssistantReferenceReport(report: AssistantReferenceReport): string {
  const sceneText = report.target.sceneId ? `, scene=${report.target.sceneName ?? report.target.sceneId}` : '';
  const lines = [
    `References for ${report.entityType} "${report.target.name}" [id=${report.target.id}${sceneText}]`,
  ];

  if (report.references.length === 0) {
    lines.push('  none');
    return lines.join('\n');
  }

  report.references.forEach((reference, index) => {
    lines.push(`  ${index + 1}. ${formatReferenceLink(reference)}`);
  });
  return lines.join('\n');
}

export function formatAssistantValidationIssues(issues: readonly AssistantValidationIssue[]): string {
  if (issues.length === 0) {
    return 'Validation issues: none';
  }

  const lines = ['Validation issues:'];
  issues.forEach((issue, index) => {
    lines.push(
      `  ${index + 1}. [${issue.code}] ${issue.message}${issue.entityIds.length > 0 ? ` | ids=${issue.entityIds.join(', ')}` : ''}`,
    );
  });
  return lines.join('\n');
}

export function formatAssistantMutationResult(result: AssistantMutationResultTextInput): string {
  const lines = [`Mutation staged successfully: ${result.operation.kind}`];
  lines.push(
    `Created entities: ${
      result.createdEntities.length === 0
        ? 'none'
        : result.createdEntities
          .map((entity) => `${entity.type} "${entity.name}" [id=${entity.id}]`)
          .join(', ')
    }`,
  );
  lines.push(`Affected IDs: ${result.affectedEntityIds.length === 0 ? 'none' : result.affectedEntityIds.join(', ')}`);

  const validationText = formatAssistantValidationIssues(result.validationIssues).split('\n');
  lines.push(...validationText);
  lines.push('State after change:');
  lines.push(...formatAssistantProjectSummary(result.stateSummary).split('\n').map((line) => `  ${line}`));
  return lines.join('\n');
}

function formatToolErrorDetails(details: unknown): string | null {
  if (!details || typeof details !== 'object' || Array.isArray(details)) {
    return null;
  }

  const entries = Object.entries(details)
    .filter(([, value]) => value !== null && value !== undefined)
    .filter(([, value]) => ['string', 'number', 'boolean'].includes(typeof value))
    .map(([key, value]) => `${key}=${String(value)}`);

  if (entries.length === 0) {
    return null;
  }

  return entries.join(', ');
}

export function formatAssistantToolError(error: AssistantToolErrorTextInput): string {
  const lines = [`Tool error [${error.code}]: ${error.message}`];
  const detailsText = formatToolErrorDetails(error.details);
  if (detailsText) {
    lines.push(`Details: ${detailsText}`);
  }
  return lines.join('\n');
}

function getFocusScene(snapshot: AssistantPromptSnapshot): AssistantPromptSnapshot['state']['scenes'][number] | null {
  if (snapshot.state.scenes.length === 0) {
    return null;
  }

  return snapshot.state.scenes.find((scene) => scene.id === snapshot.focusSceneId) ?? snapshot.state.scenes[0] ?? null;
}

function collectReferencedComponentIds(
  snapshot: AssistantPromptSnapshot,
  scene: AssistantPromptSnapshot['state']['scenes'][number],
): Set<string> {
  const referencedComponentIds = new Set<string>();

  scene.objects.forEach((object) => {
    if (object.componentId) {
      referencedComponentIds.add(object.componentId);
    }
  });

  snapshot.state.components.forEach((component) => {
    const componentToken = `component:${component.id}`;
    const referencedByLogic = scene.objects.some((object) => {
      const generatedCode = object.logic.generatedCode ?? '';
      return generatedCode.includes(component.id) || generatedCode.includes(componentToken);
    });
    if (referencedByLogic) {
      referencedComponentIds.add(component.id);
    }
  });

  return referencedComponentIds;
}

function formatComponentInstanceGroups(
  scene: AssistantPromptSnapshot['state']['scenes'][number],
  snapshot: AssistantPromptSnapshot,
): string {
  const grouped = new Map<string, { componentName: string; count: number }>();

  scene.objects.forEach((object) => {
    if (!object.componentId) {
      return;
    }

    const component = snapshot.state.components.find((candidate) => candidate.id === object.componentId);
    const componentName = component?.name ?? object.componentId;
    const current = grouped.get(object.componentId);
    if (current) {
      current.count += 1;
      return;
    }

    grouped.set(object.componentId, {
      componentName,
      count: 1,
    });
  });

  if (grouped.size === 0) {
    return 'none';
  }

  return Array.from(grouped.entries())
    .map(([componentId, entry]) => `${entry.componentName} x${entry.count} [component=${componentId}]`)
    .join(', ');
}

function appendPromptLogicOwner(
  lines: string[],
  heading: string,
  entity: { id: string; name: string; logic: { summary: string; generatedCode?: string; generatedCodeTruncated?: boolean } },
  indent = '  ',
) {
  lines.push(`${indent}${heading} "${entity.name}" [id=${entity.id}]`);
  lines.push(`${indent}  Logic summary: ${entity.logic.summary}`);
  if (!entity.logic.generatedCode) {
    return;
  }
  lines.push(`${indent}  Generated JS:`);
  entity.logic.generatedCode.split('\n').forEach((line) => {
    lines.push(`${indent}    ${line}`);
  });
}

export function formatAssistantPromptSnapshot(snapshotInput: Parameters<typeof buildAssistantModelSnapshot>[0]): string {
  const snapshot = buildAssistantModelSnapshot(snapshotInput);
  const focusScene = getFocusScene(snapshot);
  const totalObjectCount = snapshot.state.scenes.reduce((count, scene) => count + scene.objects.length, 0);
  const lines: string[] = [
    'Project snapshot (sanitized, readable):',
    `Project: "${snapshot.state.project.name}" [id=${snapshot.projectId}, version=${snapshot.projectVersion}]`,
    `Updated: ${snapshot.state.project.updatedAtIso}`,
    `Canvas: ${formatNumber(snapshot.state.settings.canvasWidth)}x${formatNumber(snapshot.state.settings.canvasHeight)} background=${snapshot.state.settings.backgroundColor}`,
    `Global variables: ${formatVariableList(snapshot.state.globalVariables)}`,
    `Messages: ${snapshot.state.messages.length === 0 ? 'none' : formatNameList(snapshot.state.messages)}`,
    `Project overview: scenes=${snapshot.state.scenes.length} objects=${totalObjectCount} components=${snapshot.state.components.length}`,
    '',
  ];

  lines.push('Active scene:');
  if (!focusScene) {
    lines.push('  none');
    return lines.join('\n').trim();
  }

  const standaloneObjects = focusScene.objects.filter((object) => !object.componentId);
  const standaloneLogicOwners = standaloneObjects.filter((object) => object.logic.hasLogic);
  const referencedComponentIds = collectReferencedComponentIds(snapshot, focusScene);
  const referencedComponents = snapshot.state.components.filter((component) => referencedComponentIds.has(component.id));
  const referencedLogicComponents = referencedComponents.filter((component) => component.logic.hasLogic);
  const otherScenes = snapshot.state.scenes.filter((scene) => scene.id !== focusScene.id);
  const otherComponents = snapshot.state.components.filter((component) => !referencedComponentIds.has(component.id));

  lines.push(`  Scene "${focusScene.name}" [id=${focusScene.id}, order=${focusScene.order}]`);
  lines.push(`    Background: ${formatBackground(focusScene.background)}`);
  lines.push(`    Camera: ${formatCamera(focusScene.cameraConfig)}`);
  lines.push(`    Ground: ${formatGround(focusScene.ground)}`);
  lines.push(
    `    Folders: ${
      focusScene.objectFolders.length === 0
        ? 'none'
        : focusScene.objectFolders
          .map((folder) => `${folder.name}[id=${folder.id}, parent=${formatId(folder.parentId)}, order=${folder.order}]`)
          .join(', ')
    }`,
  );
  lines.push(`    Standalone objects: ${standaloneObjects.length === 0 ? 'none' : formatNameList(standaloneObjects)}`);
  lines.push(`    Component instances: ${formatComponentInstanceGroups(focusScene, snapshot)}`);
  lines.push(
    `    Referenced components in scene logic: ${
      referencedComponents.length === 0 ? 'none' : formatNameList(referencedComponents)
    }`,
  );

  lines.push('');
  lines.push('Logic owners in active scene:');
  if (standaloneLogicOwners.length === 0 && referencedLogicComponents.length === 0) {
    lines.push('  none');
  } else {
    standaloneLogicOwners.forEach((object) => appendPromptLogicOwner(lines, 'Object', object));
    referencedLogicComponents.forEach((component) => appendPromptLogicOwner(lines, 'Component', component));
  }

  lines.push('');
  lines.push(`Other scenes: ${otherScenes.length === 0 ? 'none' : formatNameList(otherScenes)}`);
  lines.push(`Other components: ${otherComponents.length === 0 ? 'none' : formatNameList(otherComponents)}`);
  lines.push('Additional context can be fetched with tools: get_scene, get_object, get_component, search_blocks, get_block_details');

  return lines.join('\n').trim();
}
