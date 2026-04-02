import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Loader2 } from '@/components/ui/icons';
import { ProductMenu } from '@/components/layout/ProductMenu';
import { Button } from '@/components/ui/button';
import { InlineRenameField } from '@/components/ui/inline-rename-field';
import { PROJECT_NAME_MAX_LENGTH, validateProjectName } from '@/lib/projectName';
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
  const MAX_PROJECT_NAME_WIDTH_PX = 640;
  const PROJECT_NAME_HORIZONTAL_PADDING_PX = 12;
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const measurementRef = useRef<HTMLSpanElement>(null);
  const lastCommittedNameRef = useRef(projectName ?? '');
  const [draftName, setDraftName] = useState(projectName ?? '');
  const [isProjectNameEditing, setIsProjectNameEditing] = useState(false);
  const [projectNameFieldWidthPx, setProjectNameFieldWidthPx] = useState(160);

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

  const projectNameValidation = validateProjectName(draftName);

  useLayoutEffect(() => {
    const measurement = measurementRef.current;
    if (!measurement) {
      return;
    }

    const measuredWidthPx = Math.ceil(measurement.getBoundingClientRect().width) + PROJECT_NAME_HORIZONTAL_PADDING_PX;
    setProjectNameFieldWidthPx(Math.min(Math.max(measuredWidthPx, 48), MAX_PROJECT_NAME_WIDTH_PX));
  }, [draftName]);

  const projectNameFieldStyle = {
    maxWidth: `${MAX_PROJECT_NAME_WIDTH_PX}px`,
    width: `${projectNameFieldWidthPx}px`,
  } satisfies CSSProperties;

  const commitDraftName = useCallback((): boolean => {
    if (!hasProject) {
      return true;
    }

    if (!projectNameValidation.valid) {
      setDraftName(lastCommittedNameRef.current);
      return false;
    }

    if (projectNameValidation.normalized !== lastCommittedNameRef.current) {
      onProjectNameCommit(projectNameValidation.normalized);
    }

    lastCommittedNameRef.current = projectNameValidation.normalized;
    setDraftName(projectNameValidation.normalized);
    return true;
  }, [hasProject, onProjectNameCommit, projectNameValidation]);

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
            onToggleAdvancedBlocks={onToggleAdvancedBlocks}
            onToggleTheme={onToggleTheme}
          />
        </div>

        <div className="relative flex min-w-0 justify-center">
          {hasProject ? (
            <div className="flex w-full min-w-0 max-w-[640px] items-center justify-center">
              <span
                ref={measurementRef}
                aria-hidden="true"
                className="pointer-events-none absolute invisible whitespace-pre px-1.5 text-sm font-medium leading-5"
              >
                {draftName || ' '}
              </span>
              <InlineRenameField
                id={inputId}
                ref={inputRef}
                editing={isProjectNameEditing}
                invalid={isProjectNameEditing && !projectNameValidation.valid}
                value={draftName}
                disabled={projectNameDisabled}
                aria-label="Project name"
                spellCheck={false}
                autoFocus={isProjectNameEditing}
                focusBehavior="caret-end"
                maxLength={PROJECT_NAME_MAX_LENGTH}
                className="min-w-0"
                style={projectNameFieldStyle}
                displayAs="div"
                displayProps={{
                  'aria-label': 'Project name',
                  className: cn(
                    'flex h-8 cursor-text items-center justify-center rounded-md px-1.5',
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
                inputClassName={cn('h-8 px-1.5 text-center text-sm font-medium leading-5', projectNameDisabled ? 'opacity-60' : null)}
                textClassName="truncate text-center text-sm font-medium leading-5"
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
