'use client';

import {
  ASSIGNABLE_ROLES,
  createInvitationBodySchema,
  type AssignableRole,
  type CreateInvitationBody,
  type InvitationDto,
  type MemberDto,
} from '@businessos/types';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from '@businessos/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { EmptyState, ErrorState, ListSkeleton } from '@/components/data-states';
import { TextField } from '@/components/form-field';
import { Pagination } from '@/components/pagination';
import { api } from '@/lib/api';
import { useApiErrorMessage } from '@/lib/errors';
import { can, useSession } from '@/lib/session';

const PAGE_SIZE = 25;

function RoleBadge({ role }: { role: MemberDto['role'] | AssignableRole }) {
  const tRoles = useTranslations('roles');
  return <Badge variant={role === 'OWNER' ? 'default' : 'secondary'}>{tRoles(role)}</Badge>;
}

function InviteForm() {
  const t = useTranslations('members.invite');
  const tCommon = useTranslations('common');
  const tRoles = useTranslations('roles');
  const queryClient = useQueryClient();
  const errorMessage = useApiErrorMessage();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors },
  } = useForm<CreateInvitationBody>({
    resolver: zodResolver(createInvitationBodySchema),
    defaultValues: { email: '', role: 'EMPLOYEE' },
  });

  const inviteMutation = useMutation({
    mutationFn: (body: CreateInvitationBody) => api.invitations.create(body),
    onSuccess: async (invitation) => {
      toast.success(t('success', { email: invitation.email }));
      reset();
      await queryClient.invalidateQueries({ queryKey: ['invitations'] });
    },
    onError: (error) => setFormError(errorMessage(error)),
  });

  const onSubmit = handleSubmit((values) => {
    setFormError(null);
    inviteMutation.mutate(values);
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={(event) => void onSubmit(event)}
          noValidate
          className="flex flex-col gap-4 sm:flex-row sm:items-end"
        >
          <div className="flex-1">
            <TextField
              id="invite-email"
              type="email"
              label={tCommon('email')}
              error={errors.email?.message}
              {...register('email')}
            />
          </div>
          <div className="w-full space-y-2 sm:w-48">
            <Label htmlFor="invite-role">{tCommon('role')}</Label>
            <Controller
              control={control}
              name="role"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="invite-role" aria-label={tCommon('role')}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ASSIGNABLE_ROLES.map((role) => (
                      <SelectItem key={role} value={role}>
                        {tRoles(role)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </div>
          <Button type="submit" loading={inviteMutation.isPending}>
            {t('submit')}
          </Button>
        </form>
        {formError ? (
          <div className="mt-4">
            <ErrorState message={formError} />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function PendingInvitations() {
  const t = useTranslations('members.pending');
  const tRoles = useTranslations('roles');
  const format = useFormatter();
  const queryClient = useQueryClient();
  const errorMessage = useApiErrorMessage();
  const [revokeTarget, setRevokeTarget] = useState<InvitationDto | null>(null);

  const invitationsQuery = useQuery({
    queryKey: ['invitations'],
    queryFn: () => api.invitations.list(),
  });

  const revokeMutation = useMutation({
    mutationFn: (invitationId: string) => api.invitations.revoke(invitationId),
    onSuccess: async () => {
      toast.success(t('revokeSuccess'));
      setRevokeTarget(null);
      await queryClient.invalidateQueries({ queryKey: ['invitations'] });
    },
    onError: (error) => {
      toast.error(errorMessage(error));
      setRevokeTarget(null);
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
      </CardHeader>
      <CardContent>
        {invitationsQuery.isPending ? (
          <ListSkeleton rows={3} />
        ) : invitationsQuery.isError ? (
          <ErrorState
            message={errorMessage(invitationsQuery.error)}
            onRetry={() => void invitationsQuery.refetch()}
          />
        ) : invitationsQuery.data.length === 0 ? (
          <EmptyState title={t('empty')} />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>{t('email')}</TH>
                <TH>{t('role')}</TH>
                <TH>{t('invitedBy')}</TH>
                <TH>{t('expires')}</TH>
                <TH className="w-24" />
              </TR>
            </THead>
            <TBody>
              {invitationsQuery.data.map((invitation) => (
                <TR key={invitation.id}>
                  <TD>{invitation.email}</TD>
                  <TD>
                    <Badge variant="outline">{tRoles(invitation.role)}</Badge>
                  </TD>
                  <TD>{invitation.invitedBy?.name ?? '—'}</TD>
                  <TD>
                    {format.dateTime(new Date(invitation.expiresAt), { dateStyle: 'medium' })}
                  </TD>
                  <TD className="text-right">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setRevokeTarget(invitation)}
                    >
                      {t('revoke')}
                    </Button>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </CardContent>
      <RevokeDialog
        target={revokeTarget}
        pending={revokeMutation.isPending}
        onCancel={() => setRevokeTarget(null)}
        onConfirm={(invitation) => revokeMutation.mutate(invitation.id)}
      />
    </Card>
  );
}

function RevokeDialog({
  target,
  pending,
  onCancel,
  onConfirm,
}: {
  target: InvitationDto | null;
  pending: boolean;
  onCancel: () => void;
  onConfirm: (invitation: InvitationDto) => void;
}) {
  const t = useTranslations('members.pending');
  const tCommon = useTranslations('common');
  return (
    <ConfirmDialog
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
      title={t('revokeTitle')}
      description={target ? t('revokeDescription', { email: target.email }) : undefined}
      confirmLabel={t('revoke')}
      cancelLabel={tCommon('cancel')}
      destructive
      pending={pending}
      onConfirm={() => {
        if (target) onConfirm(target);
      }}
    />
  );
}

function MembersTable() {
  const t = useTranslations('members');
  const tCommon = useTranslations('common');
  const tRoles = useTranslations('roles');
  const format = useFormatter();
  const queryClient = useQueryClient();
  const errorMessage = useApiErrorMessage();
  const { data: session } = useSession();

  const canUpdateRole = can(session, 'members.update_role');
  const canRemove = can(session, 'members.remove');

  const [page, setPage] = useState(1);
  const [roleChange, setRoleChange] = useState<{ member: MemberDto; role: AssignableRole } | null>(
    null,
  );
  const [removeTarget, setRemoveTarget] = useState<MemberDto | null>(null);

  const membersQuery = useQuery({
    queryKey: ['members', page],
    queryFn: () => api.members.list({ page, pageSize: PAGE_SIZE }),
  });

  const roleMutation = useMutation({
    mutationFn: ({ member, role }: { member: MemberDto; role: AssignableRole }) =>
      api.members.updateRole(member.id, { role }),
    onSuccess: async () => {
      toast.success(t('changeRole.success'));
      setRoleChange(null);
      await queryClient.invalidateQueries({ queryKey: ['members'] });
    },
    onError: (error) => {
      toast.error(errorMessage(error));
      setRoleChange(null);
    },
  });

  const removeMutation = useMutation({
    mutationFn: (member: MemberDto) => api.members.remove(member.id),
    onSuccess: async () => {
      toast.success(t('remove.success'));
      setRemoveTarget(null);
      await queryClient.invalidateQueries({ queryKey: ['members'] });
    },
    onError: (error) => {
      toast.error(errorMessage(error));
      setRemoveTarget(null);
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
      </CardHeader>
      <CardContent>
        {membersQuery.isPending ? (
          <ListSkeleton rows={5} />
        ) : membersQuery.isError ? (
          <ErrorState
            message={errorMessage(membersQuery.error)}
            onRetry={() => void membersQuery.refetch()}
          />
        ) : membersQuery.data.items.length === 0 ? (
          <EmptyState title={t('empty')} />
        ) : (
          <>
            <Table>
              <THead>
                <TR>
                  <TH>{t('table.name')}</TH>
                  <TH>{t('table.email')}</TH>
                  <TH>{t('table.role')}</TH>
                  <TH>{t('table.joined')}</TH>
                  {canRemove ? <TH className="w-24" /> : null}
                </TR>
              </THead>
              <TBody>
                {membersQuery.data.items.map((member) => {
                  const isSelf = member.user.id === session?.user.id;
                  const roleEditable = canUpdateRole && !isSelf && member.role !== 'OWNER';
                  return (
                    <TR key={member.id}>
                      <TD className="font-medium">
                        {member.user.name}
                        {isSelf ? (
                          <Badge variant="outline" className="ml-2">
                            {tCommon('you')}
                          </Badge>
                        ) : null}
                      </TD>
                      <TD>{member.user.email}</TD>
                      <TD>
                        {roleEditable ? (
                          <Select
                            value={member.role}
                            onValueChange={(value) =>
                              setRoleChange({ member, role: value as AssignableRole })
                            }
                          >
                            <SelectTrigger
                              className="w-44"
                              aria-label={`${tCommon('role')}: ${member.user.name}`}
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {ASSIGNABLE_ROLES.map((role) => (
                                <SelectItem key={role} value={role}>
                                  {tRoles(role)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <RoleBadge role={member.role} />
                        )}
                      </TD>
                      <TD>
                        {format.dateTime(new Date(member.createdAt), { dateStyle: 'medium' })}
                      </TD>
                      {canRemove ? (
                        <TD className="text-right">
                          {!isSelf && member.role !== 'OWNER' ? (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => setRemoveTarget(member)}
                            >
                              {t('remove.action')}
                            </Button>
                          ) : null}
                        </TD>
                      ) : null}
                    </TR>
                  );
                })}
              </TBody>
            </Table>
            <Pagination
              page={membersQuery.data.page}
              totalPages={membersQuery.data.totalPages}
              onPageChange={setPage}
            />
          </>
        )}
      </CardContent>

      <ConfirmDialog
        open={roleChange !== null}
        onOpenChange={(open) => {
          if (!open) setRoleChange(null);
        }}
        title={t('changeRole.title')}
        description={
          roleChange
            ? t('changeRole.description', {
                name: roleChange.member.user.name,
                role: tRoles(roleChange.role),
              })
            : undefined
        }
        confirmLabel={tCommon('confirm')}
        cancelLabel={tCommon('cancel')}
        pending={roleMutation.isPending}
        onConfirm={() => {
          if (roleChange) roleMutation.mutate(roleChange);
        }}
      />

      <ConfirmDialog
        open={removeTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRemoveTarget(null);
        }}
        title={t('remove.title')}
        description={
          removeTarget ? t('remove.description', { name: removeTarget.user.name }) : undefined
        }
        confirmLabel={t('remove.action')}
        cancelLabel={tCommon('cancel')}
        destructive
        pending={removeMutation.isPending}
        onConfirm={() => {
          if (removeTarget) removeMutation.mutate(removeTarget);
        }}
      />
    </Card>
  );
}

export default function MembersPage() {
  const t = useTranslations('members');
  const { data: session } = useSession();
  const canInvite = can(session, 'members.invite');

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
      {canInvite ? <InviteForm /> : null}
      <MembersTable />
      {canInvite ? <PendingInvitations /> : null}
    </div>
  );
}
