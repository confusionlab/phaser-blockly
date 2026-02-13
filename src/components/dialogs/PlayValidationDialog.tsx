import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { PlayValidationIssue } from '@/lib/playValidation';

interface PlayValidationDialogProps {
  open: boolean;
  issues: PlayValidationIssue[];
  onOpenChange: (open: boolean) => void;
  onIssueClick: (issue: PlayValidationIssue) => void;
}

export function PlayValidationDialog({
  open,
  issues,
  onOpenChange,
  onIssueClick,
}: PlayValidationDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Fix Blocks Before Playing</DialogTitle>
          <DialogDescription>
            Found {issues.length} issue{issues.length === 1 ? '' : 's'} in your blocks. Click any row to jump to that object.
          </DialogDescription>
        </DialogHeader>

        <div className="overflow-y-auto border rounded-md">
          {issues.map((issue) => (
            <Button
              key={issue.id}
              variant="ghost"
              className="w-full h-auto justify-start px-3 py-2 rounded-none border-b last:border-b-0 text-left"
              onClick={() => onIssueClick(issue)}
            >
              <div className="space-y-0.5">
                <div className="text-sm font-medium">
                  {issue.sceneName} / {issue.objectName}
                </div>
                <div className="text-xs text-muted-foreground">
                  [{issue.blockType}] {issue.message}
                </div>
              </div>
            </Button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
