import {
  normalizeAssistantConversationTurns,
  type AssistantConversationTurn,
} from '../../../../../packages/ui-shared/src/assistantConversation';

export type AssistantThreadMessage = {
  role: string;
  content: readonly {
    type: string;
    text?: string;
  }[];
};

function extractMessageText(message: AssistantThreadMessage): string {
  return message.content
    .filter((part) => part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text ?? '')
    .join('\n')
    .trim();
}

export function extractAssistantThreadContext(messages: readonly AssistantThreadMessage[]): {
  requestText: string;
  conversationHistory: AssistantConversationTurn[];
} {
  const turns = normalizeAssistantConversationTurns(
    messages.flatMap((message) => {
      if (message.role !== 'user' && message.role !== 'assistant') {
        return [];
      }

      return [{
        role: message.role,
        text: extractMessageText(message),
      }];
    }),
  );

  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    if (turn?.role !== 'user') {
      continue;
    }

    return {
      requestText: turn.text,
      conversationHistory: turns.slice(0, index),
    };
  }

  return {
    requestText: '',
    conversationHistory: [],
  };
}
