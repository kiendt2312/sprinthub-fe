import { ulid } from 'ulid';
import { englishError } from './en';
import type { components, paths } from './schema';

type Schemas = components['schemas'];
export type Profile = Schemas['ProfileDto'];
export type Project = Schemas['ProjectDto'];
export type Workspace = Schemas['WorkspaceDto'];
export type Board = Schemas['BoardDto'];
export type BoardCard = Schemas['BoardCardDto'];
export type Task = Schemas['TaskDto'];
export type Status = Task['status'];
export type TaskUpdate = Schemas['UpdateTaskDto'];
export type TaskMove = Schemas['MoveTaskDto'];

// The HTTP body may omit priority and let the server apply its default.
type CreateTaskBody = Omit<Schemas['CreateTaskDto'], 'priority'> & Partial<Pick<Schemas['CreateTaskDto'], 'priority'>>;

export const sessionInvalidEvent = 'sprinthub:session-invalid';

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    public readonly params: Record<string, unknown> = {},
  ) {
    super(englishError(code, params));
    this.name = 'ApiError';
  }
}

export function errorMessage(error: unknown) {
  return error instanceof ApiError ? error.message : englishError('INTERNAL_ERROR', {});
}

export function isCreateOutcomeUnknown(error: unknown): boolean {
  return error instanceof ApiError && (
    error.code === 'NETWORK_ERROR'
    || error.code === 'MUTATION_OUTCOME_UNKNOWN'
    || (error.status >= 200 && error.status < 300)
    || error.status >= 500
  );
}

export function newMutation() {
  return { idempotencyKey: ulid(), clientMutationId: ulid() };
}

type Mutation = ReturnType<typeof newMutation>;

type ApiPath = keyof paths extends infer Route
  ? Route extends `/api/v1${infer Suffix}` ? Suffix : never
  : never;

const apiBase = '/api/v1';

async function request<T>(
  path: string,
  init?: RequestInit,
  validateSuccess?: (body: T, status: number) => boolean,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(apiBase + path, { ...init, cache: 'no-store', credentials: 'same-origin' });
  } catch (error) {
    if (init?.signal?.aborted) throw error;
    throw new ApiError('NETWORK_ERROR', 0);
  }

  if (response.status === 204 && !validateSuccess) return undefined as T;

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const { code, params } = (body as Schemas['ErrorEnvelopeDto'] | null)?.error ?? {};
    const apiError = new ApiError(code ?? 'INTERNAL_ERROR', response.status, params ?? {});
    if (apiError.code === 'SESSION_INVALID' && typeof window !== 'undefined') {
      window.dispatchEvent(new Event(sessionInvalidEvent));
    }
    throw apiError;
  }
  if (body === null || (validateSuccess && !validateSuccess(body, response.status))) {
    throw new ApiError('INTERNAL_ERROR', response.status);
  }
  return body as T;
}

async function read<T extends { data: unknown }>(path: string): Promise<T['data']> {
  const { data } = await request<T>(path);
  return data;
}

async function list<T>(path: string): Promise<T[]> {
  const all: T[] = [];
  let cursor: string | null = null;
  do {
    const search = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
    const page: { data: T[]; nextCursor: string | null } = await request(path + search);
    all.push(...page.data);
    cursor = page.nextCursor;
  } while (cursor);
  return all;
}

function write(method: 'PATCH' | 'POST', body?: object, mutation?: Mutation): RequestInit {
  const headers = new Headers({ 'X-CSRF-Protection': '1' });
  if (body) headers.set('Content-Type', 'application/json');
  if (mutation) {
    headers.set('Idempotency-Key', mutation.idempotencyKey);
    headers.set('X-Client-Mutation-Id', mutation.clientMutationId);
  }
  return { method, body: body ? JSON.stringify(body) : undefined, headers };
}

function route(template: ApiPath, ...ids: string[]) {
  for (const id of ids) template = template.replace(/\{[^{}]+\}/u, encodeURIComponent(id)) as ApiPath;
  return template;
}

function create<T extends { data: { id: string }; seq: number; requestId: string }>(
  path: ApiPath,
  body: object,
  mutation: Mutation,
): Promise<T> {
  return request<T>(path, write('POST', body, mutation), (result, status) => (
    status === 201
    && typeof result.data?.id === 'string' && result.data.id.length > 0
    && Number.isSafeInteger(result.seq)
    && typeof result.requestId === 'string' && result.requestId.length > 0
  ));
}

export const api = {
  register: (body: Schemas['RegisterDto']): Promise<Schemas['RegisterAcceptedDto']> =>
    request('/auth/register', write('POST', body), (result, status) => (
      status === 202 && result.status === 'accepted'
      && typeof result.requestId === 'string' && result.requestId.length > 0
    )),
  async login(credentials: Schemas['LoginDto']): Promise<Profile> {
    const { data } = await request<Schemas['ProfileEnvelopeDto']>('/auth/login', write('POST', credentials));
    return data;
  },
  logout: () => request<void>('/auth/logout', write('POST')),
  me: () => read<Schemas['ProfileEnvelopeDto']>('/users/me'),
  workspaces: () => list<Workspace>('/workspaces'),
  async createWorkspace(body: Schemas['CreateWorkspaceDto'], mutation: Mutation): Promise<Workspace> {
    const { data } = await create<Schemas['WorkspaceEnvelopeDto']>('/workspaces', body, mutation);
    return data;
  },
  workspace: (id: string) => read<Schemas['WorkspaceEnvelopeDto']>(route('/workspaces/{workspaceId}', id)),
  projects: (workspaceId: string) => list<Project>(route('/workspaces/{workspaceId}/projects', workspaceId)),
  async createProject(workspaceId: string, body: Schemas['CreateProjectDto'], mutation: Mutation): Promise<Project> {
    const { data } = await create<Schemas['ProjectEnvelopeDto']>(route('/workspaces/{workspaceId}/projects', workspaceId), body, mutation);
    return data;
  },
  project: (id: string) => read<Schemas['ProjectEnvelopeDto']>(route('/projects/{projectId}', id)),
  board: (projectId: string) => read<Schemas['BoardEnvelopeDto']>(route('/projects/{projectId}/board', projectId)),
  task: (id: string) => read<Schemas['TaskEnvelopeDto']>(route('/tasks/{taskId}', id)),
  createTask: (projectId: string, body: CreateTaskBody, mutation: Mutation): Promise<Schemas['TaskPlacementEnvelopeDto']> =>
    create(route('/projects/{projectId}/tasks', projectId), body, mutation),
  updateTask: (id: string, body: TaskUpdate, mutation = newMutation()) =>
    request<Schemas['TaskMutationEnvelopeDto']>(route('/tasks/{taskId}', id), write('PATCH', body, mutation)),
  moveTask: (id: string, body: TaskMove, mutation = newMutation()) =>
    request<Schemas['TaskPlacementEnvelopeDto']>(route('/tasks/{taskId}/move', id), write('PATCH', body, mutation)),
};
