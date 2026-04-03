import { ProjectPropertyManagerRow } from '@/components/dialogs/ProjectPropertyManagerDialog';
import { Button } from '@/components/ui/button';
import { Component as ComponentIcon, Type, User } from '@/components/ui/icons';
import { Modal } from '@/components/ui/modal';
import type { ProjectReferenceImpact, ProjectReferenceOwnerTarget } from '@/lib/projectReferenceUsage';

interface ReferenceUsageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entityLabel: string;
  impact: ProjectReferenceImpact | null;
  onNavigate: (owner: ProjectReferenceOwnerTarget) => void;
}

function formatReferenceCount(count: number): string {
  return `${count} ${count === 1 ? 'block' : 'blocks'}`;
}

export function ReferenceUsageDialog({
  open,
  onOpenChange,
  entityLabel,
  impact,
  onNavigate,
}: ReferenceUsageDialogProps) {
  const entityKindLabel = impact?.entityKind === 'message' ? 'message' : 'variable';
  const totalReferences = impact?.referenceCount ?? 0;
  const usages = impact?.usages ?? [];

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={`Can't delete "${entityLabel}" yet`}
      description={(
        <div className="space-y-2">
          <p>
            This {entityKindLabel} is still used in {totalReferences} {totalReferences === 1 ? 'block' : 'blocks'}.
          </p>
          <p>Open each owner below and remove those blocks before deleting it.</p>
        </div>
      )}
      contentClassName="sm:max-w-2xl"
      footer={(
        <Button variant="outline" onClick={() => onOpenChange(false)}>
          Close
        </Button>
      )}
    >
      <div className="space-y-1">
        {usages.map((usage) => (
          <ProjectPropertyManagerRow
            key={usage.owner.kind === 'component'
              ? `component:${usage.owner.componentId}`
              : `object:${usage.owner.sceneId}:${usage.owner.objectId}`}
            icon={usage.owner.kind === 'component'
              ? <ComponentIcon className="size-4 flex-shrink-0 text-muted-foreground" />
              : <User className="size-4 flex-shrink-0 text-muted-foreground" />}
            name={usage.title}
            subtitle={usage.subtitle ?? undefined}
            trailingMeta={formatReferenceCount(usage.referenceCount)}
            primaryActionLabel="Go to"
            onPrimaryAction={() => onNavigate(usage.owner)}
          />
        ))}
        {usages.length === 0 ? (
          <ProjectPropertyManagerRow
            icon={<Type className="size-4 flex-shrink-0 text-muted-foreground" />}
            name="No usages found"
            subtitle="Try closing and reopening this dialog if the project changed."
          />
        ) : null}
      </div>
    </Modal>
  );
}
