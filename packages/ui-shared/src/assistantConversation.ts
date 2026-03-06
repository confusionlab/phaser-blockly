import type { AssistantProjectSnapshot } from './assistant';
import { formatAssistantPromptSnapshot } from './assistantModelText';

export type AssistantConversationRole = 'user' | 'assistant';

export interface AssistantConversationTurn {
  role: AssistantConversationRole;
  text: string;
}

export const DEFAULT_ASSISTANT_CONVERSATION_TURN_LIMIT = 12;

export function normalizeAssistantConversationTurns(
  turns: readonly AssistantConversationTurn[],
  maxTurns = DEFAULT_ASSISTANT_CONVERSATION_TURN_LIMIT,
): AssistantConversationTurn[] {
  const normalized = turns.flatMap((turn) => {
    if (turn.role !== 'user' && turn.role !== 'assistant') {
      return [];
    }

    const text = turn.text.trim();
    if (!text) {
      return [];
    }

    return [{ role: turn.role, text }];
  });

  if (maxTurns <= 0) {
    return normalized;
  }

  return normalized.slice(-maxTurns);
}

export function formatAssistantConversationTranscript(turns: readonly AssistantConversationTurn[]): string {
  return turns
    .map((turn) => `${turn.role === 'user' ? 'User' : 'Assistant'}: ${turn.text}`)
    .join('\n\n');
}

export function buildAssistantRunInputText({
  mode,
  requestText,
  snapshot,
  conversationHistory,
}: {
  mode: 'mutate' | 'analyze';
  requestText: string;
  snapshot: AssistantProjectSnapshot;
  conversationHistory: readonly AssistantConversationTurn[];
}): string {
  const sections = [`Mode: ${mode}`];

  if (conversationHistory.length > 0) {
    sections.push(`Conversation so far (oldest first):\n${formatAssistantConversationTranscript(conversationHistory)}`);
  }

  sections.push(`Current user request: ${requestText}`);
  sections.push(formatAssistantPromptSnapshot(snapshot));

  return sections.join('\n\n');
}
