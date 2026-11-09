import {
  forwardRef,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { AlertTriangle, LoaderCircle } from 'lucide-react';
import * as DialogPrimitive from '@radix-ui/react-dialog';

export type ConfirmActionDialogHandle = {
  open: (descriptionOverride?: string) => void;
};

type ConfirmActionDialogProps = {
  title: string;
  description: string;
  confirmLabel: string;
  busyLabel: string;
  cancelLabel: string;
  failureMessage: string;
  recentLoginMessage?: string;
  confirmationPhrase?: string;
  confirmationPhraseLabel?: string;
  onConfirm: () => Promise<void>;
  dir?: 'ltr' | 'rtl';
};

const HISTORY_STATE_KEY = '__yfactoryConfirmSheet';

const ConfirmActionDialog = forwardRef<
  ConfirmActionDialogHandle,
  ConfirmActionDialogProps
>(function ConfirmActionDialog({
  title,
  description,
  confirmLabel,
  busyLabel,
  cancelLabel,
  failureMessage,
  recentLoginMessage,
  confirmationPhrase,
  confirmationPhraseLabel,
  onConfirm,
  dir = 'ltr',
}, ref) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [activeDescription, setActiveDescription] = useState(description);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [phraseValue, setPhraseValue] = useState('');
  const busyRef = useRef(false);
  const phraseInputRef = useRef<HTMLInputElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const historyEntryPushedRef = useRef(false);
  const historyToken = `confirm-${id}`;

  useImperativeHandle(ref, () => ({
    open(descriptionOverride) {
      restoreFocusRef.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      setActiveDescription(descriptionOverride ?? description);
      setError('');
      setPhraseValue('');
      setOpen(true);
    },
  }), [description]);

  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  useEffect(() => {
    if (!open) return;

    const previousBodyOverflow = document.body.style.overflow;
    const previousRootOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';

    const currentState =
      window.history.state && typeof window.history.state === 'object'
        ? window.history.state as Record<string, unknown>
        : {};
    try {
      window.history.pushState(
        { ...currentState, [HISTORY_STATE_KEY]: historyToken },
        '',
        window.location.href,
      );
      historyEntryPushedRef.current = true;
    } catch {
      historyEntryPushedRef.current = false;
    }

    const handlePopState = () => {
      if (!busyRef.current) {
        setOpen(false);
        return;
      }
      const state =
        window.history.state && typeof window.history.state === 'object'
          ? window.history.state as Record<string, unknown>
          : {};
      try {
        window.history.pushState(
          { ...state, [HISTORY_STATE_KEY]: historyToken },
          '',
          window.location.href,
        );
        historyEntryPushedRef.current = true;
      } catch {
        historyEntryPushedRef.current = false;
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousRootOverflow;
      const state =
        window.history.state && typeof window.history.state === 'object'
          ? window.history.state as Record<string, unknown>
          : {};
      if (
        historyEntryPushedRef.current &&
        state[HISTORY_STATE_KEY] === historyToken
      ) {
        window.history.back();
      }
      historyEntryPushedRef.current = false;
    };
  }, [historyToken, open]);

  const confirm = async () => {
    if (busy || (confirmationPhrase && phraseValue !== confirmationPhrase)) {
      return;
    }
    setBusy(true);
    setError('');
    try {
      await onConfirm();
      setOpen(false);
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
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!busy) setOpen(nextOpen);
      }}
    >
      <DialogPrimitive.Portal
        container={typeof document === 'undefined' ? undefined : document.body}
      >
        <DialogPrimitive.Overlay className="confirmation-backdrop" />
        <DialogPrimitive.Content
          className="confirmation-content"
          dir={dir}
          role="alertdialog"
          aria-modal="true"
          data-testid="confirmation-sheet"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            if (confirmationPhrase) phraseInputRef.current?.focus();
            else cancelButtonRef.current?.focus();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (restoreFocusRef.current?.isConnected) {
              restoreFocusRef.current.focus();
            }
          }}
        >
          <header className="confirmation-header">
            <div className="confirmation-icon danger" aria-hidden="true">
              <AlertTriangle size={19} />
            </div>
            <DialogPrimitive.Title className="confirmation-title">
              {title}
            </DialogPrimitive.Title>
            <DialogPrimitive.Description className="confirmation-description">
              {activeDescription}
            </DialogPrimitive.Description>
          </header>
          {confirmationPhrase && (
            <div className="confirmation-phrase-field">
              <label htmlFor={`confirmation-phrase-${id}`}>
                {confirmationPhraseLabel}
              </label>
              <input
                ref={phraseInputRef}
                id={`confirmation-phrase-${id}`}
                type="text"
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                disabled={busy}
                value={phraseValue}
                onChange={(event) => setPhraseValue(event.target.value)}
                aria-required="true"
                data-testid="input-confirmation-phrase"
              />
            </div>
          )}
          {error && (
            <p className="confirmation-error" role="alert">
              {error}
            </p>
          )}
          <div className="confirmation-actions">
            <button
              className="confirmation-button confirmation-danger"
              type="button"
              onClick={() => void confirm()}
              disabled={
                busy ||
                Boolean(
                  confirmationPhrase &&
                  phraseValue !== confirmationPhrase,
                )
              }
              aria-busy={busy}
              data-testid="button-confirm-action"
            >
              {busy && <LoaderCircle className="confirmation-spinner" size={17} />}
              <span>{busy ? busyLabel : confirmLabel}</span>
            </button>
            <DialogPrimitive.Close asChild>
              <button
                ref={cancelButtonRef}
                className="confirmation-button confirmation-cancel"
                type="button"
                disabled={busy}
                data-testid="button-cancel-confirmation"
              >
                {cancelLabel}
              </button>
            </DialogPrimitive.Close>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
});

export default ConfirmActionDialog;
