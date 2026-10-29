import { useEffect, useState } from 'react';
import { AlertTriangle, LoaderCircle } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

type ConfirmActionDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  busyLabel: string;
  cancelLabel: string;
  failureMessage: string;
  recentLoginMessage?: string;
  onConfirm: () => Promise<void>;
  dir?: 'ltr' | 'rtl';
  danger?: boolean;
};

export default function ConfirmActionDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  busyLabel,
  cancelLabel,
  failureMessage,
  recentLoginMessage,
  onConfirm,
  dir = 'ltr',
  danger = false,
}: ConfirmActionDialogProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) setError('');
  }, [open]);

  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await onConfirm();
      onOpenChange(false);
    } catch (actionError) {
      const code =
        typeof actionError === 'object' &&
        actionError !== null &&
        'code' in actionError &&
        typeof actionError.code === 'string'
          ? actionError.code
          : '';
      setError(
        code === 'auth/requires-recent-login' && recentLoginMessage
          ? recentLoginMessage
          : failureMessage,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <AlertDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!busy) onOpenChange(nextOpen);
      }}
    >
      <AlertDialogContent className="confirmation-content" dir={dir}>
        <AlertDialogHeader className="confirmation-header">
          <div
            className={`confirmation-icon${danger ? ' danger' : ''}`}
            aria-hidden="true"
          >
            <AlertTriangle size={19} />
          </div>
          <AlertDialogTitle className="confirmation-title">
            {title}
          </AlertDialogTitle>
          <AlertDialogDescription className="confirmation-description">
            {description}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && (
          <p className="confirmation-error" role="alert">
            {error}
          </p>
        )}
        <AlertDialogFooter className="confirmation-actions">
          <AlertDialogCancel
            className="confirmation-button confirmation-cancel"
            disabled={busy}
          >
            {cancelLabel}
          </AlertDialogCancel>
          <button
            type="button"
            className={`confirmation-button${danger ? ' confirmation-danger' : ' confirmation-primary'}`}
            onClick={() => void confirm()}
            disabled={busy}
          >
            {busy && <LoaderCircle className="confirmation-spinner" size={16} />}
            <span>{busy ? busyLabel : confirmLabel}</span>
          </button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
