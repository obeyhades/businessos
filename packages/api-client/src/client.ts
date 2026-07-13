import { z } from 'zod';
import {
  auditLogDtoSchema,
  failedJobDtoSchema,
  invitationDtoSchema,
  invitationPreviewDtoSchema,
  memberDtoSchema,
  membershipDtoSchema,
  organizationDtoSchema,
  paginatedSchema,
  sessionDtoSchema,
  userDtoSchema,
  type ChangePasswordBody,
  type CreateInvitationBody,
  type CreateOrganizationBody,
  type ForgotPasswordBody,
  type LoginBody,
  type PaginationQuery,
  type RegisterBody,
  type ResetPasswordBody,
  type SwitchOrganizationBody,
  type UpdateMemberRoleBody,
  type UpdateOrganizationBody,
  type UpdateProfileBody,
} from '@businessos/types';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ApiClientOptions {
  baseUrl: string;
  /** Custom fetch (e.g. Next.js server-side fetch). Defaults to global fetch. */
  fetch?: typeof fetch;
  /** Extra headers per request — used server-side to forward the session cookie. */
  headers?: () => Record<string, string> | Promise<Record<string, string>>;
}

interface RequestOptions {
  body?: unknown;
  query?: Record<string, string | number | undefined>;
}

const emptySchema = z.unknown();

export function createApiClient(options: ApiClientOptions) {
  const fetchImpl = options.fetch ?? fetch;

  async function request<T>(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    schema: z.ZodType<T>,
    { body, query }: RequestOptions = {},
  ): Promise<T> {
    const url = new URL(path, options.baseUrl);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) url.searchParams.set(key, String(value));
      }
    }
    const extraHeaders = options.headers ? await options.headers() : {};
    const response = await fetchImpl(url, {
      method,
      credentials: 'include',
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...extraHeaders,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    });

    if (response.status === 204) {
      return undefined as T;
    }

    const json: unknown = await response.json().catch(() => undefined);

    if (!response.ok) {
      const parsed =
        json && typeof json === 'object' && 'error' in json
          ? (json as { error: { code?: string; message?: string; details?: unknown } }).error
          : undefined;
      throw new ApiError(
        response.status,
        parsed?.code ?? 'unknown_error',
        parsed?.message ?? `Request failed with status ${response.status}`,
        parsed?.details,
      );
    }

    return schema.parse(json);
  }

  return {
    auth: {
      register: (body: RegisterBody) =>
        request('POST', '/v1/auth/register', sessionDtoSchema, { body }),
      login: (body: LoginBody) => request('POST', '/v1/auth/login', sessionDtoSchema, { body }),
      logout: () => request('POST', '/v1/auth/logout', emptySchema),
      forgotPassword: (body: ForgotPasswordBody) =>
        request('POST', '/v1/auth/forgot-password', emptySchema, { body }),
      resetPassword: (body: ResetPasswordBody) =>
        request('POST', '/v1/auth/reset-password', emptySchema, { body }),
      getSession: () => request('GET', '/v1/auth/session', sessionDtoSchema),
    },
    me: {
      updateProfile: (body: UpdateProfileBody) => request('PATCH', '/v1/me', userDtoSchema, { body }),
      changePassword: (body: ChangePasswordBody) =>
        request('PATCH', '/v1/me/password', emptySchema, { body }),
    },
    organizations: {
      create: (body: CreateOrganizationBody) =>
        request('POST', '/v1/organizations', organizationDtoSchema, { body }),
      list: () => request('GET', '/v1/organizations', z.array(membershipDtoSchema)),
      current: () => request('GET', '/v1/organizations/current', organizationDtoSchema),
      update: (body: UpdateOrganizationBody) =>
        request('PATCH', '/v1/organizations/current', organizationDtoSchema, { body }),
      switch: (body: SwitchOrganizationBody) =>
        request('POST', '/v1/organizations/switch', sessionDtoSchema, { body }),
    },
    members: {
      list: (query?: Partial<PaginationQuery>) =>
        request('GET', '/v1/organizations/current/members', paginatedSchema(memberDtoSchema), {
          query,
        }),
      updateRole: (memberId: string, body: UpdateMemberRoleBody) =>
        request('PATCH', `/v1/organizations/current/members/${memberId}`, memberDtoSchema, {
          body,
        }),
      remove: (memberId: string) =>
        request('DELETE', `/v1/organizations/current/members/${memberId}`, emptySchema),
    },
    invitations: {
      create: (body: CreateInvitationBody) =>
        request('POST', '/v1/organizations/current/invitations', invitationDtoSchema, { body }),
      list: () =>
        request('GET', '/v1/organizations/current/invitations', z.array(invitationDtoSchema)),
      revoke: (invitationId: string) =>
        request('DELETE', `/v1/organizations/current/invitations/${invitationId}`, emptySchema),
      preview: (token: string) =>
        request('GET', `/v1/invitations/${token}`, invitationPreviewDtoSchema),
      accept: (token: string) =>
        request('POST', `/v1/invitations/${token}/accept`, sessionDtoSchema),
    },
    auditLogs: {
      list: (query?: Partial<PaginationQuery>) =>
        request('GET', '/v1/organizations/current/audit-logs', paginatedSchema(auditLogDtoSchema), {
          query,
        }),
    },
    admin: {
      listFailedJobs: (query?: Partial<PaginationQuery>) =>
        request('GET', '/v1/admin/failed-jobs', paginatedSchema(failedJobDtoSchema), { query }),
      retryFailedJob: (failedJobId: string) =>
        request('POST', `/v1/admin/failed-jobs/${failedJobId}/retry`, emptySchema),
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
