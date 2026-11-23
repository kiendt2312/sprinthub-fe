const errors: Readonly<Record<string, string>> = {
  ASSIGNEE_NOT_MEMBER: 'The assignee is no longer a workspace member.',
  CSRF_INVALID: 'The request could not be verified. Reload the page and try again.',
  FORBIDDEN: 'You do not have permission to make this change.',
  IDEMPOTENCY_KEY_REUSED: 'This action could not be repeated. Reload and try again.',
  INTERNAL_ERROR: 'The server could not complete the request.',
  INVALID_CREDENTIALS: 'The email or password is incorrect.',
  INVALID_POSITION_ANCHOR: 'The destination order has changed.',
  INVALID_STATUS_TRANSITION: 'This task cannot move directly to that column.',
  MUTATION_OUTCOME_UNKNOWN: 'The server could not confirm whether the change was saved.',
  NETWORK_ERROR: 'The server could not be reached. Check your connection.',
  NOT_FOUND: 'This item does not exist or you no longer have access.',
  PROJECT_ARCHIVED: 'This project is archived.',
  RATE_LIMITED: 'Too many requests. Wait a moment and try again.',
  REDIS_UNAVAILABLE: 'The workspace is temporarily unavailable.',
  SESSION_INVALID: 'Your session expired. Sign in again.',
  SESSION_LIMIT_REACHED: 'This account has reached its session limit.',
  TASK_VERSION_CONFLICT: 'This task changed in another session.',
  USER_SUSPENDED: 'This account has been suspended.',
  VALIDATION_FAILED: 'Check the information you entered and try again.',
  WORKSPACE_SUSPENDED: 'This workspace is suspended.',
};

export function englishError(code: string, params: Record<string, unknown>) {
  if (code === 'COLUMN_FULL') {
    const limit = typeof params.limit === 'number' ? ` It can hold up to ${params.limit} tasks.` : '';
    return `That column is full.${limit}`;
  }

  return errors[code] ?? 'Something went wrong. Try again.';
}
