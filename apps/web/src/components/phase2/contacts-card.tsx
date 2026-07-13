'use client';

import {
  createContactBodySchema,
  type ContactDto,
  type CreateContactBody,
} from '@businessos/types';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Label,
} from '@businessos/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { EmptyState, ErrorState, ListSkeleton } from '@/components/data-states';
import { TextField } from '@/components/form-field';
import { api } from '@/lib/api';
import { useApiErrorMessage } from '@/lib/errors';

function toDefaults(contact?: ContactDto): CreateContactBody {
  return {
    name: contact?.name ?? '',
    email: contact?.email ?? '',
    phone: contact?.phone ?? '',
    title: contact?.title ?? '',
    isPrimary: contact?.isPrimary ?? false,
  };
}

function ContactFormDialog({
  customerId,
  open,
  onOpenChange,
  contact,
}: {
  customerId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contact?: ContactDto;
}) {
  const t = useTranslations('contacts');
  const tCommon = useTranslations('common');
  const queryClient = useQueryClient();
  const errorMessage = useApiErrorMessage();
  const isEdit = contact !== undefined;

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm<CreateContactBody>({
    resolver: zodResolver(createContactBodySchema),
    defaultValues: toDefaults(contact),
  });

  useEffect(() => {
    if (open) reset(toDefaults(contact));
  }, [open, contact, reset]);

  const mutation = useMutation({
    mutationFn: (values: CreateContactBody) =>
      isEdit
        ? api.contacts.update(customerId, contact.id, values)
        : api.contacts.create(customerId, values),
    onSuccess: async () => {
      toast.success(isEdit ? t('updated') : t('created'));
      await queryClient.invalidateQueries({ queryKey: ['contacts', customerId] });
      onOpenChange(false);
    },
    onError: (error) => setError('root', { message: errorMessage(error) }),
  });

  const onSubmit = handleSubmit((values) => mutation.mutate(values));

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => (mutation.isPending ? undefined : onOpenChange(next))}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? t('editTitle') : t('addTitle')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={(event) => void onSubmit(event)} noValidate className="space-y-4">
          {errors.root ? <ErrorState message={errors.root.message ?? ''} /> : null}
          <TextField
            id="contact-name"
            label={tCommon('name')}
            error={errors.name?.message}
            {...register('name')}
          />
          <TextField
            id="contact-title"
            label={t('jobTitle')}
            error={errors.title?.message}
            {...register('title')}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              id="contact-email"
              type="email"
              label={tCommon('email')}
              error={errors.email?.message}
              {...register('email')}
            />
            <TextField
              id="contact-phone"
              label={t('phone')}
              error={errors.phone?.message}
              {...register('phone')}
            />
          </div>
          <div className="flex items-center gap-2">
            <input
              id="contact-isPrimary"
              type="checkbox"
              className="size-4 rounded border-input"
              {...register('isPrimary')}
            />
            <Label htmlFor="contact-isPrimary">{t('markPrimary')}</Label>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={mutation.isPending}
              onClick={() => onOpenChange(false)}
            >
              {tCommon('cancel')}
            </Button>
            <Button type="submit" loading={mutation.isPending}>
              {tCommon('save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ContactsCard({
  customerId,
  canManage,
}: {
  customerId: string;
  canManage: boolean;
}) {
  const t = useTranslations('contacts');
  const tCommon = useTranslations('common');
  const queryClient = useQueryClient();
  const errorMessage = useApiErrorMessage();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ContactDto | undefined>(undefined);
  const [deleteTarget, setDeleteTarget] = useState<ContactDto | null>(null);

  const contactsQuery = useQuery({
    queryKey: ['contacts', customerId],
    queryFn: () => api.contacts.list(customerId),
  });

  const deleteMutation = useMutation({
    mutationFn: (contactId: string) => api.contacts.remove(customerId, contactId),
    onSuccess: async () => {
      toast.success(t('deleted'));
      setDeleteTarget(null);
      await queryClient.invalidateQueries({ queryKey: ['contacts', customerId] });
    },
    onError: (error) => {
      toast.error(errorMessage(error));
      setDeleteTarget(null);
    },
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle>{t('title')}</CardTitle>
        {canManage ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setEditing(undefined);
              setFormOpen(true);
            }}
          >
            <Plus aria-hidden="true" />
            {t('add')}
          </Button>
        ) : null}
      </CardHeader>
      <CardContent>
        {contactsQuery.isPending ? (
          <ListSkeleton rows={2} />
        ) : contactsQuery.isError ? (
          <ErrorState
            message={errorMessage(contactsQuery.error)}
            onRetry={() => void contactsQuery.refetch()}
          />
        ) : contactsQuery.data.length === 0 ? (
          <EmptyState title={t('empty')} />
        ) : (
          <ul className="divide-y divide-border">
            {contactsQuery.data.map((contact) => (
              <li key={contact.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{contact.name}</span>
                    {contact.isPrimary ? <Badge variant="secondary">{t('primary')}</Badge> : null}
                  </div>
                  {contact.title ? (
                    <p className="text-sm text-muted-foreground">{contact.title}</p>
                  ) : null}
                  <p className="text-sm text-muted-foreground">
                    {[contact.email, contact.phone].filter(Boolean).join(' · ') || '—'}
                  </p>
                </div>
                {canManage ? (
                  <div className="flex shrink-0 gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setEditing(contact);
                        setFormOpen(true);
                      }}
                    >
                      {tCommon('edit')}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setDeleteTarget(contact)}
                    >
                      {tCommon('remove')}
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <ContactFormDialog
        customerId={customerId}
        open={formOpen}
        onOpenChange={setFormOpen}
        contact={editing}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title={t('deleteTitle')}
        description={deleteTarget ? t('deleteDescription', { name: deleteTarget.name }) : undefined}
        confirmLabel={tCommon('remove')}
        cancelLabel={tCommon('cancel')}
        destructive
        pending={deleteMutation.isPending}
        onConfirm={() => {
          if (deleteTarget) deleteMutation.mutate(deleteTarget.id);
        }}
      />
    </Card>
  );
}
