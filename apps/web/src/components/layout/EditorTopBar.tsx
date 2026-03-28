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
  cloudSaveStatusLabel?: string | null;
  cloudSaveStatusTone?: 'default' | 'error';
  saveNowDisabled?: boolean;
  saveNowBusy?: boolean;
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
  cloudSaveStatusLabel = null,
  cloudSaveStatusTone = 'default',
  saveNowDisabled = false,
  saveNowBusy = false,
  onExportProject,
  onGoToDashboard,
  onOpenHistory,
  onProjectNameCommit,
  onSaveNow,
  onToggleTheme,
}: EditorTopBarProps) {
  const inputId = useId();
  const renameSurfaceRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const lastCommittedNameRef = useRef(projectName ?? '');
  const shouldSelectAllOnOpenRef = useRef(false);
  const [isRenameOpen, setIsRenameOpen] = useState(false);
  const [draftName, setDraftName] = useState(projectName ?? '');

  useEffect(() => {
    const nextName = projectName ?? '';
    setDraftName(nextName);
    lastCommittedNameRef.current = nextName;
  }, [projectName]);

  const openRenameSurface = useCallback((focusBehavior: 'select-all' | 'caret-end' = 'caret-end') => {
    if (projectNameDisabled) {
      return;
    }

    shouldSelectAllOnOpenRef.current = focusBehavior === 'select-all';
    setDraftName(lastCommittedNameRef.current);
    setIsRenameOpen(true);
  }, [projectNameDisabled]);

  const closeRenameSurface = useCallback(() => {
    shouldSelectAllOnOpenRef.current = false;
    setIsRenameOpen(false);
  }, []);

  const commitDraftName = useCallback((options?: { close?: boolean }): boolean => {
    if (!hasProject) {
      if (options?.close) {
        closeRenameSurface();
      }
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
    if (options?.close) {
      closeRenameSurface();
    }
    return true;
  }, [closeRenameSurface, draftName, hasProject, onProjectNameCommit]);

  const restoreLastCommittedName = useCallback(() => {
    setDraftName(lastCommittedNameRef.current);
    closeRenameSurface();
  }, [closeRenameSurface]);

  useEffect(() => {
    if (!isRenameOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }

      if (renameSurfaceRef.current?.contains(target)) {
        return;
      }

      restoreLastCommittedName();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return;
      }

      event.preventDefault();
      restoreLastCommittedName();
    };

    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isRenameOpen, restoreLastCommittedName]);

  useEffect(() => {
    if (!isRenameOpen) {
      return;
    }

    const input = inputRef.current;
    if (!input) {
      return;
    }

    input.focus({ preventScroll: true });
    queueMicrotask(() => {
      input.focus({ preventScroll: true });
      if (shouldSelectAllOnOpenRef.current) {
        input.select();
        return;
      }

      const end = input.value.length;
      input.setSelectionRange(end, end);
    });
  }, [isRenameOpen]);

  const renameFocusBehavior = shouldSelectAllOnOpenRef.current ? 'select-all' : 'caret-end';

  const handleRenameTriggerClick = useCallback(() => {
    if (projectNameDisabled) {
      return;
    }

    if (isRenameOpen) {
      inputRef.current?.focus({ preventScroll: true });
      return;
    }

    openRenameSurface('caret-end');
  }, [isRenameOpen, openRenameSurface, projectNameDisabled]);

  const focusProjectNameInput = useCallback(() => {
    openRenameSurface('select-all');
  }, [openRenameSurface]);

  const displayedProjectName = draftName.trim() || lastCommittedNameRef.current || 'Untitled project';

  const popupRowLabelClassName = 'text-[15px] font-medium text-foreground/65';
  const popupFieldClassName = 'min-h-14 rounded-2xl bg-muted/70 px-5 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.55)]';

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
            <div ref={renameSurfaceRef} className="relative flex min-w-0 flex-col items-center">
              <button
                type="button"
                disabled={projectNameDisabled}
                aria-expanded={isRenameOpen}
                aria-controls={isRenameOpen ? inputId : undefined}
                className={cn(
                  'max-w-[360px] truncate rounded-xl px-3 py-1.5 text-center text-sm font-medium text-foreground transition-colors',
                  projectNameDisabled
                    ? 'cursor-not-allowed opacity-60'
                    : 'hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
                )}
                onClick={handleRenameTriggerClick}
              >
                {displayedProjectName}
              </button>

              {isRenameOpen ? (
                <div className="absolute top-full z-[var(--z-editor-popup)] mt-3 w-[520px] max-w-[calc(100vw-2rem)] rounded-[28px] border border-white/60 bg-background/95 p-7 shadow-[0_30px_80px_rgba(15,23,42,0.18)] backdrop-blur-xl">
                  <div className="grid grid-cols-[140px_minmax(0,1fr)] items-center gap-x-7 gap-y-5">
                    <div className={popupRowLabelClassName}>Name</div>
                    <div className={popupFieldClassName}>
                      <InlineRenameField
                        id={inputId}
                        ref={inputRef}
                        value={draftName}
                        onChange={(event) => setDraftName(event.target.value)}
                        placeholder="Untitled project"
                        autoFocus
                        editing
                        spellCheck={false}
                        focusBehavior={renameFocusBehavior}
                        className="w-full"
                        outlineClassName="hidden"
                        inputClassName="text-xl font-semibold leading-none text-foreground placeholder:text-foreground/35"
                        textClassName="text-xl font-semibold leading-none"
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            void commitDraftName({ close: true });
                            return;
                          }

                          if (event.key === 'Escape') {
                            event.preventDefault();
                            restoreLastCommittedName();
                          }
                        }}
                      />
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="flex min-w-0 items-center justify-end gap-3">
          {hasProject && cloudSaveStatusLabel ? (
            <div
              className={cn(
                'hidden max-w-[260px] truncate text-xs sm:block',
                cloudSaveStatusTone === 'error' ? 'text-destructive' : 'text-muted-foreground',
              )}
            >
              {cloudSaveStatusLabel}
            </div>
          ) : null}

          {hasProject ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={saveNowDisabled}
              onClick={onSaveNow}
            >
              {saveNowBusy ? <Loader2 className="animate-spin" /> : null}
              Save Now
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
