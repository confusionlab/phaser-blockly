import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { ProductMenu } from '@/components/layout/ProductMenu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import {
  EDITOR_CHROME_BORDER_CLASS_NAME,
  EDITOR_CHROME_ROW_CLASS_NAME,
} from '@/components/layout/editorChrome';

interface EditorTopBarProps {
  hasProject: boolean;
  isDarkMode: boolean;
  projectName: string | null;
  projectNameDisabled?: boolean;
  onExportProject: () => void;
  onGoToDashboard: () => void;
  onOpenHistory: () => void;
  onProjectNameCommit: (name: string) => void;
  onToggleTheme: () => void;
}

export function EditorTopBar({
  hasProject,
  isDarkMode,
  projectName,
  projectNameDisabled = false,
  onExportProject,
  onGoToDashboard,
  onOpenHistory,
  onProjectNameCommit,
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
        'shrink-0 bg-background px-3',
        EDITOR_CHROME_ROW_CLASS_NAME,
        EDITOR_CHROME_BORDER_CLASS_NAME,
      )}
    >
      <div className="grid h-full grid-cols-[1fr_auto_1fr] items-center gap-3">
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

        <div className="flex min-w-0 justify-center">
          {hasProject ? (
            <div className="flex w-full max-w-[360px] items-center gap-3 rounded-full border border-border/70 bg-card px-3 shadow-xs">
              <Label
                htmlFor={inputId}
                className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground/80"
              >
                Project
              </Label>
              <Input
                id={inputId}
                ref={inputRef}
                type="text"
                value={draftName}
                disabled={projectNameDisabled}
                aria-label="Project name"
                spellCheck={false}
                className="h-8 border-0 bg-transparent px-0 text-center text-sm font-medium shadow-none focus-visible:ring-0"
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

        <div aria-hidden="true" />
      </div>
    </div>
  );
}
