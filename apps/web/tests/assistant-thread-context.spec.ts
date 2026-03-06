import { expect, test } from '@playwright/test';
import { buildAssistantRunInputText } from '../../../packages/ui-shared/src/assistantConversation';
import { createAssistantProjectSnapshot } from '../src/lib/assistant/projectState';
import { extractAssistantThreadContext } from '../src/lib/assistant/threadContext';
import { createDefaultProject } from '../src/types';

test.describe('Assistant thread context', () => {
  test('extracts prior turns while keeping the latest user message as the active request', () => {
    const { requestText, conversationHistory } = extractAssistantThreadContext([
      {
        role: 'user',
        content: [{ type: 'text', text: 'Add a player object.' }],
      },
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'The player object is ready.' }],
      },
      {
        role: 'tool',
        content: [{ type: 'text', text: 'Ignored tool output.' }],
      },
      {
        role: 'user',
        content: [{ type: 'text', text: 'Now make it jump when I press space.' }],
      },
    ]);

    expect(requestText).toBe('Now make it jump when I press space.');
    expect(conversationHistory).toEqual([
      { role: 'user', text: 'Add a player object.' },
      { role: 'assistant', text: 'The player object is ready.' },
    ]);
  });

  test('builds the assistant prompt text with prior conversation context', () => {
    const snapshot = createAssistantProjectSnapshot(createDefaultProject('Assistant Prompt Fixture'));
    const inputText = buildAssistantRunInputText({
      mode: 'mutate',
      requestText: 'Add double jump support too.',
      snapshot,
      conversationHistory: [
        { role: 'user', text: 'Add a player object.' },
        { role: 'assistant', text: 'The player object is ready.' },
      ],
    });

    expect(inputText).toContain('Mode: mutate');
    expect(inputText).toContain('Conversation so far (oldest first):');
    expect(inputText).toContain('User: Add a player object.');
    expect(inputText).toContain('Assistant: The player object is ready.');
    expect(inputText).toContain('Current user request: Add double jump support too.');
    expect(inputText).toContain('"name":"Assistant Prompt Fixture"');
  });
});
