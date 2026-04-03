export type EditorSaveControlState = 'save' | 'saving' | 'saved';

export function doesLocalProjectMatchCloudHead(options: {
  localSchemaVersion: number;
  localContentHash: string;
  cloudSchemaVersion: number;
  cloudContentHash: string;
  migrated: boolean;
}): boolean {
  if (options.migrated) {
    return false;
  }

  return options.localSchemaVersion === options.cloudSchemaVersion
    && options.localContentHash === options.cloudContentHash;
}

export function shouldTreatOpenedProjectAsCloudSaved(options: {
  openedFromCloudCache: boolean;
  matchesCloudHead: boolean;
  pullStatus: 'updated' | 'unchanged' | 'missing' | 'error';
}): boolean {
  if (options.matchesCloudHead) {
    return true;
  }

  // If cloud verification fails but the editor just opened the last synced
  // cloud-backed cache, there is nothing local to upload yet.
  return options.openedFromCloudCache && options.pullStatus === 'error';
}

export function deriveEditorSaveControlState(options: {
  hasProject: boolean;
  isDirty: boolean;
  hasActionableCloudError: boolean;
  isManualSaveInProgress: boolean;
}): EditorSaveControlState {
  if (!options.hasProject) {
    return 'saved';
  }

  if (options.isManualSaveInProgress) {
    return 'saving';
  }

  if (options.isDirty || options.hasActionableCloudError) {
    return 'save';
  }

  return 'saved';
}
