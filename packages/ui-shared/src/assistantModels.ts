export type AssistantModelMode = 'fast' | 'smart';

export const DEFAULT_ASSISTANT_MODEL_MODE: AssistantModelMode = 'fast';

export const ASSISTANT_MODEL_MODE_OPTIONS = [
  {
    mode: 'fast',
    label: 'Fast',
    description: 'Lower latency for quick edits and iteration.',
  },
  {
    mode: 'smart',
    label: 'Smart',
    description: 'Higher reasoning quality for harder changes.',
  },
] as const satisfies ReadonlyArray<{
  mode: AssistantModelMode;
  label: string;
  description: string;
}>;
