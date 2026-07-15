'use client';

import type { EmailAccountDto, EmailAccountType } from '@businessos/types';
import {
  Badge,
  Button,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
} from '@businessos/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useApiErrorMessage } from '@/lib/errors';
import { accountLabel, isValidEmailAddress } from './mail-utils';

const ACCOUNT_TYPES: EmailAccountType[] = ['SHARED', 'PERSONAL'];

/** Manager dialog: list, create and delete the org's mailboxes. */
export function AccountManageDialog({
  open,
  onOpenChange,
  accounts,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accounts: EmailAccountDto[];
}) {
  const t = useTranslations('email.accounts');
  const tType = useTranslations('email.accountType');
  const tCommon = useTranslations('common');
  const queryClient = useQueryClient();
  const errorMessage = useApiErrorMessage();

  const [address, setAddress] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [type, setType] = useState<EmailAccountType>('SHARED');
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<EmailAccountDto | undefined>(undefined);

  const createMutation = useMutation({
    mutationFn: () =>
      api.email.createAccount({
        address,
        displayName: displayName.trim().length > 0 ? displayName.trim() : undefined,
        type,
      }),
    onSuccess: async () => {
      toast.success(t('created'));
      setAddress('');
      setDisplayName('');
      setType('SHARED');
      setFormError(null);
      await queryClient.invalidateQueries({ queryKey: ['emailAccounts'] });
    },
    onError: (error) => setFormError(errorMessage(error)),
  });

  const deleteMutation = useMutation({
    mutationFn: (accountId: string) => api.email.removeAccount(accountId),
    onSuccess: async () => {
      toast.success(t('deleted'));
      setDeleteTarget(undefined);
      await queryClient.invalidateQueries({ queryKey: ['emailAccounts'] });
      await queryClient.invalidateQueries({ queryKey: ['emailThreads'] });
    },
    onError: (error) => {
      toast.error(errorMessage(error));
      setDeleteTarget(undefined);
    },
  });

  function onSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!isValidEmailAddress(address.trim())) {
      setFormError(t('invalidAddress'));
      return;
    }
    createMutation.mutate();
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('manage')}</DialogTitle>
            <DialogDescription>{t('manageDescription')}</DialogDescription>
          </DialogHeader>

          {accounts.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('empty')}</p>
          ) : (
            <ul className="space-y-1">
              {accounts.map((account) => (
                <li key={account.id} className="flex items-center gap-2 rounded-md px-2 py-1.5">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {accountLabel(account)}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {account.address}
                    </span>
                  </span>
                  <Badge variant="outline">{tType(account.type)}</Badge>
                  {!account.isActive ? <Badge variant="secondary">{t('inactive')}</Badge> : null}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    aria-label={t('delete')}
                    onClick={() => setDeleteTarget(account)}
                  >
                    <Trash2 aria-hidden="true" className="size-3.5" />
                  </Button>
                </li>
              ))}
            </ul>
          )}

          <Separator />

          <form onSubmit={onSubmit} noValidate className="space-y-4">
            <p className="text-sm font-medium">{t('new')}</p>
            {formError !== null ? (
              <p role="alert" className="text-sm text-destructive">
                {formError}
              </p>
            ) : null}
            <div className="space-y-2">
              <Label htmlFor="account-address">{t('address')}</Label>
              <Input
                id="account-address"
                type="email"
                value={address}
                onChange={(event) => setAddress(event.target.value)}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="account-displayName">{t('displayName')}</Label>
                <Input
                  id="account-displayName"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="account-type">{t('type')}</Label>
                <Select value={type} onValueChange={(value) => setType(value as EmailAccountType)}>
                  <SelectTrigger id="account-type" aria-label={t('type')}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ACCOUNT_TYPES.map((value) => (
                      <SelectItem key={value} value={value}>
                        {tType(value)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex justify-end">
              <Button type="submit" loading={createMutation.isPending}>
                <Plus aria-hidden="true" />
                {t('create')}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteTarget !== undefined}
        onOpenChange={(next) => (next ? undefined : setDeleteTarget(undefined))}
        title={t('delete')}
        description={t('deleteConfirm', { address: deleteTarget?.address ?? '' })}
        confirmLabel={t('delete')}
        cancelLabel={tCommon('cancel')}
        destructive
        pending={deleteMutation.isPending}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
      />
    </>
  );
}
