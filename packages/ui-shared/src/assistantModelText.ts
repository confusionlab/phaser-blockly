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
    defaultValue: string | number | boolean;
  }[],
): string {
  if (items.length === 0) {
    return 'none';
  }

  const preview = items.slice(0, MAX_LIST_PREVIEW_ITEMS).map((item) => {
    return `${item.name}:${item.type}=${JSON.stringify(item.defaultValue)}`;
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
  logic: { summary: string; generatedCode?: string; generatedCodeTruncated?: boolean },
  indent: string,
) {
  lines.push(`${indent}Logic summary: ${logic.summary}`);
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

function formatSceneSection(snapshot: AssistantPromptSnapshot, lines: string[]) {
  lines.push('Scenes:');

  if (snapshot.state.scenes.length === 0) {
    lines.push('  none');
    return;
  }

  snapshot.state.scenes.forEach((scene, sceneIndex) => {
    lines.push(`  ${sceneIndex + 1}. Scene "${scene.name}" [id=${scene.id}, order=${scene.order}]`);
    lines.push(`    Background: ${formatBackground(scene.background)}`);
    lines.push(`    Camera: ${formatCamera(scene.cameraConfig)}`);
    lines.push(`    Ground: ${formatGround(scene.ground)}`);
    lines.push(
      `    Folders: ${
        scene.objectFolders.length === 0
          ? 'none'
          : scene.objectFolders
            .map((folder) => `${folder.name}[id=${folder.id}, parent=${formatId(folder.parentId)}, order=${folder.order}]`)
            .join(', ')
      }`,
    );

    if (scene.objects.length === 0) {
      lines.push('    Objects: none');
      return;
    }

    lines.push('    Objects:');
    scene.objects.forEach((object, objectIndex) => {
      appendObjectDetail(lines, object, '      ', `${objectIndex + 1}.`);
    });
  });
}

function formatComponentSection(snapshot: AssistantPromptSnapshot, lines: string[]) {
  lines.push('Components:');

  if (snapshot.state.components.length === 0) {
    lines.push('  none');
    return;
  }

  snapshot.state.components.forEach((component, componentIndex) => {
    appendComponentDetail(lines, component, '  ', `${componentIndex + 1}.`);
  });
}

export function formatAssistantPromptSnapshot(snapshotInput: Parameters<typeof buildAssistantModelSnapshot>[0]): string {
  const snapshot = buildAssistantModelSnapshot(snapshotInput);
  const lines: string[] = [
    'Project snapshot (sanitized, readable):',
    `Project: "${snapshot.state.project.name}" [id=${snapshot.projectId}, version=${snapshot.projectVersion}]`,
    `Updated: ${snapshot.state.project.updatedAtIso}`,
    `Canvas: ${formatNumber(snapshot.state.settings.canvasWidth)}x${formatNumber(snapshot.state.settings.canvasHeight)} background=${snapshot.state.settings.backgroundColor}`,
    `Global variables: ${formatVariableList(snapshot.state.globalVariables)}`,
    `Messages: ${snapshot.state.messages.length === 0 ? 'none' : formatNameList(snapshot.state.messages)}`,
    '',
  ];

  formatSceneSection(snapshot, lines);
  lines.push('');
  formatComponentSection(snapshot, lines);

  return lines.join('\n').trim();
}
