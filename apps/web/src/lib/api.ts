import type {
  CreateSessionResponse,
  CreateTurnResponse,
  StoryDetail,
  StorySession,
  StorySummary
} from "@instory/shared";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:4000";

export async function listStories(): Promise<StorySummary[]> {
  const response = await fetch(`${API_BASE}/api/stories`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error("加载故事列表失败");
  }
  const data = (await response.json()) as { stories: StorySummary[] };
  return data.stories;
}

export async function createSession(storyId: string): Promise<CreateSessionResponse> {
  const response = await fetch(`${API_BASE}/api/stories/${storyId}/sessions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      entryMode: "existing_character",
      characterId: "lu_qinghe"
    })
  });

  if (!response.ok) {
    throw new Error("创建故事会话失败");
  }

  return (await response.json()) as CreateSessionResponse;
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
