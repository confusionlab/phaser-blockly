export type IntentKind = 'question' | 'add' | 'remove' | 'change' | 'unknown';

export function classifyIntent(userIntent: string): IntentKind {
  const lower = userIntent.toLowerCase();
  if (/(\?|\b(is|are|what|which|how|do i need)\b)/.test(lower)) {
    return 'question';
  }
  if (/\b(add|create|insert|new|make)\b/.test(lower)) {
    return 'add';
  }
  if (/\b(remove|delete)\b/.test(lower)) {
    return 'remove';
  }
  if (/\b(change|set|update|edit|modify|fix)\b/.test(lower)) {
    return 'change';
  }
  return 'unknown';
}

export function hashFnv1a64(input: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;

  for (let i = 0; i < input.length; i += 1) {
    hash ^= BigInt(input.charCodeAt(i));
    hash = (hash * prime) & mask;
  }

  return hash.toString(16).padStart(16, '0');
}
