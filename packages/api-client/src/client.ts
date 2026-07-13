import { z } from 'zod';
import {
  absenceRequestDtoSchema,
  activityDtoSchema,
  attachmentDownloadDtoSchema,
  attachmentDtoSchema,
  auditLogDtoSchema,
  certificationDtoSchema,
  commentDtoSchema,
  contactDtoSchema,
  customerDtoSchema,
  employeeDocumentDtoSchema,
  employeeDtoSchema,
  employeeNoteDtoSchema,
  expiringCertificationDtoSchema,
  failedJobDtoSchema,
  invitationDtoSchema,
  invitationPreviewDtoSchema,
  memberDtoSchema,
  creditNoteDtoSchema,
  invoiceDtoSchema,
  membershipDtoSchema,
  onboardingTemplateDtoSchema,
  organizationDtoSchema,
  paginatedSchema,
  paymentDtoSchema,
  productDtoSchema,
  projectDtoSchema,
  quoteDtoSchema,
  searchResponseSchema,
  sessionDtoSchema,
  taskDtoSchema,
  userDtoSchema,
  type AbsenceListQuery,
  type ApplyTemplateBody,
  type ChangePasswordBody,
  type CreateAbsenceRequestBody,
  type CreateCertificationBody,
  type CreateContactBody,
  type CreateCreditNoteBody,
  type CreateCustomerBody,
  type CreateEmployeeBody,
  type CreateEmployeeNoteBody,
  type CreateInvitationBody,
  type CreateInvoiceBody,
  type CreateOrganizationBody,
  type CreatePaymentBody,
  type CreateProductBody,
  type CreateProjectBody,
  type CreateQuoteBody,
  type CreateTaskBody,
  type CreateTemplateBody,
  type CustomerListQuery,
  type EmployeeDocumentCategory,
  type EmployeeListQuery,
  type EntityKind,
  type ForgotPasswordBody,
  type InvoiceListQuery,
  type LoginBody,
  type PaginationQuery,
  type ProductListQuery,
  type ProjectListQuery,
  type QuoteListQuery,
  type RegisterBody,
  type ResetPasswordBody,
  type ReviewAbsenceBody,
  type SendInvoiceBody,
  type SwitchOrganizationBody,
  type TaskListQuery,
  type UpdateCertificationBody,
  type UpdateContactBody,
  type UpdateCustomerBody,
  type UpdateEmployeeBody,
  type UpdateInvoiceBody,
  type UpdateMemberRoleBody,
  type UpdateOrganizationBody,
  type UpdateProductBody,
  type UpdateProfileBody,
  type UpdateProjectBody,
  type UpdateQuoteBody,
  type UpdateTaskBody,
  type UpdateTemplateBody,
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
    employees: {
      list: (query?: Partial<EmployeeListQuery>) =>
        request('GET', '/v1/employees', paginatedSchema(employeeDtoSchema), { query }),
      get: (employeeId: string) => request('GET', `/v1/employees/${employeeId}`, employeeDtoSchema),
      create: (body: CreateEmployeeBody) =>
        request('POST', '/v1/employees', employeeDtoSchema, { body }),
      update: (employeeId: string, body: UpdateEmployeeBody) =>
        request('PATCH', `/v1/employees/${employeeId}`, employeeDtoSchema, { body }),
      remove: (employeeId: string) => request('DELETE', `/v1/employees/${employeeId}`, emptySchema),
      activity: (employeeId: string, query?: Partial<PaginationQuery>) =>
        request('GET', `/v1/employees/${employeeId}/activity`, paginatedSchema(activityDtoSchema), {
          query,
        }),
      applyTemplate: (employeeId: string, body: ApplyTemplateBody) =>
        request(
          'POST',
          `/v1/employees/${employeeId}/apply-template`,
          z.object({ createdTaskCount: z.number().int() }),
          { body },
        ),
    },
    employeeNotes: {
      list: (employeeId: string) =>
        request('GET', `/v1/employees/${employeeId}/notes`, z.array(employeeNoteDtoSchema)),
      create: (employeeId: string, body: CreateEmployeeNoteBody) =>
        request('POST', `/v1/employees/${employeeId}/notes`, employeeNoteDtoSchema, { body }),
      remove: (employeeId: string, noteId: string) =>
        request('DELETE', `/v1/employees/${employeeId}/notes/${noteId}`, emptySchema),
    },
    certifications: {
      list: (employeeId: string) =>
        request(
          'GET',
          `/v1/employees/${employeeId}/certifications`,
          z.array(certificationDtoSchema),
        ),
      create: (employeeId: string, body: CreateCertificationBody) =>
        request('POST', `/v1/employees/${employeeId}/certifications`, certificationDtoSchema, {
          body,
        }),
      update: (employeeId: string, certificationId: string, body: UpdateCertificationBody) =>
        request(
          'PATCH',
          `/v1/employees/${employeeId}/certifications/${certificationId}`,
          certificationDtoSchema,
          { body },
        ),
      remove: (employeeId: string, certificationId: string) =>
        request(
          'DELETE',
          `/v1/employees/${employeeId}/certifications/${certificationId}`,
          emptySchema,
        ),
      expiring: (withinDays?: number) =>
        request('GET', '/v1/certifications/expiring', z.array(expiringCertificationDtoSchema), {
          query: { withinDays },
        }),
    },
    absences: {
      list: (query?: Partial<AbsenceListQuery>) =>
        request('GET', '/v1/absence-requests', paginatedSchema(absenceRequestDtoSchema), { query }),
      listForEmployee: (employeeId: string) =>
        request(
          'GET',
          `/v1/employees/${employeeId}/absence-requests`,
          z.array(absenceRequestDtoSchema),
        ),
      create: (employeeId: string, body: CreateAbsenceRequestBody) =>
        request('POST', `/v1/employees/${employeeId}/absence-requests`, absenceRequestDtoSchema, {
          body,
        }),
      review: (absenceId: string, body: ReviewAbsenceBody) =>
        request('POST', `/v1/absence-requests/${absenceId}/review`, absenceRequestDtoSchema, {
          body,
        }),
      cancel: (absenceId: string) =>
        request('POST', `/v1/absence-requests/${absenceId}/cancel`, absenceRequestDtoSchema),
    },
    employeeDocuments: {
      list: (employeeId: string) =>
        request('GET', `/v1/employees/${employeeId}/documents`, z.array(employeeDocumentDtoSchema)),
      upload: (
        employeeId: string,
        file: File,
        options?: { category?: EmployeeDocumentCategory; sensitive?: boolean },
      ) => {
        const params = new URLSearchParams();
        if (options?.category) params.set('category', options.category);
        if (options?.sensitive) params.set('sensitive', 'true');
        const suffix = params.toString() ? `?${params.toString()}` : '';
        return upload(
          `/v1/employees/${employeeId}/documents${suffix}`,
          file,
          employeeDocumentDtoSchema,
        );
      },
      downloadUrl: (employeeId: string, documentId: string) =>
        request(
          'GET',
          `/v1/employees/${employeeId}/documents/${documentId}/download-url`,
          attachmentDownloadDtoSchema,
        ),
      remove: (employeeId: string, documentId: string) =>
        request('DELETE', `/v1/employees/${employeeId}/documents/${documentId}`, emptySchema),
    },
    onboardingTemplates: {
      list: () => request('GET', '/v1/onboarding-templates', z.array(onboardingTemplateDtoSchema)),
      get: (templateId: string) =>
        request('GET', `/v1/onboarding-templates/${templateId}`, onboardingTemplateDtoSchema),
      create: (body: CreateTemplateBody) =>
        request('POST', '/v1/onboarding-templates', onboardingTemplateDtoSchema, { body }),
      update: (templateId: string, body: UpdateTemplateBody) =>
        request('PATCH', `/v1/onboarding-templates/${templateId}`, onboardingTemplateDtoSchema, {
          body,
        }),
      remove: (templateId: string) =>
        request('DELETE', `/v1/onboarding-templates/${templateId}`, emptySchema),
    },
    products: {
      list: (query?: Partial<ProductListQuery>) =>
        request('GET', '/v1/products', paginatedSchema(productDtoSchema), { query }),
      get: (productId: string) => request('GET', `/v1/products/${productId}`, productDtoSchema),
      create: (body: CreateProductBody) =>
        request('POST', '/v1/products', productDtoSchema, { body }),
      update: (productId: string, body: UpdateProductBody) =>
        request('PATCH', `/v1/products/${productId}`, productDtoSchema, { body }),
      remove: (productId: string) => request('DELETE', `/v1/products/${productId}`, emptySchema),
    },
    quotes: {
      list: (query?: Partial<QuoteListQuery>) =>
        request('GET', '/v1/quotes', paginatedSchema(quoteDtoSchema), { query }),
      get: (quoteId: string) => request('GET', `/v1/quotes/${quoteId}`, quoteDtoSchema),
      create: (body: CreateQuoteBody) => request('POST', '/v1/quotes', quoteDtoSchema, { body }),
      update: (quoteId: string, body: UpdateQuoteBody) =>
        request('PATCH', `/v1/quotes/${quoteId}`, quoteDtoSchema, { body }),
      remove: (quoteId: string) => request('DELETE', `/v1/quotes/${quoteId}`, emptySchema),
      send: (quoteId: string) => request('POST', `/v1/quotes/${quoteId}/send`, quoteDtoSchema),
      accept: (quoteId: string) => request('POST', `/v1/quotes/${quoteId}/accept`, quoteDtoSchema),
      decline: (quoteId: string) =>
        request('POST', `/v1/quotes/${quoteId}/decline`, quoteDtoSchema),
      convert: (quoteId: string) =>
        request('POST', `/v1/quotes/${quoteId}/convert`, invoiceDtoSchema),
    },
    invoices: {
      list: (query?: Partial<InvoiceListQuery>) =>
        request('GET', '/v1/invoices', paginatedSchema(invoiceDtoSchema), { query }),
      get: (invoiceId: string) => request('GET', `/v1/invoices/${invoiceId}`, invoiceDtoSchema),
      create: (body: CreateInvoiceBody) =>
        request('POST', '/v1/invoices', invoiceDtoSchema, { body }),
      update: (invoiceId: string, body: UpdateInvoiceBody) =>
        request('PATCH', `/v1/invoices/${invoiceId}`, invoiceDtoSchema, { body }),
      remove: (invoiceId: string) => request('DELETE', `/v1/invoices/${invoiceId}`, emptySchema),
      finalize: (invoiceId: string) =>
        request('POST', `/v1/invoices/${invoiceId}/finalize`, invoiceDtoSchema),
      send: (invoiceId: string, body: SendInvoiceBody = {}) =>
        request('POST', `/v1/invoices/${invoiceId}/send`, invoiceDtoSchema, { body }),
      cancel: (invoiceId: string) =>
        request('POST', `/v1/invoices/${invoiceId}/cancel`, invoiceDtoSchema),
      pdfUrl: (invoiceId: string) =>
        request(
          'GET',
          `/v1/invoices/${invoiceId}/pdf-url`,
          z.object({ url: z.string().url(), expiresInSeconds: z.number().int() }),
        ),
      activity: (invoiceId: string, query?: Partial<PaginationQuery>) =>
        request('GET', `/v1/invoices/${invoiceId}/activity`, paginatedSchema(activityDtoSchema), {
          query,
        }),
      listPayments: (invoiceId: string) =>
        request('GET', `/v1/invoices/${invoiceId}/payments`, z.array(paymentDtoSchema)),
      registerPayment: (invoiceId: string, body: CreatePaymentBody) =>
        request('POST', `/v1/invoices/${invoiceId}/payments`, paymentDtoSchema, { body }),
      removePayment: (invoiceId: string, paymentId: string) =>
        request('DELETE', `/v1/invoices/${invoiceId}/payments/${paymentId}`, emptySchema),
      listCreditNotes: (invoiceId: string) =>
        request('GET', `/v1/invoices/${invoiceId}/credit-notes`, z.array(creditNoteDtoSchema)),
      createCreditNote: (invoiceId: string, body: CreateCreditNoteBody) =>
        request('POST', `/v1/invoices/${invoiceId}/credit-notes`, creditNoteDtoSchema, { body }),
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
