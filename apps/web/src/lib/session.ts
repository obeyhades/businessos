'use client';

import {
  hasPermission,
  type MembershipDto,
  type Permission,
  type SessionDto,
} from '@businessos/types';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError } from './api';

export const SESSION_QUERY_KEY = ['session'] as const;

/** Current session; resolves to `null` (not an error) when not authenticated. */
export function useSession() {
  return useQuery({
    queryKey: SESSION_QUERY_KEY,
    queryFn: async (): Promise<SessionDto | null> => {
      try {
        return await api.auth.getSession();
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }
    },
    staleTime: 30_000,
    retry: 1,
  });
}

export function activeMembership(session: SessionDto | null | undefined): MembershipDto | null {
  if (!session?.activeOrganizationId) return null;
  return (
    session.memberships.find((m) => m.organization.id === session.activeOrganizationId) ?? null
  );
}

export function can(session: SessionDto | null | undefined, permission: Permission): boolean {
  const membership = activeMembership(session);
  return membership !== null && hasPermission(membership.role, permission);
}
