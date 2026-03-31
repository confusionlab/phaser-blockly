export const PROJECT_NAME_MAX_LENGTH = 120;

export type ProjectNameValidationResult = {
  normalized: string;
  reason: 'empty' | 'too-long' | null;
  valid: boolean;
};

export function validateProjectName(name: string): ProjectNameValidationResult {
  const normalized = name.trim();

  if (!normalized) {
    return {
      normalized,
      reason: 'empty',
      valid: false,
    };
  }

  if (normalized.length > PROJECT_NAME_MAX_LENGTH) {
    return {
      normalized,
      reason: 'too-long',
      valid: false,
    };
  }

  return {
    normalized,
    reason: null,
    valid: true,
  };
}
