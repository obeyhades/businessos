'use client';

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@businessos/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Building2, Check, ChevronsUpDown, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useApiErrorMessage } from '@/lib/errors';
import { activeMembership, useSession } from '@/lib/session';

export function OrgSwitcher() {
  const t = useTranslations('orgSwitcher');
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const errorMessage = useApiErrorMessage();
  const membership = activeMembership(session);

  const switchMutation = useMutation({
    mutationFn: (organizationId: string) => api.organizations.switch({ organizationId }),
    onSuccess: async (nextSession) => {
      // Everything on screen is org-scoped; drop the whole cache.
      await queryClient.invalidateQueries();
      const next = nextSession.memberships.find(
        (m) => m.organization.id === nextSession.activeOrganizationId,
      );
      if (next) toast.success(t('switched', { organization: next.organization.name }));
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  if (!session || !membership) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="max-w-56 justify-between gap-2">
          <Building2 className="size-4 shrink-0" aria-hidden="true" />
          <span className="truncate">{membership.organization.name}</span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>{t('label')}</DropdownMenuLabel>
        {session.memberships.map((m) => {
          const isActive = m.organization.id === session.activeOrganizationId;
          return (
            <DropdownMenuItem
              key={m.organization.id}
              disabled={switchMutation.isPending}
              onSelect={() => {
                if (!isActive) switchMutation.mutate(m.organization.id);
              }}
            >
              <span className="flex-1 truncate">{m.organization.name}</span>
              {isActive ? <Check className="size-4" aria-hidden="true" /> : null}
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => router.push('/onboarding')}>
          <Plus className="size-4" aria-hidden="true" />
          {t('createOrganization')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
