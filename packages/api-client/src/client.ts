import { z } from 'zod';
import {
  activityDtoSchema,
  attachmentDownloadDtoSchema,
  attachmentDtoSchema,
  auditLogDtoSchema,
  commentDtoSchema,
  contactDtoSchema,
  customerDtoSchema,
  failedJobDtoSchema,
  invitationDtoSchema,
  invitationPreviewDtoSchema,
  memberDtoSchema,
  membershipDtoSchema,
  organizationDtoSchema,
  paginatedSchema,
  projectDtoSchema,
  searchResponseSchema,
  sessionDtoSchema,
  taskDtoSchema,
  userDtoSchema,
  type ChangePasswordBody,
  type CreateContactBody,
  type CreateCustomerBody,
  type CreateInvitationBody,
  type CreateOrganizationBody,
  type CreateProjectBody,
  type CreateTaskBody,
  type CustomerListQuery,
  type EntityKind,
  type ForgotPasswordBody,
  type LoginBody,
  type PaginationQuery,
  type ProjectListQuery,
  type RegisterBody,
  type ResetPasswordBody,
  type SwitchOrganizationBody,
  type TaskListQuery,
  type UpdateContactBody,
  type UpdateCustomerBody,
  type UpdateMemberRoleBody,
  type UpdateOrganizationBody,
  type UpdateProfileBody,
  type UpdateProjectBody,
  type UpdateTaskBody,
} from '@businessos/types';

/** Maps an entity kind to its plural REST path segment. */
const entityPath: Record<EntityKind, 'customers' | 'projects' | 'tasks'> = {
  customer: 'customers',
  project: 'projects',
  task: 'tasks',
};

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
  query?: Record<string, string | number | boolean | undefined>;
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

  /** Multipart upload (attachments). Lets the browser set the content-type + boundary. */
  async function upload<T>(path: string, file: File, schema: z.ZodType<T>): Promise<T> {
    const url = new URL(path, options.baseUrl);
    const form = new FormData();
    form.append('file', file);
    const extraHeaders = options.headers ? await options.headers() : {};
    const response = await fetchImpl(url, {
      method: 'POST',
      credentials: 'include',
      headers: { ...extraHeaders },
      body: form,
      cache: 'no-store',
    });
    const json: unknown = await response.json().catch(() => undefined);
    if (!response.ok) {
      const parsed =
        json && typeof json === 'object' && 'error' in json
          ? (json as { error: { code?: string; message?: string; details?: unknown } }).error
          : undefined;
      throw new ApiError(
        response.status,
        parsed?.code ?? 'unknown_error',
        parsed?.message ?? `Upload failed with status ${response.status}`,
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
      updateProfile: (body: UpdateProfileBody) =>
        request('PATCH', '/v1/me', userDtoSchema, { body }),
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
    customers: {
      list: (query?: Partial<CustomerListQuery>) =>
        request('GET', '/v1/customers', paginatedSchema(customerDtoSchema), { query }),
      get: (customerId: string) => request('GET', `/v1/customers/${customerId}`, customerDtoSchema),
      create: (body: CreateCustomerBody) =>
        request('POST', '/v1/customers', customerDtoSchema, { body }),
      update: (customerId: string, body: UpdateCustomerBody) =>
        request('PATCH', `/v1/customers/${customerId}`, customerDtoSchema, { body }),
      activity: (customerId: string, query?: Partial<PaginationQuery>) =>
        request('GET', `/v1/customers/${customerId}/activity`, paginatedSchema(activityDtoSchema), {
          query,
        }),
    },
    contacts: {
      list: (customerId: string) =>
        request('GET', `/v1/customers/${customerId}/contacts`, z.array(contactDtoSchema)),
      create: (customerId: string, body: CreateContactBody) =>
        request('POST', `/v1/customers/${customerId}/contacts`, contactDtoSchema, { body }),
      update: (customerId: string, contactId: string, body: UpdateContactBody) =>
        request('PATCH', `/v1/customers/${customerId}/contacts/${contactId}`, contactDtoSchema, {
          body,
        }),
      remove: (customerId: string, contactId: string) =>
        request('DELETE', `/v1/customers/${customerId}/contacts/${contactId}`, emptySchema),
    },
    projects: {
      list: (query?: Partial<ProjectListQuery>) =>
        request('GET', '/v1/projects', paginatedSchema(projectDtoSchema), { query }),
      get: (projectId: string) => request('GET', `/v1/projects/${projectId}`, projectDtoSchema),
      create: (body: CreateProjectBody) =>
        request('POST', '/v1/projects', projectDtoSchema, { body }),
      update: (projectId: string, body: UpdateProjectBody) =>
        request('PATCH', `/v1/projects/${projectId}`, projectDtoSchema, { body }),
      activity: (projectId: string, query?: Partial<PaginationQuery>) =>
        request('GET', `/v1/projects/${projectId}/activity`, paginatedSchema(activityDtoSchema), {
          query,
        }),
    },
    tasks: {
      list: (query?: Partial<TaskListQuery>) =>
        request('GET', '/v1/tasks', paginatedSchema(taskDtoSchema), { query }),
      get: (taskId: string) => request('GET', `/v1/tasks/${taskId}`, taskDtoSchema),
      create: (body: CreateTaskBody) => request('POST', '/v1/tasks', taskDtoSchema, { body }),
      update: (taskId: string, body: UpdateTaskBody) =>
        request('PATCH', `/v1/tasks/${taskId}`, taskDtoSchema, { body }),
      remove: (taskId: string) => request('DELETE', `/v1/tasks/${taskId}`, emptySchema),
      activity: (taskId: string, query?: Partial<PaginationQuery>) =>
        request('GET', `/v1/tasks/${taskId}/activity`, paginatedSchema(activityDtoSchema), {
          query,
        }),
    },
    comments: {
      list: (kind: EntityKind, entityId: string) =>
        request('GET', `/v1/${entityPath[kind]}/${entityId}/comments`, z.array(commentDtoSchema)),
      create: (kind: EntityKind, entityId: string, body: string) =>
        request('POST', `/v1/${entityPath[kind]}/${entityId}/comments`, commentDtoSchema, {
          body: { body },
        }),
      remove: (kind: EntityKind, entityId: string, commentId: string) =>
        request('DELETE', `/v1/${entityPath[kind]}/${entityId}/comments/${commentId}`, emptySchema),
    },
    attachments: {
      list: (kind: EntityKind, entityId: string) =>
        request(
          'GET',
          `/v1/${entityPath[kind]}/${entityId}/attachments`,
          z.array(attachmentDtoSchema),
        ),
      upload: (kind: EntityKind, entityId: string, file: File) =>
        upload(`/v1/${entityPath[kind]}/${entityId}/attachments`, file, attachmentDtoSchema),
      downloadUrl: (kind: EntityKind, entityId: string, attachmentId: string) =>
        request(
          'GET',
          `/v1/${entityPath[kind]}/${entityId}/attachments/${attachmentId}/download-url`,
          attachmentDownloadDtoSchema,
        ),
      remove: (kind: EntityKind, entityId: string, attachmentId: string) =>
        request(
          'DELETE',
          `/v1/${entityPath[kind]}/${entityId}/attachments/${attachmentId}`,
          emptySchema,
        ),
    },
    activity: {
      list: (query?: Partial<PaginationQuery>) =>
        request('GET', '/v1/activity', paginatedSchema(activityDtoSchema), { query }),
    },
    search: {
      query: (q: string, limit?: number) =>
        request('GET', '/v1/search', searchResponseSchema, { query: { q, limit } }),
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
