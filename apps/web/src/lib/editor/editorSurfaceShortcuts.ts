import { getSelectionNudgeDelta } from '@/utils/keyboard';

export interface EditorSelectionShortcutCommands {
  deleteSelection?: () => boolean;
  duplicateSelection?: () => boolean | Promise<boolean>;
  copySelection?: () => boolean | Promise<boolean>;
  cutSelection?: () => boolean | Promise<boolean>;
  pasteSelection?: () => boolean | Promise<boolean>;
  groupSelection?: () => boolean;
  ungroupSelection?: () => boolean;
  nudgeSelection?: (dx: number, dy: number) => boolean;
}

type ClipboardShortcutKey = 'd' | 'c' | 'v' | 'x';

const CLIPBOARD_SHORTCUT_COMMANDS: Record<ClipboardShortcutKey, keyof Pick<
  EditorSelectionShortcutCommands,
  'duplicateSelection' | 'copySelection' | 'pasteSelection' | 'cutSelection'
>> = {
  d: 'duplicateSelection',
  c: 'copySelection',
  v: 'pasteSelection',
  x: 'cutSelection',
};

const CLIPBOARD_SHORTCUT_LABELS: Record<ClipboardShortcutKey, string> = {
  d: 'duplicate',
  c: 'copy',
  v: 'paste',
  x: 'cut',
};

export function handleSelectionClipboardShortcuts(
  event: KeyboardEvent,
  commands: Pick<EditorSelectionShortcutCommands, 'duplicateSelection' | 'copySelection' | 'pasteSelection' | 'cutSelection'>,
  scopeLabel: string,
): boolean {
  if (!(event.metaKey || event.ctrlKey) || event.altKey) {
    return false;
  }

  const key = event.key.toLowerCase() as ClipboardShortcutKey;
  const commandName = CLIPBOARD_SHORTCUT_COMMANDS[key];
  if (!commandName) {
    return false;
  }

  const command = commands[commandName];
  if (!command) {
    return false;
  }

  event.preventDefault();
  void Promise.resolve(command()).catch((error) => {
    console.error(`Failed to ${CLIPBOARD_SHORTCUT_LABELS[key]} ${scopeLabel} selection:`, error);
  });
  return true;
}

export function handleSelectionDeleteShortcut(
  event: KeyboardEvent,
  deleteSelection: (() => boolean) | undefined,
): boolean {
  if (!deleteSelection) {
    return false;
  }
  if ((event.key !== 'Delete' && event.key !== 'Backspace') || event.metaKey || event.ctrlKey || event.altKey) {
    return false;
  }

  const handled = deleteSelection();
  if (handled) {
    event.preventDefault();
  }
  return handled;
}

export function handleSelectionNudgeShortcut(
  event: KeyboardEvent,
  nudgeSelection: ((dx: number, dy: number) => boolean) | undefined,
): boolean {
  if (!nudgeSelection) {
    return false;
  }

  const nudgeDelta = getSelectionNudgeDelta(event);
  if (!nudgeDelta) {
    return false;
  }

  const handled = nudgeSelection(nudgeDelta.x, nudgeDelta.y);
  if (handled) {
    event.preventDefault();
  }
  return handled;
}

export function handleSelectionGroupingShortcuts(
  event: KeyboardEvent,
  commands: Pick<EditorSelectionShortcutCommands, 'groupSelection' | 'ungroupSelection'>,
): boolean {
  if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'g' || event.shiftKey) {
    return false;
  }

  const command = event.altKey ? commands.ungroupSelection : commands.groupSelection;
  if (!command) {
    return false;
  }

  const handled = command();
  if (handled) {
    event.preventDefault();
  }
  return handled;
}

export function handleToolSwitchShortcut<TTool>(
  event: KeyboardEvent,
  resolveTool: (key: string) => TTool | null,
  applyTool: (tool: TTool) => void,
): boolean {
  if (event.metaKey || event.ctrlKey || event.altKey) {
    return false;
  }

  const nextTool = resolveTool(event.key);
  if (!nextTool) {
    return false;
  }

  event.preventDefault();
  applyTool(nextTool);
  return true;
}
