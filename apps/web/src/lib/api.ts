import type {
  AuthUser,
  CreateStoryRequest,
  CreateSessionResponse,
  CreateTurnResponse,
  ReaderProfile,
  ReaderSessionListItem,
  StoryDetail,
  StorySession,
  StorySummary,
  UpdateStoryRequest
} from "@instory/shared";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:4000";

/**
 * Server-only. Never fall back to a NEXT_PUBLIC_* variable here: Next.js inlines
 * those into the client bundle, which would publish the admin credential to every
 * visitor. Admin reads happen in server components and admin writes go through
 * server actions, so this value must stay on the server.
 */
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;

export const SESSION_COOKIE_NAME = "instory_session";

/**
 * Single entry point for reader-facing API calls. This module is imported from both
 * client components and server components/actions, so requests differ per environment:
 *
 * - In the browser the request stays on this origin and is proxied to the API by the
 *   rewrite in next.config.ts. That is what makes the session cookie work: it is
 *   host-only on the web origin, so a browser would never attach it to a request
 *   aimed at a different API host.
 * - On the server there is no origin to be relative to, so the absolute API base is
 *   used and the caller's cookie is forwarded by hand. `next/headers` is imported
 *   lazily so it never reaches the client bundle.
 */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  if (typeof window === "undefined") {
    const { cookies } = await import("next/headers");
    const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
    if (token) {
      headers.set("cookie", `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`);
    }

    return fetch(`${API_BASE}${path}`, { cache: "no-store", ...init, headers });
  }

  return fetch(path, {
    cache: "no-store",
    ...init,
    headers,
    credentials: "include"
  });
}

/** Thrown when the API rejects a call because the caller is not signed in. */
export class UnauthenticatedError extends Error {
  constructor(message = "请先登录后再继续。") {
    super(message);
    this.name = "UnauthenticatedError";
  }
}

export interface AdminStatus {
  service: string;
  storage: {
    type: string;
    databasePath: string;
  };
  counts: {
    stories: number;
    sessions: number;
  };
}

export interface AdminModelConfig {
  provider: "mock" | "openai-compatible";
  baseUrl: string | null;
  model: string | null;
  apiKeyConfigured: boolean;
  updatedAt: string | null;
}

export interface AdminSessionListItem {
  id: string;
  storyId: string;
  createdAt: string;
  updatedAt: string;
  turnCount: number;
}

export interface AdminModerationEvent {
  id: string;
  userId: string | null;
  sessionId: string | null;
  storyId: string | null;
  turnId: string | null;
  surface: "reader_input" | "model_output" | "story_config" | "report";
  action: "allowed" | "flagged" | "blocked";
  status: "open" | "resolved" | "dismissed";
  categories: string[];
  excerpt: string;
  detail: string | null;
  reportedBy: string | null;
  createdAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  resolution: string | null;
}

export interface AdminModerationQueue {
  events: AdminModerationEvent[];
  counts: {
    open: number;
    blockedToday: number;
    flaggedToday: number;
  };
}

export interface AdminModelVerificationResult {
  ok: true;
  provider: "mock" | "openai-compatible";
  model: string | null;
  latencyMs: number;
  narrationLength: number;
  choices: number;
  memoryEvents: number;
  checkedAt: string;
}

export async function listStories(): Promise<StorySummary[]> {
  const response = await apiFetch("/api/stories");
  if (!response.ok) {
    throw new Error("加载故事列表失败");
  }
  const data = (await response.json()) as { stories: StorySummary[] };
  return data.stories;
}

export async function listMyStories(): Promise<StorySummary[]> {
  const response = await apiFetch("/api/me/stories");
  if (response.status === 401) {
    throw new UnauthenticatedError();
  }
  if (!response.ok) {
    throw new Error("加载我的故事失败");
  }
  const data = (await response.json()) as { stories: StorySummary[] };
  return data.stories;
}

export async function listMyStoryDetails(): Promise<StoryDetail[]> {
  const stories = await listMyStories();
  return Promise.all(stories.map((story) => getStoryDetail(story.id)));
}

export async function createSession(storyId: string, readerProfileId?: string | null): Promise<CreateSessionResponse> {
  const response = await apiFetch(`/api/stories/${storyId}/sessions`, {
    method: "POST",
    body: JSON.stringify({
      entryMode: readerProfileId ? "custom_role" : "existing_character",
      characterId: readerProfileId ? null : "lu_qinghe",
      readerProfileId: readerProfileId ?? null
    })
  });

  if (response.status === 401) {
    throw new UnauthenticatedError();
  }

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail ? `创建故事会话失败：${detail}` : "创建故事会话失败");
  }

  return (await response.json()) as CreateSessionResponse;
}

export async function listReaderProfiles(): Promise<ReaderProfile[]> {
  const response = await apiFetch("/api/reader/profiles");
  if (response.status === 401) {
    throw new UnauthenticatedError();
  }
  if (!response.ok) {
    throw new Error("加载我的角色失败");
  }
  const data = (await response.json()) as { profiles: ReaderProfile[] };
  return data.profiles;
}

export async function listReaderSessions(limit = 20): Promise<ReaderSessionListItem[]> {
  const response = await apiFetch(`/api/me/sessions?limit=${limit}`);
  if (response.status === 401) {
    throw new UnauthenticatedError();
  }
  if (!response.ok) {
    throw new Error("加载继续阅读列表失败");
  }
  const data = (await response.json()) as { sessions: ReaderSessionListItem[] };
  return data.sessions;
}

export async function createReaderProfile(input: {
  name: string;
  gender?: string | null;
  visibility?: ReaderProfile["visibility"];
  personality: string;
  avatarUrl?: string | null;
  description: string;
}): Promise<ReaderProfile> {
  const response = await apiFetch("/api/reader/profiles", {
    method: "POST",
    body: JSON.stringify(input)
  });

  if (response.status === 401) {
    throw new UnauthenticatedError();
  }

  if (!response.ok) {
    throw new Error("创建我的角色失败");
  }

  const data = (await response.json()) as { profile: ReaderProfile };
  return data.profile;
}

export async function updateReaderProfile(
  profileId: string,
  input: {
    name: string;
    gender?: string | null;
    visibility?: ReaderProfile["visibility"];
    personality: string;
    avatarUrl?: string | null;
    description: string;
  }
): Promise<ReaderProfile> {
  const response = await apiFetch(`/api/reader/profiles/${profileId}`, {
    method: "PUT",
    body: JSON.stringify(input)
  });

  if (response.status === 401) {
    throw new UnauthenticatedError();
  }

  if (!response.ok) {
    throw new Error("更新我的角色失败");
  }

  const data = (await response.json()) as { profile: ReaderProfile };
  return data.profile;
}

export async function deleteReaderProfile(profileId: string): Promise<void> {
  const response = await apiFetch(`/api/reader/profiles/${profileId}`, {
    method: "DELETE"
  });

  if (response.status === 401) {
    throw new UnauthenticatedError();
  }

  if (!response.ok) {
    throw new Error("删除我的角色失败");
  }
}

export async function createStory(input: CreateStoryRequest): Promise<StoryDetail> {
  const response = await apiFetch("/api/stories", {
    method: "POST",
    body: JSON.stringify(input)
  });

  if (response.status === 401) {
    throw new UnauthenticatedError();
  }

  if (!response.ok) {
    throw new Error("创建故事失败");
  }

  const data = (await response.json()) as { story: StoryDetail };
  return data.story;
}

export async function updateMyStory(storyId: string, input: UpdateStoryRequest): Promise<StoryDetail> {
  const response = await apiFetch(`/api/me/stories/${storyId}`, {
    method: "PUT",
    body: JSON.stringify(input)
  });

  if (response.status === 401) {
    throw new UnauthenticatedError();
  }

  if (!response.ok) {
    throw new Error("更新我的故事失败");
  }

  const data = (await response.json()) as { story: StoryDetail };
  return data.story;
}

export async function deleteMyStory(storyId: string): Promise<void> {
  const response = await apiFetch(`/api/me/stories/${storyId}`, {
    method: "DELETE"
  });

  if (response.status === 401) {
    throw new UnauthenticatedError();
  }

  if (!response.ok) {
    throw new Error("删除我的故事失败");
  }
}

export async function getStoryDetail(storyId: string): Promise<StoryDetail> {
  const response = await apiFetch(`/api/stories/${storyId}`);
  if (!response.ok) {
    throw new Error("加载故事详情失败");
  }
  return (await response.json()) as StoryDetail;
}

export async function getSession(sessionId: string): Promise<StorySession> {
  const response = await apiFetch(`/api/sessions/${sessionId}`);
  if (response.status === 401) {
    throw new UnauthenticatedError();
  }
  if (!response.ok) {
    throw new Error("加载故事会话失败");
  }
  const data = (await response.json()) as { session: StorySession };
  return data.session;
}

export async function createTurn(params: {
  sessionId: string;
  content: string;
  inputType: "free_text" | "choice" | "read_continue";
  choiceId?: string | null;
}): Promise<CreateTurnResponse> {
  const response = await apiFetch(`/api/sessions/${params.sessionId}/turns`, {
    method: "POST",
    body: JSON.stringify({
      inputType: params.inputType,
      content: params.content,
      choiceId: params.choiceId ?? null
    })
  });

  if (response.status === 401) {
    throw new UnauthenticatedError();
  }

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail ? `推进故事失败：${detail}` : "推进故事失败");
  }

  return (await response.json()) as CreateTurnResponse;
}

/** Thrown when the active model provider has no streaming support. */
export class StreamingUnsupportedError extends Error {
  constructor(message = "当前模型不支持流式生成。") {
    super(message);
    this.name = "StreamingUnsupportedError";
  }
}

/** Thrown when the reader has spent today's generation quota. */
export class QuotaExceededError extends Error {
  constructor(message = "今日推进次数已用完，请明天再来。") {
    super(message);
    this.name = "QuotaExceededError";
  }
}

/**
 * Advances a turn while reporting narration as it is written. Resolves with the same
 * payload createTurn returns. Callers should fall back to createTurn on
 * StreamingUnsupportedError, or on any failure raised before the stream completed.
 */
export async function streamTurn(
  params: {
    sessionId: string;
    content: string;
    inputType: "free_text" | "choice" | "read_continue";
    choiceId?: string | null;
    signal?: AbortSignal;
  },
  onDelta: (text: string) => void
): Promise<CreateTurnResponse> {
  const response = await apiFetch(`/api/sessions/${params.sessionId}/turns/stream`, {
    method: "POST",
    signal: params.signal,
    body: JSON.stringify({
      inputType: params.inputType,
      content: params.content,
      choiceId: params.choiceId ?? null
    })
  });

  if (response.status === 401) {
    throw new UnauthenticatedError();
  }

  if (response.status === 501) {
    throw new StreamingUnsupportedError();
  }

  if (response.status === 429) {
    throw new QuotaExceededError((await readApiError(response)) ?? undefined);
  }

  if (!response.ok || !response.body) {
    const detail = await readApiError(response);
    throw new Error(detail ?? "推进故事失败");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let completed: CreateTurnResponse | null = null;
  let failure: string | null = null;

  const handleBlock = (block: string): void => {
    let event: string | null = null;
    const dataLines: string[] = [];

    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) {
        event = line.slice("event:".length).trim();
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice("data:".length).trim());
      }
    }

    if (!event || dataLines.length === 0) {
      return;
    }

    const payload = JSON.parse(dataLines.join("\n")) as unknown;
    if (event === "narration_delta") {
      onDelta((payload as { text: string }).text);
    } else if (event === "complete") {
      completed = payload as CreateTurnResponse;
    } else if (event === "error") {
      failure = (payload as { error?: string }).error ?? "生成失败";
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });

      // Events are separated by a blank line; the tail may be a partial event.
      const blocks = buffer.split("\n\n");
      buffer = blocks.pop() ?? "";
      for (const block of blocks) {
        handleBlock(block);
      }
    }

    if (buffer.trim()) {
      handleBlock(buffer);
    }
  } finally {
    reader.releaseLock();
  }

  if (failure) {
    throw new Error(failure);
  }

  if (!completed) {
    throw new Error("生成中断，未收到完整结果");
  }

  return completed;
}

export async function rewindSession(sessionId: string, timelineNodeId: string): Promise<StorySession> {
  const response = await apiFetch(`/api/sessions/${sessionId}/rewind`, {
    method: "POST",
    body: JSON.stringify({
      timelineNodeId
    })
  });

  if (response.status === 401) {
    throw new UnauthenticatedError();
  }

  if (!response.ok) {
    throw new Error("回退故事进度失败");
  }

  const data = (await response.json()) as { session: StorySession };
  return data.session;
}

export async function resetSession(sessionId: string): Promise<StorySession> {
  const response = await apiFetch(`/api/sessions/${sessionId}/reset`, {
    method: "POST"
  });

  if (response.status === 401) {
    throw new UnauthenticatedError();
  }

  if (!response.ok) {
    throw new Error("重置故事会话失败");
  }

  const data = (await response.json()) as { session: StorySession };
  return data.session;
}

export interface AuthSessionPayload {
  user: AuthUser;
  token: string;
  expiresAt: string;
}

/**
 * The API also sets its own cookie, but that cookie belongs to the API origin and
 * never reaches the browser when the call is made from a server action. The token is
 * returned so the caller can set a cookie on the web origin instead.
 */
export async function registerAccount(input: {
  email: string;
  displayName: string;
  password: string;
}): Promise<AuthSessionPayload> {
  const response = await apiFetch("/api/auth/register", {
    method: "POST",
    body: JSON.stringify(input)
  });

  if (!response.ok) {
    throw new Error((await readApiError(response)) ?? "注册失败，请稍后重试。");
  }

  return (await response.json()) as AuthSessionPayload;
}

export async function loginAccount(input: { email: string; password: string }): Promise<AuthSessionPayload> {
  const response = await apiFetch("/api/auth/login", {
    method: "POST",
    body: JSON.stringify(input)
  });

  if (!response.ok) {
    throw new Error((await readApiError(response)) ?? "登录失败，请稍后重试。");
  }

  return (await response.json()) as AuthSessionPayload;
}

export async function logoutAccount(): Promise<void> {
  await apiFetch("/api/auth/logout", { method: "POST" });
}

/** Returns null instead of throwing when nobody is signed in. */
export async function getCurrentUser(): Promise<AuthUser | null> {
  const response = await apiFetch("/api/auth/me");
  if (!response.ok) {
    return null;
  }

  const data = (await response.json()) as { user: AuthUser };
  return data.user;
}

async function readApiError(response: Response): Promise<string | null> {
  try {
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      return null;
    }
    const data = (await response.json()) as { error?: string };
    return data.error ?? null;
  } catch {
    return null;
  }
}

export interface AdminUsageSummary {
  today: {
    date: string;
    generations: number;
    successes: number;
    failures: number;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    averageLatencyMs: number;
    byModel: Array<{ provider: string; model: string | null; generations: number; totalTokens: number }>;
  };
  dailyTurnQuota: number;
  pricing: { inputPerMillion: number; outputPerMillion: number };
  /** Null when no per-token price is configured. */
  estimatedCost: number | null;
}

export async function getAdminUsage(): Promise<AdminUsageSummary> {
  return adminGet<AdminUsageSummary>("/api/admin/usage");
}

export async function getAdminStatus(): Promise<AdminStatus> {
  return adminGet<AdminStatus>("/api/admin/status");
}

export async function getAdminModelConfig(): Promise<AdminModelConfig> {
  return adminGet<AdminModelConfig>("/api/admin/models");
}

export async function updateAdminModelConfig(input: {
  provider: "mock" | "openai-compatible";
  baseUrl?: string | null;
  model?: string | null;
  apiKey?: string | null;
  clearApiKey?: boolean;
}): Promise<AdminModelConfig> {
  return adminRequest<AdminModelConfig>("/api/admin/models", {
    method: "PUT",
    body: JSON.stringify(input)
  });
}

export async function verifyAdminModelConfig(): Promise<AdminModelVerificationResult> {
  return adminRequest<AdminModelVerificationResult>("/api/admin/models/verify", {
    method: "POST",
    body: JSON.stringify({})
  });
}

export async function getAdminStories(): Promise<StoryDetail[]> {
  const data = await adminGet<{ stories: StoryDetail[] }>("/api/admin/stories");
  return data.stories;
}

export async function updateAdminStorySummary(
  storyId: string,
  input: Omit<StorySummary, "id" | "ownerId">
): Promise<StorySummary> {
  const data = await adminRequest<{ story: StorySummary }>(`/api/admin/stories/${storyId}`, {
    method: "PUT",
    body: JSON.stringify(input)
  });
  return data.story;
}

export async function getAdminSessions(limit = 20): Promise<AdminSessionListItem[]> {
  const data = await adminGet<{ sessions: AdminSessionListItem[] }>(`/api/admin/sessions?limit=${limit}`);
  return data.sessions;
}

export async function getAdminModerationEvents(status?: "open" | "resolved" | "dismissed"): Promise<AdminModerationQueue> {
  const query = status ? `?status=${status}` : "";
  return adminGet<AdminModerationQueue>(`/api/admin/moderation/events${query}`);
}

export async function resolveAdminModerationEvent(
  eventId: string,
  input: { status: "resolved" | "dismissed"; resolution?: string | null }
): Promise<AdminModerationEvent> {
  const data = await adminRequest<{ event: AdminModerationEvent }>(
    `/api/admin/moderation/events/${eventId}/resolve`,
    {
      method: "POST",
      body: JSON.stringify(input)
    }
  );
  return data.event;
}

async function adminGet<T>(path: string): Promise<T> {
  return adminRequest<T>(path);
}

async function adminRequest<T>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  if (typeof window !== "undefined") {
    throw new Error("Admin API 只能在服务端调用，请通过 server component 或 server action 访问。");
  }

  const headers: Record<string, string> = {};
  if (init.body) {
    headers["Content-Type"] = "application/json";
  }
  if (ADMIN_TOKEN) {
    headers.Authorization = `Bearer ${ADMIN_TOKEN}`;
  }

  const response = await fetch(`${API_BASE}${path}`, {
    cache: "no-store",
    ...init,
    headers: {
      ...headers,
      ...init.headers
    }
  });

  if (!response.ok) {
    const errorMessage = await readAdminError(response);
    throw new Error(errorMessage ?? `Admin API 请求失败：${response.status}`);
  }

  return (await response.json()) as T;
}

async function readAdminError(response: Response): Promise<string | null> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return null;
  }

  try {
    const data = (await response.json()) as { error?: unknown; message?: unknown };
    if (typeof data.error === "string") {
      return data.error;
    }
    if (typeof data.message === "string") {
      return data.message;
    }
  } catch {
    return null;
  }

  return null;
}
