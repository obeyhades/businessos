'use client';

import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@businessos/ui';
import { Copy } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

/**
 * Presents a signing secret that the API returns exactly once (on create and
 * on rotate). The copy button uses the async clipboard API when available.
 */
export function WebhookSecretDialog({
  open,
  onOpenChange,
  secret,
  context,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  secret: string | null;
  context: 'created' | 'rotated';
}) {
  const t = useTranslations('integrations.secret');

  async function copy(): Promise<void> {
    if (secret === null) return;
    try {
      await navigator.clipboard.writeText(secret);
      toast.success(t('copied'));
    } catch {
      toast.error(t('copy'));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{context === 'rotated' ? t('rotatedTitle') : t('createdTitle')}</DialogTitle>
          <DialogDescription>{t('intro')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Alert variant="destructive">
            <AlertTitle>{t('warning')}</AlertTitle>
            <AlertDescription>{t('usage')}</AlertDescription>
          </Alert>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 overflow-x-auto rounded-md border border-border bg-muted px-3 py-2 font-mono text-sm">
              {secret}
            </code>
            <Button type="button" variant="outline" onClick={() => void copy()}>
              <Copy aria-hidden="true" />
              {t('copy')}
            </Button>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" onClick={() => onOpenChange(false)}>
            {t('done')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
