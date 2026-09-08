import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: async () => {
    throw new Error("next/headers must not be used in the browser");
  }
}));

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

const storyInput = {
  id: "moon-market",
  title: "月下市集",
  tagline: "你在午夜市集里寻找被偷走的名字。",
  genre: "奇幻悬疑",
  premise: "午夜市集只接待遗失重要之物的人。",
  openingLocationName: "市集入口",
  openingLocationDescription: "纸灯笼在雾里摇晃。",
  worldRules: [],
  experienceMode: "coauthored" as const,
  defaultSegmentLength: "standard" as const,
  aiFreedom: "medium" as const
};

describe("why a form was refused", () => {
  it("passes the server's reason through instead of a generic failure", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ error: "故事 ID「moon-market」已经被占用，换一个再试。", field: "id" }, 409)
    );

    const { createStory } = await import("./api.js");

    // The reason used to be read off the response and thrown away, leaving the
    // author with 创建故事失败 and nothing to correct.
    await expect(createStory(storyInput)).rejects.toThrow("已经被占用");
  });

  it("names the fields a validation failure came from", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        {
          error: "Invalid request",
          issues: [
            { path: ["id"], message: "Invalid" },
            { path: ["tagline"], message: "Too long" },
            { path: ["id"], message: "Invalid" }
          ]
        },
        400
      )
    );

    const { createStory } = await import("./api.js");
    const attempt = createStory(storyInput);

    // Each field once, in the form's own words - not a raw Zod dump, and not the
    // server's "Invalid request".
    await expect(attempt).rejects.toThrow("故事 ID、一句话钩子");
    await expect(attempt).rejects.not.toThrow("Invalid request");
  });

  it("falls back to its own wording when the server says nothing useful", async () => {
    fetchMock.mockResolvedValue(new Response("gateway exploded", { status: 502 }));

    const { createStory } = await import("./api.js");

    await expect(createStory(storyInput)).rejects.toThrow("创建故事失败");
  });

  it("keeps an expired session distinct, so the form does not blame a field", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: "请先登录" }, 401));

    const { createStory, UnauthenticatedError } = await import("./api.js");

    await expect(createStory(storyInput)).rejects.toBeInstanceOf(UnauthenticatedError);
  });
});
