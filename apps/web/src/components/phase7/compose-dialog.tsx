'use client';

import type { EmailAccountDto } from '@businessos/types';
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from '@businessos/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Send, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useApiErrorMessage } from '@/lib/errors';
import { AddressChipsInput } from './address-chips-input';
import { accountLabel } from './mail-utils';

export interface ComposeInitial {
  /** Reply target; omitted for a brand-new conversation. */
  threadId?: string;
  /** Existing DRAFT being edited; omitted when composing fresh. */
  draftId?: string;
  accountId?: string;
  to?: string[];
  cc?: string[];
  subject?: string;
  bodyText?: string;
}

/**
 * Compose / reply / edit-draft dialog. "Save draft" persists via
 * compose/updateDraft; "Send" persists first, then queues the draft.
 */
export function ComposeDialog({
  open,
  onOpenChange,
  accounts,
  initial,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accounts: EmailAccountDto[];
  initial?: ComposeInitial;
}) {
  const t = useTranslations('email.composeDialog');
  const tCommon = useTranslations('common');
  const queryClient = useQueryClient();
  const errorMessage = useApiErrorMessage();

  const isReply = initial?.threadId !== undefined;
  const sendableAccounts = accounts.filter((account) => account.isActive);

  const [draftId, setDraftId] = useState<string | undefined>(undefined);
  const [accountId, setAccountId] = useState('');
  const [to, setTo] = useState<string[]>([]);
  const [cc, setCc] = useState<string[]>([]);
  const [subject, setSubject] = useState('');
  const [bodyText, setBodyText] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setDraftId(initial?.draftId);
    setAccountId(initial?.accountId ?? sendableAccounts[0]?.id ?? '');
    setTo(initial?.to ?? []);
    setCc(initial?.cc ?? []);
    setSubject(initial?.subject ?? '');
    setBodyText(initial?.bodyText ?? '');
    setFormError(null);
    // Intentionally keyed on dialog open only: re-syncing on every accounts
    // refetch would clobber in-progress edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial]);

  function validate(): string | null {
    if (accountId.length === 0) return t('accountRequired');
    if (to.length === 0) return t('toRequired');
    if (subject.trim().length === 0) return t('subjectRequired');
    return null;
  }

  /** Creates or updates the draft and returns its message id. */
  async function persistDraft(): Promise<string> {
    if (draftId !== undefined) {
      const updated = await api.email.updateDraft(draftId, {
        to,
        cc,
        subject: subject.trim(),
        bodyText,
      });
      return updated.id;
    }
    const created = await api.email.compose({
      accountId,
      threadId: initial?.threadId,
      to,
      cc,
      subject: subject.trim(),
      bodyText,
    });
    setDraftId(created.id);
    return created.id;
  }

  const invalidate = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: ['emailThreads'] });
    if (initial?.threadId !== undefined) {
      await queryClient.invalidateQueries({ queryKey: ['emailThread', initial.threadId] });
    }
  };

  const saveDraftMutation = useMutation({
    mutationFn: persistDraft,
    onSuccess: async () => {
      toast.success(t('draftSaved'));
      await invalidate();
      onOpenChange(false);
    },
    onError: (error) => setFormError(errorMessage(error)),
  });

  const sendMutation = useMutation({
    mutationFn: async () => {
      const messageId = await persistDraft();
      return api.email.send(messageId);
    },
    onSuccess: async (thread) => {
      toast.success(t('sent'));
      queryClient.setQueryData(['emailThread', thread.id], thread);
      await invalidate();
      onOpenChange(false);
    },
    onError: (error) => setFormError(errorMessage(error)),
  });

  const deleteDraftMutation = useMutation({
    mutationFn: (messageId: string) => api.email.deleteDraft(messageId),
    onSuccess: async () => {
      toast.success(t('draftDeleted'));
      await invalidate();
      onOpenChange(false);
    },
    onError: (error) => setFormError(errorMessage(error)),
  });

  const pending =
    saveDraftMutation.isPending || sendMutation.isPending || deleteDraftMutation.isPending;

  function onSend(): void {
    const error = validate();
    if (error !== null) {
      setFormError(error);
      return;
    }
    setFormError(null);
    sendMutation.mutate();
  }

  function onSaveDraft(): void {
    const error = validate();
    if (error !== null) {
      setFormError(error);
      return;
    }
    setFormError(null);
    saveDraftMutation.mutate();
  }

  const title =
    initial?.draftId !== undefined ? t('editDraftTitle') : isReply ? t('replyTitle') : t('title');

  return (
    <Dialog open={open} onOpenChange={(next) => (pending ? undefined : onOpenChange(next))}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {formError !== null ? (
            <p role="alert" className="text-sm text-destructive">
              {formError}
            </p>
          ) : null}

          {!isReply ? (
            <div className="space-y-2">
              <Label htmlFor="compose-account">{t('from')}</Label>
              <Select value={accountId} onValueChange={setAccountId}>
                <SelectTrigger id="compose-account" aria-label={t('from')}>
                  <SelectValue placeholder={t('accountRequired')} />
                </SelectTrigger>
                <SelectContent>
                  {sendableAccounts.map((account) => (
                    <SelectItem key={account.id} value={account.id}>
                      {accountLabel(account)} ({account.address})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="compose-to">{t('to')}</Label>
            <AddressChipsInput id="compose-to" value={to} onChange={setTo} disabled={pending} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="compose-cc">{t('cc')}</Label>
            <AddressChipsInput id="compose-cc" value={cc} onChange={setCc} disabled={pending} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="compose-subject">{t('subject')}</Label>
            <Input
              id="compose-subject"
              value={subject}
              disabled={pending}
              onChange={(event) => setSubject(event.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="compose-body">{t('body')}</Label>
            <Textarea
              id="compose-body"
              rows={10}
              value={bodyText}
              disabled={pending}
              onChange={(event) => setBodyText(event.target.value)}
            />
          </div>

          <DialogFooter className="gap-2 sm:justify-between">
            <div>
              {draftId !== undefined ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={pending}
                  loading={deleteDraftMutation.isPending}
                  onClick={() => deleteDraftMutation.mutate(draftId)}
                >
                  <Trash2 aria-hidden="true" />
                  {t('deleteDraft')}
                </Button>
              ) : null}
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => onOpenChange(false)}
              >
                {tCommon('cancel')}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                loading={saveDraftMutation.isPending}
                onClick={onSaveDraft}
              >
                {t('saveDraft')}
              </Button>
              <Button
                type="button"
                disabled={pending}
                loading={sendMutation.isPending}
                onClick={onSend}
              >
                <Send aria-hidden="true" />
                {t('send')}
              </Button>
            </div>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
