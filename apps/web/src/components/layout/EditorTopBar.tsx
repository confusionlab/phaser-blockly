import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Loader2 } from 'lucide-react';
import { ProductMenu } from '@/components/layout/ProductMenu';
import { Button } from '@/components/ui/button';
import { InlineRenameField } from '@/components/ui/inline-rename-field';
import { cn } from '@/lib/utils';
import { panelHeaderClassNames } from '@/lib/ui/panelHeaderTokens';

interface EditorTopBarProps {
  hasProject: boolean;
  isDarkMode: boolean;
  showAdvancedBlocks: boolean;
  projectName: string | null;
  projectNameDisabled?: boolean;
  saveControlState?: 'save' | 'saving' | 'saved';
  saveNowDisabled?: boolean;
  onExportProject: () => void;
  onGoToDashboard: () => void;
  onOpenHistory: () => void;
  onProjectNameCommit: (name: string) => void;
  onSaveNow: () => void;
  onToggleAdvancedBlocks: () => void;
  onToggleTheme: () => void;
}

export function EditorTopBar({
  hasProject,
  isDarkMode,
  showAdvancedBlocks,
  projectName,
  projectNameDisabled = false,
  saveControlState = 'saved',
  saveNowDisabled = false,
  onExportProject,
  onGoToDashboard,
  onOpenHistory,
  onProjectNameCommit,
  onSaveNow,
  onToggleAdvancedBlocks,
  onToggleTheme,
}: EditorTopBarProps) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const lastCommittedNameRef = useRef(projectName ?? '');
  const [draftName, setDraftName] = useState(projectName ?? '');
  const [isProjectNameEditing, setIsProjectNameEditing] = useState(false);

  useEffect(() => {
    const nextName = projectName ?? '';
    setDraftName(nextName);
    lastCommittedNameRef.current = nextName;
  }, [projectName]);

  useEffect(() => {
    if (!hasProject) {
      setIsProjectNameEditing(false);
    }
  }, [hasProject]);

  const placeProjectNameCaretAtEnd = useCallback((input: HTMLInputElement | null) => {
    if (!input) {
      return;
    }

    input.focus({ preventScroll: true });
    const caretIndex = input.value.length;
    input.setSelectionRange(caretIndex, caretIndex);
  }, []);

  const focusProjectNameInput = useCallback(() => {
    if (projectNameDisabled) {
      return;
    }

    if (!isProjectNameEditing) {
      setIsProjectNameEditing(true);
      return;
    }

    const input = inputRef.current;
    if (!input) {
      return;
    }

    placeProjectNameCaretAtEnd(input);
    queueMicrotask(() => placeProjectNameCaretAtEnd(input));
  }, [isProjectNameEditing, placeProjectNameCaretAtEnd, projectNameDisabled]);

  const commitDraftName = useCallback((): boolean => {
    if (!hasProject) {
      return true;
    }

    const trimmedName = draftName.trim();
    if (!trimmedName) {
      setDraftName(lastCommittedNameRef.current);
      return false;
    }

    if (trimmedName !== lastCommittedNameRef.current) {
      onProjectNameCommit(trimmedName);
    }

    lastCommittedNameRef.current = trimmedName;
    setDraftName(trimmedName);
    return true;
  }, [draftName, hasProject, onProjectNameCommit]);

  const cancelProjectNameEdit = useCallback(() => {
    setDraftName(lastCommittedNameRef.current);
    setIsProjectNameEditing(false);
  }, []);

  const activateProjectNameEdit = useCallback(() => {
    if (projectNameDisabled) {
      return;
    }

    setIsProjectNameEditing(true);
  }, [projectNameDisabled]);

  const handleProjectNameDisplayKeyDown = useCallback((event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return;
    }

    event.preventDefault();
    activateProjectNameEdit();
  }, [activateProjectNameEdit]);

  return (
    <div
      className={cn(
        panelHeaderClassNames.chrome,
        'h-[var(--editor-panel-header-height)]',
        'bg-background',
      )}
    >
      <div className="grid h-full w-full grid-cols-[1fr_auto_1fr] items-center gap-3">
        <div className="flex min-w-0 justify-start">
          <ProductMenu
            isDarkMode={isDarkMode}
            showAdvancedBlocks={showAdvancedBlocks}
            hasProject={hasProject}
            onExportProject={onExportProject}
            onGoToDashboard={onGoToDashboard}
            onOpenHistory={onOpenHistory}
            onRenameProject={focusProjectNameInput}
            onToggleAdvancedBlocks={onToggleAdvancedBlocks}
            onToggleTheme={onToggleTheme}
          />
        </div>

        <div className="relative flex min-w-0 justify-center">
          {hasProject ? (
            <div className="flex w-full max-w-[360px] items-center justify-center">
              <InlineRenameField
                id={inputId}
                ref={inputRef}
                editing={isProjectNameEditing}
                value={draftName}
                disabled={projectNameDisabled}
                aria-label="Project name"
                spellCheck={false}
                autoFocus={isProjectNameEditing}
                focusBehavior="caret-end"
                className="w-full"
                displayAs="div"
                displayProps={{
                  'aria-label': 'Project name',
                  className: cn(
                    'flex h-9 cursor-text items-center justify-center rounded-md px-3',
                    projectNameDisabled ? 'cursor-not-allowed opacity-60' : null,
                  ),
                  onClick: activateProjectNameEdit,
                  onKeyDown: handleProjectNameDisplayKeyDown,
                  role: projectNameDisabled ? undefined : 'button',
                  tabIndex: projectNameDisabled ? -1 : 0,
                  title: draftName,
                }}
                outlineClassName={cn(
                  'inset-x-0 inset-y-0 rounded-md border-input bg-background shadow-xs',
                  'group-focus-within/rename:border-ring group-focus-within/rename:ring-[3px] group-focus-within/rename:ring-ring/50',
                )}
                inputClassName={cn('h-9 px-3 text-center text-sm font-medium', projectNameDisabled ? 'opacity-60' : null)}
                textClassName="truncate text-center text-sm font-medium"
                onChange={(event) => setDraftName(event.target.value)}
                onBlur={() => {
                  void commitDraftName();
                  setIsProjectNameEditing(false);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    if (commitDraftName()) {
                      setIsProjectNameEditing(false);
                    }
                    return;
                  }

                  if (event.key === 'Escape') {
                    event.preventDefault();
                    cancelProjectNameEdit();
                  }
                }}
              />
            </div>
          ) : null}
        </div>

        <div className="flex min-w-0 items-center justify-end">
          {hasProject ? (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className={cn(
                'w-[72px] justify-center !transition-none',
                saveControlState === 'saved' ? 'text-muted-foreground' : 'text-foreground',
                saveControlState === 'saved' ? 'disabled:opacity-100' : null,
              )}
              disabled={saveNowDisabled}
              onClick={onSaveNow}
              aria-label={
                saveControlState === 'saving'
                  ? 'Saving'
                  : saveControlState === 'saved'
                    ? 'Saved'
                    : 'Save'
              }
            >
              {saveControlState === 'saving' ? (
                <Loader2 className="animate-spin" />
              ) : saveControlState === 'saved' ? (
                'Saved'
              ) : (
                'Save'
              )}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
