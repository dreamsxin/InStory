import type {
  CreateStoryRequest,
  CreateSessionResponse,
  CreateTurnResponse,
  ReaderProfile,
  StoryDetail,
  StorySession,
  StorySummary
} from "@instory/shared";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:4000";
const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? process.env.NEXT_PUBLIC_ADMIN_TOKEN;

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
  type: string;
  status: string;
  createdAt: string;
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
  const response = await fetch(`${API_BASE}/api/stories`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error("加载故事列表失败");
  }
  const data = (await response.json()) as { stories: StorySummary[] };
  return data.stories;
}

export async function createSession(storyId: string, readerProfileId?: string | null): Promise<CreateSessionResponse> {
  const response = await fetch(`${API_BASE}/api/stories/${storyId}/sessions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      entryMode: readerProfileId ? "custom_role" : "existing_character",
      characterId: readerProfileId ? null : "lu_qinghe",
      readerProfileId: readerProfileId ?? null
    })
  });

  if (!response.ok) {
    throw new Error("创建故事会话失败");
  }

  return (await response.json()) as CreateSessionResponse;
}

export async function listReaderProfiles(): Promise<ReaderProfile[]> {
  const response = await fetch(`${API_BASE}/api/reader/profiles`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error("加载我的角色失败");
  }
  const data = (await response.json()) as { profiles: ReaderProfile[] };
  return data.profiles;
}

export async function createReaderProfile(input: {
  name: string;
  gender?: string | null;
  personality: string;
  avatarUrl?: string | null;
  description: string;
}): Promise<ReaderProfile> {
  const response = await fetch(`${API_BASE}/api/reader/profiles`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(input)
  });

  if (!response.ok) {
    throw new Error("创建我的角色失败");
  }

  const data = (await response.json()) as { profile: ReaderProfile };
  return data.profile;
}

export async function createStory(input: CreateStoryRequest): Promise<StoryDetail> {
  const response = await fetch(`${API_BASE}/api/stories`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(input)
  });

  if (!response.ok) {
    throw new Error("创建故事失败");
  }

  const data = (await response.json()) as { story: StoryDetail };
  return data.story;
}

export async function getStoryDetail(storyId: string): Promise<StoryDetail> {
  const response = await fetch(`${API_BASE}/api/stories/${storyId}`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error("加载故事详情失败");
  }
  return (await response.json()) as StoryDetail;
}

export async function getSession(sessionId: string): Promise<StorySession> {
  const response = await fetch(`${API_BASE}/api/sessions/${sessionId}`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error("加载故事会话失败");
  }
  const data = (await response.json()) as { session: StorySession };
  return data.session;
}

export async function createTurn(params: {
  sessionId: string;
  content: string;
  inputType: "free_text" | "choice";
  choiceId?: string | null;
}): Promise<CreateTurnResponse> {
  const response = await fetch(`${API_BASE}/api/sessions/${params.sessionId}/turns`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      inputType: params.inputType,
      content: params.content,
      choiceId: params.choiceId ?? null
    })
  });

  if (!response.ok) {
    throw new Error("推进故事失败");
  }

  return (await response.json()) as CreateTurnResponse;
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
  input: Omit<StorySummary, "id">
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

export async function getAdminModerationEvents(): Promise<AdminModerationEvent[]> {
  const data = await adminGet<{ events: AdminModerationEvent[] }>("/api/admin/moderation/events");
  return data.events;
}

async function adminGet<T>(path: string): Promise<T> {
  return adminRequest<T>(path);
}

async function adminRequest<T>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
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
