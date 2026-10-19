import { AlertTriangle } from 'lucide-react';
import { answerConfirm, useConfirmStore } from '../os/confirm';
import { useT } from '../os/i18n';
import { Button, Dialog } from '../ui';

/** Renders the pending confirmation request of the confirm service as a modal dialog. */
export function ConfirmHost() {
  const t = useT();
  const pending = useConfirmStore((s) => s.pending);
  return (
    <Dialog
      open={!!pending}
      onClose={() => answerConfirm(false)}
      title={
        <span className="sh-row">
          <AlertTriangle size={16} className="sh-confirm__icon" aria-hidden /> {pending?.title}
        </span>
      }
      description={pending?.body}
      width={440}
      footer={
        <>
          <Button onClick={() => answerConfirm(false)}>{t('common.cancel')}</Button>
          <Button variant={pending?.danger ? 'danger' : 'primary'} onClick={() => answerConfirm(true)}>
            {pending?.confirmLabel}
          </Button>
        </>
      }
    />
  );
}
