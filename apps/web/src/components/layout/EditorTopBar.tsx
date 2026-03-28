import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { ProductMenu } from '@/components/layout/ProductMenu';
import { InlineRenameField } from '@/components/ui/inline-rename-field';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { panelHeaderClassNames } from '@/lib/ui/panelHeaderTokens';

interface EditorTopBarProps {
  hasProject: boolean;
  isDarkMode: boolean;
  projectName: string | null;
  projectNameDisabled?: boolean;
  saveControlState?: 'save' | 'saving' | 'saved';
  saveNowDisabled?: boolean;
  onExportProject: () => void;
  onGoToDashboard: () => void;
  onOpenHistory: () => void;
  onProjectNameCommit: (name: string) => void;
  onSaveNow: () => void;
  onToggleTheme: () => void;
}

export function EditorTopBar({
  hasProject,
  isDarkMode,
  projectName,
  projectNameDisabled = false,
  saveControlState = 'saved',
  saveNowDisabled = false,
  onExportProject,
  onGoToDashboard,
  onOpenHistory,
  onProjectNameCommit,
  onSaveNow,
  onToggleTheme,
}: EditorTopBarProps) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const lastCommittedNameRef = useRef(projectName ?? '');
  const skipBlurCommitRef = useRef(false);
  const [draftName, setDraftName] = useState(projectName ?? '');

  useEffect(() => {
    const nextName = projectName ?? '';
    setDraftName(nextName);
    lastCommittedNameRef.current = nextName;
  }, [projectName]);

  const focusProjectNameInput = useCallback(() => {
    const input = inputRef.current;
    if (!input || projectNameDisabled) {
      return;
    }

    input.focus({ preventScroll: true });
    queueMicrotask(() => input.select());
  }, [projectNameDisabled]);

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

  const restoreLastCommittedName = useCallback(() => {
    skipBlurCommitRef.current = true;
    setDraftName(lastCommittedNameRef.current);
  }, []);

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
            hasProject={hasProject}
            onExportProject={onExportProject}
            onGoToDashboard={onGoToDashboard}
            onOpenHistory={onOpenHistory}
            onRenameProject={focusProjectNameInput}
            onToggleTheme={onToggleTheme}
          />
        </div>

        <div className="relative flex min-w-0 justify-center">
          {hasProject ? (
            <div className="flex w-full max-w-[360px] items-center justify-center rounded-xl px-3 py-1.5">
              <InlineRenameField
                id={inputId}
                ref={inputRef}
                value={draftName}
                disabled={projectNameDisabled}
                aria-label="Project name"
                spellCheck={false}
                editing
                className="w-full"
                outlineClassName="hidden"
                inputClassName={cn(
                  'truncate text-center text-sm font-medium text-foreground',
                  projectNameDisabled ? 'cursor-not-allowed opacity-60' : 'focus-visible:outline-none',
                )}
                textClassName="truncate text-center text-sm font-medium"
                onChange={(event) => setDraftName(event.target.value)}
                onBlur={() => {
                  if (skipBlurCommitRef.current) {
                    skipBlurCommitRef.current = false;
                    return;
                  }

                  void commitDraftName();
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    if (commitDraftName()) {
                      event.currentTarget.blur();
                    }
                    return;
                  }

                  if (event.key === 'Escape') {
                    event.preventDefault();
                    restoreLastCommittedName();
                    event.currentTarget.blur();
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
