import * as React from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { InlineRenameField } from '@/components/ui/inline-rename-field';
import { Label } from '@/components/ui/label';

interface NameInputDialogProps {
  open: boolean;
  title: string;
  label: string;
  value: string;
  submitLabel: string;
  description?: string;
  error?: string | null;
  placeholder?: string;
  onValueChange: (value: string) => void;
  onOpenChange: (open: boolean) => void;
  onSubmit: () => void;
}

export function NameInputDialog({
  open,
  title,
  label,
  value,
  submitLabel,
  description,
  error,
  placeholder,
  onValueChange,
  onOpenChange,
  onSubmit,
}: NameInputDialogProps) {
  const inputId = React.useId();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>

        <div className="space-y-2 py-2">
          <Label htmlFor={inputId}>{label}</Label>
          <InlineRenameField
            id={inputId}
            value={value}
            onChange={(event) => onValueChange(event.target.value)}
            placeholder={placeholder}
            invalid={!!error}
            aria-invalid={!!error}
            autoFocus
            className="w-full"
            textClassName="px-1 text-sm leading-5"
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                onSubmit();
              }
            }}
          />
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
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
