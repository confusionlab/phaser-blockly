import Dexie, { type EntityTable } from 'dexie';

export interface AssistantThreadRecord {
  id: string;
  projectId: string;
  scopeKey: string;
  createdAt: string;
  updatedAt: string;
}

export interface AssistantMessageRecord {
  id: string;
  threadId: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  meta?: string;
}

export interface AssistantTurnRecord {
  id: string;
  threadId: string;
  userIntent: string;
  mode: 'chat' | 'edit' | 'error';
  provider: string;
  model: string;
  debugTraceJson?: string;
  createdAt: string;
}

class AssistantChatDatabase extends Dexie {
  threads!: EntityTable<AssistantThreadRecord, 'id'>;
  messages!: EntityTable<AssistantMessageRecord, 'id'>;
  turns!: EntityTable<AssistantTurnRecord, 'id'>;

  constructor() {
    super('PochaCodingAssistantDB');
    this.version(1).stores({
      threads: 'id, projectId, scopeKey, [projectId+scopeKey], updatedAt',
      messages: 'id, threadId, createdAt, [threadId+createdAt]',
      turns: 'id, threadId, createdAt',
    });
  }
}

const db = new AssistantChatDatabase();

function makeId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function isNonEmptyStringKey(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export async function ensureAssistantThread(projectId: string, scopeKey: string): Promise<AssistantThreadRecord> {
  if (!isNonEmptyStringKey(projectId) || !isNonEmptyStringKey(scopeKey)) {
    throw new Error('Invalid assistant thread key: projectId and scopeKey must be non-empty strings.');
  }

  const existing = await db.threads.where('[projectId+scopeKey]').equals([projectId, scopeKey]).first();
  if (existing) {
    return existing;
  }

  const now = new Date().toISOString();
  const record: AssistantThreadRecord = {
    id: makeId('thread'),
    projectId,
    scopeKey,
    createdAt: now,
    updatedAt: now,
  };

  await db.threads.put(record);
  return record;
}

export async function listAssistantMessages(threadId: string): Promise<AssistantMessageRecord[]> {
  if (!isNonEmptyStringKey(threadId)) {
    return [];
  }
  return db.messages.where('threadId').equals(threadId).sortBy('createdAt');
}

export async function appendAssistantMessage(record: Omit<AssistantMessageRecord, 'id'>): Promise<AssistantMessageRecord> {
  if (!isNonEmptyStringKey(record.threadId)) {
    throw new Error('Invalid assistant message key: threadId must be a non-empty string.');
  }

  const message: AssistantMessageRecord = {
    id: makeId('msg'),
    ...record,
  };
  await db.messages.put(message);
  await db.threads.update(record.threadId, { updatedAt: new Date().toISOString() });
  return message;
}

export async function appendAssistantTurn(record: Omit<AssistantTurnRecord, 'id'>): Promise<AssistantTurnRecord> {
  if (!isNonEmptyStringKey(record.threadId)) {
    throw new Error('Invalid assistant turn key: threadId must be a non-empty string.');
  }

  const turn: AssistantTurnRecord = {
    id: makeId('turn'),
    ...record,
  };
  await db.turns.put(turn);
  await db.threads.update(record.threadId, { updatedAt: new Date().toISOString() });
  return turn;
}

export async function clearAssistantThreadMessages(threadId: string): Promise<void> {
  if (!isNonEmptyStringKey(threadId)) {
    return;
  }

  await db.transaction('rw', db.messages, db.turns, async () => {
    await db.messages.where('threadId').equals(threadId).delete();
    await db.turns.where('threadId').equals(threadId).delete();
  });
  await db.threads.update(threadId, { updatedAt: new Date().toISOString() });
}
