export interface AssistantFeatureFlags {
  readonly isEnabled: boolean;
}

export const assistantFeatureFlags: AssistantFeatureFlags = Object.freeze({
  isEnabled: false,
});
