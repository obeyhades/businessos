'use client';

import {
  Alert,
  AlertDescription,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from '@businessos/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useApiErrorMessage } from '@/lib/errors';

export function EraseOrganizationDialog({
  open,
  onOpenChange,
  orgName,
  orgSlug,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgName: string;
  orgSlug: string;
}) {
  const t = useTranslations('compliance.danger');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const queryClient = useQueryClient();
  const errorMessage = useApiErrorMessage();

  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setTyped('');
      setError(null);
    }
  }, [open]);

  const matches = typed.trim() === orgSlug;

  const eraseMutation = useMutation({
    mutationFn: () => api.compliance.eraseOrganization({ confirmSlug: orgSlug }),
    onSuccess: () => {
      toast.success(t('erased'));
      // The active organization no longer exists; drop all cached data and
      // route through the entry point, which sends the user to onboarding or
      // another organization based on their remaining memberships.
      queryClient.clear();
      router.replace('/');
    },
    onError: (err) => setError(errorMessage(err)),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => (eraseMutation.isPending ? undefined : onOpenChange(next))}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('confirmTitle', { name: orgName })}</DialogTitle>
          <DialogDescription>{t('confirmDescription')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <div className="space-y-2">
            <Label htmlFor="erase-confirm-slug">{t('typeToConfirm')}</Label>
            <p className="font-mono text-sm">{orgSlug}</p>
            <Input
              id="erase-confirm-slug"
              autoComplete="off"
              aria-label={t('slugLabel')}
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
            />
            {typed.length > 0 && !matches ? (
              <p role="alert" className="text-sm text-destructive">
                {t('slugMismatch')}
              </p>
            ) : null}
          </div>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={eraseMutation.isPending}
            onClick={() => onOpenChange(false)}
          >
            {tCommon('cancel')}
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={!matches}
            loading={eraseMutation.isPending}
            onClick={() => eraseMutation.mutate()}
          >
            {t('confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
