import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface MessageDialogProps {
  open: boolean;
  mode: 'create' | 'rename';
  name: string;
  error: string | null;
  onNameChange: (name: string) => void;
  onOpenChange: (open: boolean) => void;
  onSubmit: () => void;
}

export function MessageDialog({
  open,
  mode,
  name,
  error,
  onNameChange,
  onOpenChange,
  onSubmit,
}: MessageDialogProps) {
  const title = mode === 'create' ? 'Create Message' : 'Rename Message';
  const submitLabel = mode === 'create' ? 'Create Message' : 'Rename Message';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <div className="space-y-2 py-2">
          <Label htmlFor="message-name">Message Name</Label>
          <Input
            id="message-name"
            value={name}
            onChange={(event) => onNameChange(event.target.value)}
            placeholder="message1"
            autoFocus
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                onSubmit();
              }
            }}
          />
          {error ? <p className="text-xs text-red-500">{error}</p> : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={onSubmit}>{submitLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
