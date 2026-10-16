export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly code?: string
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const Errors = {
  emailGenerationDisabled: () =>
    new AppError(503, "Email address generation is disabled until an owned mail domain is configured", "EMAIL_GENERATION_DISABLED"),
  notFound: (resource = "Resource") =>
    new AppError(404, `${resource} not found`, "NOT_FOUND"),

  unauthorized: () =>
    new AppError(401, "Unauthorized", "UNAUTHORIZED"),

  forbidden: () =>
    new AppError(403, "Forbidden", "FORBIDDEN"),

  badRequest: (message: string) =>
    new AppError(400, message, "BAD_REQUEST"),

  tooManyRequests: () =>
    new AppError(429, "Too many requests", "RATE_LIMITED"),

  conflict: (message: string) =>
    new AppError(409, message, "CONFLICT"),

  inboxExpired: () =>
    new AppError(410, "This inbox has expired", "INBOX_EXPIRED"),

  inboxFull: () =>
    new AppError(422, "Inbox message limit reached", "INBOX_FULL"),

  messageTooLarge: () =>
    new AppError(413, "Message exceeds size limit", "MESSAGE_TOO_LARGE"),

  internal: () =>
    new AppError(500, "An internal error occurred", "INTERNAL_ERROR"),
} as const;
