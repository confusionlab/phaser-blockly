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
