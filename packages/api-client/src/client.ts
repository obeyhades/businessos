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
  accountDtoSchema,
  accountMappingDtoSchema,
  fiscalYearDtoSchema,
  fiscalPeriodDtoSchema,
  voucherDtoSchema,
  voucherAttachmentDtoSchema,
  trialBalanceDtoSchema,
  generalLedgerDtoSchema,
  calendarDtoSchema,
  eventDtoSchema,
  occurrenceDtoSchema,
  agendaItemDtoSchema,
  freeBusyDtoSchema,
  emailAccountDtoSchema,
  emailThreadDtoSchema,
  emailThreadDetailDtoSchema,
  emailMessageDtoSchema,
  emailLabelDtoSchema,
  recordingDtoSchema,
  webhookEndpointDtoSchema,
  webhookEndpointWithSecretDtoSchema,
  webhookDeliveryDtoSchema,
  webhookPingResultSchema,
  dataExportJobDtoSchema,
  retentionPolicyDtoSchema,
  eraseOrganizationResultSchema,
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
  type AccountListQuery,
  type CreateAccountBody,
  type UpdateAccountBody,
  type CreateFiscalYearBody,
  type CreateFiscalPeriodBody,
  type UpdateFiscalPeriodStatusBody,
  type CreateVoucherBody,
  type UpdateVoucherBody,
  type VoucherListQuery,
  type ReverseVoucherBody,
  type ReconcileVoucherBody,
  type UpdateAccountMappingBody,
  type ReportQuery,
  type GeneralLedgerQuery,
  type CreateCalendarBody,
  type UpdateCalendarBody,
  type CreateEventBody,
  type UpdateEventBody,
  type EventRangeQuery,
  type OverrideOccurrenceBody,
  type CancelOccurrenceBody,
  type RsvpBody,
  type AddAttendeeBody,
  type AgendaQuery,
  type FreeBusyQuery,
  type CreateEmailAccountBody,
  type UpdateEmailAccountBody,
  type ThreadListQuery,
  type CreateMessageBody,
  type UpdateMessageBody,
  type MoveThreadBody,
  type StarThreadBody,
  type ReadThreadBody,
  type LinkThreadBody,
  type AddLabelBody,
  type EmailToTaskBody,
  type CreateEmailLabelBody,
  type RecordingListQuery,
  type CreateCallLogBody,
  type UpdateRecordingBody,
  type RecordingToTaskBody,
  type RecordingToInvoiceBody,
  type CreateWebhookEndpointBody,
  type UpdateWebhookEndpointBody,
  type WebhookDeliveryListQuery,
  type UpdateRetentionPolicyBody,
  type EraseOrganizationBody,
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
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
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
    accounting: {
      // Chart of accounts
      listAccounts: (query?: Partial<AccountListQuery>) =>
        request('GET', '/v1/accounting/accounts', paginatedSchema(accountDtoSchema), { query }),
      getAccount: (accountId: string) =>
        request('GET', `/v1/accounting/accounts/${accountId}`, accountDtoSchema),
      createAccount: (body: CreateAccountBody) =>
        request('POST', '/v1/accounting/accounts', accountDtoSchema, { body }),
      updateAccount: (accountId: string, body: UpdateAccountBody) =>
        request('PATCH', `/v1/accounting/accounts/${accountId}`, accountDtoSchema, { body }),
      removeAccount: (accountId: string) =>
        request('DELETE', `/v1/accounting/accounts/${accountId}`, emptySchema),
      // Account mapping
      getMapping: () => request('GET', '/v1/accounting/mapping', accountMappingDtoSchema),
      updateMapping: (body: UpdateAccountMappingBody) =>
        request('PUT', '/v1/accounting/mapping', accountMappingDtoSchema, { body }),
      // Fiscal years & periods
      listFiscalYears: () =>
        request('GET', '/v1/accounting/fiscal-years', z.array(fiscalYearDtoSchema)),
      getFiscalYear: (fiscalYearId: string) =>
        request('GET', `/v1/accounting/fiscal-years/${fiscalYearId}`, fiscalYearDtoSchema),
      createFiscalYear: (body: CreateFiscalYearBody) =>
        request('POST', '/v1/accounting/fiscal-years', fiscalYearDtoSchema, { body }),
      addPeriod: (fiscalYearId: string, body: CreateFiscalPeriodBody) =>
        request(
          'POST',
          `/v1/accounting/fiscal-years/${fiscalYearId}/periods`,
          fiscalPeriodDtoSchema,
          {
            body,
          },
        ),
      setPeriodStatus: (periodId: string, body: UpdateFiscalPeriodStatusBody) =>
        request('PATCH', `/v1/accounting/periods/${periodId}/status`, fiscalPeriodDtoSchema, {
          body,
        }),
      // Vouchers (journal entries)
      listVouchers: (query?: Partial<VoucherListQuery>) =>
        request('GET', '/v1/accounting/vouchers', paginatedSchema(voucherDtoSchema), { query }),
      getVoucher: (voucherId: string) =>
        request('GET', `/v1/accounting/vouchers/${voucherId}`, voucherDtoSchema),
      createVoucher: (body: CreateVoucherBody) =>
        request('POST', '/v1/accounting/vouchers', voucherDtoSchema, { body }),
      updateVoucher: (voucherId: string, body: UpdateVoucherBody) =>
        request('PATCH', `/v1/accounting/vouchers/${voucherId}`, voucherDtoSchema, { body }),
      removeVoucher: (voucherId: string) =>
        request('DELETE', `/v1/accounting/vouchers/${voucherId}`, emptySchema),
      postVoucher: (voucherId: string) =>
        request('POST', `/v1/accounting/vouchers/${voucherId}/post`, voucherDtoSchema),
      reverseVoucher: (voucherId: string, body: ReverseVoucherBody = {}) =>
        request('POST', `/v1/accounting/vouchers/${voucherId}/reverse`, voucherDtoSchema, { body }),
      reconcileVoucher: (voucherId: string, body: ReconcileVoucherBody) =>
        request('POST', `/v1/accounting/vouchers/${voucherId}/reconcile`, voucherDtoSchema, {
          body,
        }),
      listVoucherAttachments: (voucherId: string) =>
        request(
          'GET',
          `/v1/accounting/vouchers/${voucherId}/attachments`,
          z.array(voucherAttachmentDtoSchema),
        ),
      voucherAttachmentDownloadUrl: (voucherId: string, attachmentId: string) =>
        request(
          'GET',
          `/v1/accounting/vouchers/${voucherId}/attachments/${attachmentId}/download-url`,
          attachmentDownloadDtoSchema,
        ),
      removeVoucherAttachment: (voucherId: string, attachmentId: string) =>
        request(
          'DELETE',
          `/v1/accounting/vouchers/${voucherId}/attachments/${attachmentId}`,
          emptySchema,
        ),
      // Reports
      trialBalance: (query?: Partial<ReportQuery>) =>
        request('GET', '/v1/accounting/reports/trial-balance', trialBalanceDtoSchema, { query }),
      generalLedger: (query?: Partial<GeneralLedgerQuery>) =>
        request('GET', '/v1/accounting/reports/general-ledger', generalLedgerDtoSchema, { query }),
    },
    calendar: {
      listCalendars: () => request('GET', '/v1/calendars', z.array(calendarDtoSchema)),
      createCalendar: (body: CreateCalendarBody) =>
        request('POST', '/v1/calendars', calendarDtoSchema, { body }),
      updateCalendar: (calendarId: string, body: UpdateCalendarBody) =>
        request('PATCH', `/v1/calendars/${calendarId}`, calendarDtoSchema, { body }),
      removeCalendar: (calendarId: string) =>
        request('DELETE', `/v1/calendars/${calendarId}`, emptySchema),
      // Events — range returns expanded occurrences.
      listEvents: (query: EventRangeQuery) =>
        request('GET', '/v1/events', z.array(occurrenceDtoSchema), { query }),
      getEvent: (eventId: string) => request('GET', `/v1/events/${eventId}`, eventDtoSchema),
      createEvent: (body: CreateEventBody) =>
        request('POST', '/v1/events', eventDtoSchema, { body }),
      updateEvent: (eventId: string, body: UpdateEventBody) =>
        request('PATCH', `/v1/events/${eventId}`, eventDtoSchema, { body }),
      removeEvent: (eventId: string) => request('DELETE', `/v1/events/${eventId}`, emptySchema),
      cancelEvent: (eventId: string) =>
        request('POST', `/v1/events/${eventId}/cancel`, eventDtoSchema),
      cancelOccurrence: (eventId: string, body: CancelOccurrenceBody) =>
        request('POST', `/v1/events/${eventId}/occurrences/cancel`, emptySchema, { body }),
      overrideOccurrence: (eventId: string, body: OverrideOccurrenceBody) =>
        request('POST', `/v1/events/${eventId}/occurrences/override`, emptySchema, { body }),
      addAttendee: (eventId: string, body: AddAttendeeBody) =>
        request('POST', `/v1/events/${eventId}/attendees`, eventDtoSchema, { body }),
      removeAttendee: (eventId: string, userId: string) =>
        request('DELETE', `/v1/events/${eventId}/attendees/${userId}`, eventDtoSchema),
      rsvp: (eventId: string, body: RsvpBody) =>
        request('POST', `/v1/events/${eventId}/rsvp`, eventDtoSchema, { body }),
      // Agenda & free/busy
      agenda: (query: AgendaQuery) =>
        request('GET', '/v1/agenda', z.array(agendaItemDtoSchema), { query }),
      freeBusy: (query: FreeBusyQuery) =>
        request('GET', '/v1/calendar/free-busy', freeBusyDtoSchema, { query }),
    },
    email: {
      // Mailboxes
      listAccounts: () => request('GET', '/v1/email/accounts', z.array(emailAccountDtoSchema)),
      createAccount: (body: CreateEmailAccountBody) =>
        request('POST', '/v1/email/accounts', emailAccountDtoSchema, { body }),
      updateAccount: (accountId: string, body: UpdateEmailAccountBody) =>
        request('PATCH', `/v1/email/accounts/${accountId}`, emailAccountDtoSchema, { body }),
      removeAccount: (accountId: string) =>
        request('DELETE', `/v1/email/accounts/${accountId}`, emptySchema),
      // Labels
      listLabels: () => request('GET', '/v1/email/labels', z.array(emailLabelDtoSchema)),
      createLabel: (body: CreateEmailLabelBody) =>
        request('POST', '/v1/email/labels', emailLabelDtoSchema, { body }),
      removeLabel: (labelId: string) =>
        request('DELETE', `/v1/email/labels/${labelId}`, emptySchema),
      // Threads
      listThreads: (query?: Partial<ThreadListQuery>) =>
        request('GET', '/v1/email/threads', paginatedSchema(emailThreadDtoSchema), { query }),
      getThread: (threadId: string) =>
        request('GET', `/v1/email/threads/${threadId}`, emailThreadDetailDtoSchema),
      markRead: (threadId: string, body: ReadThreadBody) =>
        request('POST', `/v1/email/threads/${threadId}/read`, emailThreadDetailDtoSchema, { body }),
      star: (threadId: string, body: StarThreadBody) =>
        request('POST', `/v1/email/threads/${threadId}/star`, emailThreadDtoSchema, { body }),
      move: (threadId: string, body: MoveThreadBody) =>
        request('POST', `/v1/email/threads/${threadId}/move`, emailThreadDtoSchema, { body }),
      link: (threadId: string, body: LinkThreadBody) =>
        request('PATCH', `/v1/email/threads/${threadId}/link`, emailThreadDtoSchema, { body }),
      addLabel: (threadId: string, body: AddLabelBody) =>
        request('POST', `/v1/email/threads/${threadId}/labels`, emailThreadDtoSchema, { body }),
      removeThreadLabel: (threadId: string, labelId: string) =>
        request('DELETE', `/v1/email/threads/${threadId}/labels/${labelId}`, emailThreadDtoSchema),
      toTask: (threadId: string, body: EmailToTaskBody) =>
        request('POST', `/v1/email/threads/${threadId}/task`, taskDtoSchema, { body }),
      // Messages (compose / reply / send)
      compose: (body: CreateMessageBody) =>
        request('POST', '/v1/email/messages', emailMessageDtoSchema, { body }),
      updateDraft: (messageId: string, body: UpdateMessageBody) =>
        request('PATCH', `/v1/email/messages/${messageId}`, emailMessageDtoSchema, { body }),
      deleteDraft: (messageId: string) =>
        request('DELETE', `/v1/email/messages/${messageId}`, emptySchema),
      send: (messageId: string) =>
        request('POST', `/v1/email/messages/${messageId}/send`, emailThreadDetailDtoSchema),
    },

    recordings: {
      list: (query?: Partial<RecordingListQuery>) =>
        request('GET', '/v1/recordings', paginatedSchema(recordingDtoSchema), { query }),
      get: (recordingId: string) =>
        request('GET', `/v1/recordings/${recordingId}`, recordingDtoSchema),
      uploadVoiceNote: (
        file: File,
        meta: {
          title: string;
          durationSeconds?: number;
          occurredAt?: string;
          customerId?: string;
          projectId?: string;
          taskId?: string;
        },
      ) => {
        const params = new URLSearchParams();
        params.set('title', meta.title);
        if (meta.durationSeconds !== undefined) {
          params.set('durationSeconds', String(meta.durationSeconds));
        }
        if (meta.occurredAt) params.set('occurredAt', meta.occurredAt);
        if (meta.customerId) params.set('customerId', meta.customerId);
        if (meta.projectId) params.set('projectId', meta.projectId);
        if (meta.taskId) params.set('taskId', meta.taskId);
        return upload(`/v1/recordings/voice-notes?${params.toString()}`, file, recordingDtoSchema);
      },
      createCallLog: (body: CreateCallLogBody) =>
        request('POST', '/v1/recordings/call-logs', recordingDtoSchema, { body }),
      update: (recordingId: string, body: UpdateRecordingBody) =>
        request('PATCH', `/v1/recordings/${recordingId}`, recordingDtoSchema, { body }),
      remove: (recordingId: string) =>
        request('DELETE', `/v1/recordings/${recordingId}`, emptySchema),
      audioUrl: (recordingId: string) =>
        request('GET', `/v1/recordings/${recordingId}/audio`, attachmentDownloadDtoSchema),
      retranscribe: (recordingId: string) =>
        request('POST', `/v1/recordings/${recordingId}/retranscribe`, recordingDtoSchema),
      toTask: (recordingId: string, body: RecordingToTaskBody) =>
        request('POST', `/v1/recordings/${recordingId}/task`, taskDtoSchema, { body }),
      toInvoice: (recordingId: string, body: RecordingToInvoiceBody) =>
        request('POST', `/v1/recordings/${recordingId}/invoice`, invoiceDtoSchema, { body }),
    },

    webhooks: {
      list: () => request('GET', '/v1/webhooks', z.array(webhookEndpointDtoSchema)),
      create: (body: CreateWebhookEndpointBody) =>
        request('POST', '/v1/webhooks', webhookEndpointWithSecretDtoSchema, { body }),
      get: (endpointId: string) =>
        request('GET', `/v1/webhooks/${endpointId}`, webhookEndpointDtoSchema),
      update: (endpointId: string, body: UpdateWebhookEndpointBody) =>
        request('PATCH', `/v1/webhooks/${endpointId}`, webhookEndpointDtoSchema, { body }),
      remove: (endpointId: string) =>
        request('DELETE', `/v1/webhooks/${endpointId}`, emptySchema),
      rotateSecret: (endpointId: string) =>
        request(
          'POST',
          `/v1/webhooks/${endpointId}/rotate-secret`,
          webhookEndpointWithSecretDtoSchema,
        ),
      ping: (endpointId: string) =>
        request('POST', `/v1/webhooks/${endpointId}/ping`, webhookPingResultSchema),
      listDeliveries: (endpointId: string, query?: Partial<WebhookDeliveryListQuery>) =>
        request(
          'GET',
          `/v1/webhooks/${endpointId}/deliveries`,
          paginatedSchema(webhookDeliveryDtoSchema),
          { query },
        ),
      redeliver: (endpointId: string, deliveryId: string) =>
        request(
          'POST',
          `/v1/webhooks/${endpointId}/deliveries/${deliveryId}/redeliver`,
          webhookDeliveryDtoSchema,
        ),
    },

    compliance: {
      requestExport: () =>
        request('POST', '/v1/organization/export', dataExportJobDtoSchema),
      listExports: () =>
        request('GET', '/v1/organization/exports', z.array(dataExportJobDtoSchema)),
      getExport: (jobId: string) =>
        request('GET', `/v1/organization/exports/${jobId}`, dataExportJobDtoSchema),
      exportDownloadUrl: (jobId: string) =>
        request('GET', `/v1/organization/exports/${jobId}/download`, attachmentDownloadDtoSchema),
      getRetention: () =>
        request('GET', '/v1/organization/retention', retentionPolicyDtoSchema),
      updateRetention: (body: UpdateRetentionPolicyBody) =>
        request('PUT', '/v1/organization/retention', retentionPolicyDtoSchema, { body }),
      eraseOrganization: (body: EraseOrganizationBody) =>
        request('DELETE', '/v1/organization', eraseOrganizationResultSchema, { body }),
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
