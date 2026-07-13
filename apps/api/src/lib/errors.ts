/**
 * Application errors carry a stable machine-readable code and a safe message.
 * The global error handler converts them to the error envelope; anything else
 * becomes an opaque 500 so internals never leak to clients.
 */
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const errors = {
  unauthorized: () => new AppError(401, 'unauthorized', 'Authentication required'),
  invalidCredentials: () => new AppError(401, 'invalid_credentials', 'Invalid email or password'),
  forbidden: (message = 'You do not have permission to perform this action') =>
    new AppError(403, 'forbidden', message),
  noActiveOrganization: () =>
    new AppError(403, 'no_active_organization', 'No active organization selected'),
  notFound: (resource = 'Resource') => new AppError(404, 'not_found', `${resource} not found`),
  conflict: (code: string, message: string) => new AppError(409, code, message),
  badRequest: (code: string, message: string, details?: unknown) =>
    new AppError(400, code, message, details),
  csrfRejected: () => new AppError(403, 'csrf_rejected', 'Cross-origin request rejected'),
} as const;
