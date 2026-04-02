import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';

type ModalTone = 'default' | 'destructive';

type AlertOptions = {
  title?: ReactNode;
  description: ReactNode;
  confirmLabel?: string;
  tone?: ModalTone;
};

type ConfirmOptions = {
  title?: ReactNode;
  description: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: ModalTone;
};

type ModalRequestBase = {
  id: number;
  title: ReactNode;
  description: ReactNode;
  confirmLabel: string;
  tone: ModalTone;
};

type AlertRequest = ModalRequestBase & {
  kind: 'alert';
  resolve: () => void;
};

type ConfirmRequest = ModalRequestBase & {
  kind: 'confirm';
  cancelLabel: string;
  resolve: (confirmed: boolean) => void;
};

type ModalRequest = AlertRequest | ConfirmRequest;

type ModalContextValue = {
  showAlert: (options: AlertOptions) => Promise<void>;
  showConfirm: (options: ConfirmOptions) => Promise<boolean>;
};

const ModalContext = createContext<ModalContextValue | null>(null);

export function ModalProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<ModalRequest[]>([]);
  const nextIdRef = useRef(1);
  const activeRequest = queue[0] ?? null;

  const dismissActiveRequest = useCallback((confirmed: boolean) => {
    setQueue((currentQueue) => {
      const [currentRequest, ...remainingQueue] = currentQueue;
      if (!currentRequest) return currentQueue;

      queueMicrotask(() => {
        if (currentRequest.kind === 'confirm') {
          currentRequest.resolve(confirmed);
        } else {
          currentRequest.resolve();
        }
      });

      return remainingQueue;
    });
  }, []);

  const showAlert = useCallback((options: AlertOptions) => {
    return new Promise<void>((resolve) => {
      setQueue((currentQueue) => [
        ...currentQueue,
        {
          id: nextIdRef.current++,
          kind: 'alert',
          title: options.title ?? 'Notice',
          description: options.description,
          confirmLabel: options.confirmLabel ?? 'OK',
          tone: options.tone ?? 'default',
          resolve,
        },
      ]);
    });
  }, []);

  const showConfirm = useCallback((options: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      setQueue((currentQueue) => [
        ...currentQueue,
        {
          id: nextIdRef.current++,
          kind: 'confirm',
          title: options.title ?? 'Confirm',
          description: options.description,
          confirmLabel: options.confirmLabel ?? 'Continue',
          cancelLabel: options.cancelLabel ?? 'Cancel',
          tone: options.tone ?? 'default',
          resolve,
        },
      ]);
    });
  }, []);

  useEffect(() => {
    return () => {
      setQueue((currentQueue) => {
        currentQueue.forEach((request) => {
          if (request.kind === 'confirm') {
            request.resolve(false);
          } else {
            request.resolve();
          }
        });
        return [];
      });
    };
  }, []);

  const value = useMemo<ModalContextValue>(() => ({
    showAlert,
    showConfirm,
  }), [showAlert, showConfirm]);

  return (
    <ModalContext.Provider value={value}>
      {children}
      {activeRequest ? (
        <Modal
          open
          onOpenChange={(open) => {
            if (!open) {
              dismissActiveRequest(false);
            }
          }}
          title={activeRequest.title}
          description={activeRequest.description}
          footer={(
            <>
              {activeRequest.kind === 'confirm' ? (
                <Button variant="outline" onClick={() => dismissActiveRequest(false)}>
                  {activeRequest.cancelLabel}
                </Button>
              ) : null}
              <Button
                variant={activeRequest.tone === 'destructive' ? 'destructive' : 'default'}
                onClick={() => dismissActiveRequest(true)}
              >
                {activeRequest.confirmLabel}
              </Button>
            </>
          )}
        />
      ) : null}
    </ModalContext.Provider>
  );
}

export function useModal(): ModalContextValue {
  const context = useContext(ModalContext);
  if (!context) {
    throw new Error('useModal must be used within a ModalProvider.');
  }
  return context;
}
