import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CreateSessionResponse, CreateTurnResponse, StoryDetail, StorySession } from "@instory/shared";
import { buildApp } from "./app.js";
import { StoryCatalog } from "./data/story-catalog.js";
import { AppDatabase } from "./db/app-database.js";
import { ModelConfigStore } from "./db/model-config-store.js";
import { ReaderProfileStore } from "./db/reader-profile-store.js";
import { SessionStore } from "./db/session-store.js";
import { ModelRuntime } from "./model-runtime.js";

type TestApp = Awaited<ReturnType<typeof buildApp>>;

let app: TestApp;
let database: AppDatabase;
let tempDir: string;

beforeEach(async () => {
  tempDir = mkdtempSync(join(tmpdir(), "instory-api-"));
  database = new AppDatabase(join(tempDir, "api.sqlite"));
  app = await buildApp({
    sessionStore: new SessionStore(database),
    readerProfileStore: new ReaderProfileStore(database),
    storyCatalog: new StoryCatalog(database),
    modelRuntime: new ModelRuntime(new ModelConfigStore(database), {
      provider: "mock",
      updatedAt: "2026-05-20T00:00:00.000Z"
    }),
    logger: false
  });
});

afterEach(async () => {
  await app?.close();
  database?.close();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("server API", () => {
  it("returns health and story catalog details", async () => {
    const health = await app.inject({
      method: "GET",
      url: "/api/health"
    });

    expect(health.statusCode).toBe(200);
    expect(health.json()).toEqual({
      ok: true,
      service: "instory-server",
      storage: "sqlite"
    });

    const story = await app.inject({
      method: "GET",
      url: "/api/stories/rain-mansion"
    });
    const body = story.json<StoryDetail>();

    expect(story.statusCode).toBe(200);
    expect(body.story.title).toBe("雨夜旧宅");
    expect(body.world.locations).toHaveLength(3);
    expect(body.characters).toHaveLength(2);
    expect(body.anchors).toHaveLength(4);
  });

  it("creates a session, advances a turn, and reads it back", async () => {
    const created = await createSession();
    const sessionId = created.session.id;

    expect(created.openingTurn.id).toBe("turn_0");
    expect(created.session.timeline).toHaveLength(1);

    const turnResponse = await app.inject({
      method: "POST",
      url: `/api/sessions/${sessionId}/turns`,
      payload: {
        inputType: "free_text",
        content: "我查看门缝外的影子。"
      }
    });
    const turnBody = turnResponse.json<CreateTurnResponse>();

    expect(turnResponse.statusCode).toBe(200);
    expect(turnBody.turn.id).toBe("turn_1");
    expect(turnBody.turn.choices).toHaveLength(3);
    expect(turnBody.state.turnCount).toBe(1);
    expect(turnBody.state.clues).toHaveLength(1);

    const loaded = await app.inject({
      method: "GET",
      url: `/api/sessions/${sessionId}`
    });
    const loadedBody = loaded.json<{ session: StorySession }>();

    expect(loaded.statusCode).toBe(200);
    expect(loadedBody.session.turns).toHaveLength(2);
    expect(loadedBody.session.state.clues).toEqual(turnBody.state.clues);

    const recentSessions = await app.inject({
      method: "GET",
      url: "/api/me/sessions"
    });
    expect(recentSessions.statusCode).toBe(200);
    expect(
      recentSessions.json<{ sessions: Array<{ id: string; storyTitle: string; story: { title: string }; readerRoleName: string }> }>().sessions
    ).toContainEqual(
      expect.objectContaining({
        id: sessionId,
        storyTitle: "雨夜旧宅",
        story: expect.objectContaining({
          title: "雨夜旧宅"
        }),
        readerRoleName: "陆清河"
      })
    );
  });

  it("returns one latest reading record per story", async () => {
    await createSession();
    await createSession();

    const recentSessions = await app.inject({
      method: "GET",
      url: "/api/me/sessions"
    });

    expect(recentSessions.statusCode).toBe(200);
    const sessions = recentSessions.json<{ sessions: Array<{ storyId: string; story: { id: string } }> }>().sessions;
    expect(sessions.filter((session) => session.storyId === "rain-mansion")).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      storyId: "rain-mansion",
      story: {
        id: "rain-mansion"
      }
    });
  });

  it("creates a rewind branch from a timeline node", async () => {
    const created = await createSession();
    const sessionId = created.session.id;

    const rewind = await app.inject({
      method: "POST",
      url: `/api/sessions/${sessionId}/rewind`,
      payload: {
        timelineNodeId: "node_0"
      }
    });
    const body = rewind.json<{ session: StorySession }>();

    expect(rewind.statusCode).toBe(200);
    expect(body.session.id).not.toBe(sessionId);
    expect(body.session.turns).toHaveLength(1);
    expect(body.session.timeline).toHaveLength(1);

    const loadedBranch = await app.inject({
      method: "GET",
      url: `/api/sessions/${body.session.id}`
    });

    expect(loadedBranch.statusCode).toBe(200);
  });

  it("returns clear errors for missing resources and invalid requests", async () => {
    const missingStory = await app.inject({
      method: "GET",
      url: "/api/stories/missing"
    });
    expect(missingStory.statusCode).toBe(404);

    const invalidSession = await app.inject({
      method: "POST",
      url: "/api/stories/rain-mansion/sessions",
      payload: {
        entryMode: "bad_mode"
      }
    });
    expect(invalidSession.statusCode).toBe(400);

    const missingSession = await app.inject({
      method: "GET",
      url: "/api/sessions/missing"
    });
    expect(missingSession.statusCode).toBe(404);
  });

  it("creates reader profiles and uses one as the session role", async () => {
    const createdProfile = await app.inject({
      method: "POST",
      url: "/api/reader/profiles",
      payload: {
        name: "林向晚",
        gender: "女",
        visibility: "private",
        personality: "冷静、敏感、习惯先观察再行动。",
        avatarUrl: "https://example.com/avatar.png",
        description: "现代法医，被卷入雨夜旧宅。"
      }
    });

    expect(createdProfile.statusCode).toBe(201);
    const profile = createdProfile.json<{ profile: { id: string } }>().profile;

    const profiles = await app.inject({
      method: "GET",
      url: "/api/reader/profiles"
    });
    expect(profiles.statusCode).toBe(200);
    expect(profiles.json<{ profiles: unknown[] }>().profiles).toHaveLength(1);

    const session = await app.inject({
      method: "POST",
      url: "/api/stories/rain-mansion/sessions",
      payload: {
        entryMode: "custom_role",
        readerProfileId: profile.id
      }
    });
    const body = session.json<CreateSessionResponse>();

    expect(session.statusCode).toBe(200);
    expect(body.session.readerRole).toMatchObject({
      mode: "custom_role",
      characterId: profile.id,
      name: "林向晚",
      gender: "女",
      personality: "冷静、敏感、习惯先观察再行动。",
      avatarUrl: "https://example.com/avatar.png"
    });

    const updatedProfile = await app.inject({
      method: "PUT",
      url: `/api/reader/profiles/${profile.id}`,
      payload: {
        name: "林向晚修订",
        gender: null,
        visibility: "public",
        personality: "冷静、果断。",
        avatarUrl: null,
        description: "重写后的角色背景。"
      }
    });
    expect(updatedProfile.statusCode).toBe(200);
    expect(updatedProfile.json()).toMatchObject({
      profile: {
        id: profile.id,
        visibility: "public",
        name: "林向晚修订",
        gender: null,
        avatarUrl: null
      }
    });

    const deletedProfile = await app.inject({
      method: "DELETE",
      url: `/api/reader/profiles/${profile.id}`
    });
    expect(deletedProfile.statusCode).toBe(204);

    const profilesAfterDelete = await app.inject({
      method: "GET",
      url: "/api/reader/profiles"
    });
    expect(profilesAfterDelete.json<{ profiles: unknown[] }>().profiles).toHaveLength(0);
  });

  it("returns admin status, model config, story catalog, sessions and moderation events", async () => {
    const created = await createSession();

    const status = await app.inject({
      method: "GET",
      url: "/api/admin/status"
    });
    expect(status.statusCode).toBe(200);
    expect(status.json()).toMatchObject({
      service: "instory-server",
      storage: {
        type: "sqlite"
      },
      counts: {
        stories: 1,
        sessions: 1
      }
    });

    const models = await app.inject({
      method: "GET",
      url: "/api/admin/models"
    });
    expect(models.statusCode).toBe(200);
    expect(models.json()).toMatchObject({
      provider: "mock",
      baseUrl: null,
      model: null,
      apiKeyConfigured: false
    });

    const stories = await app.inject({
      method: "GET",
      url: "/api/admin/stories"
    });
    expect(stories.statusCode).toBe(200);
    expect(stories.json<{ stories: unknown[] }>().stories).toHaveLength(1);

    const sessions = await app.inject({
      method: "GET",
      url: "/api/admin/sessions"
    });
    expect(sessions.statusCode).toBe(200);
    expect(sessions.json<{ sessions: Array<{ id: string; turnCount: number }> }>().sessions).toContainEqual(
      expect.objectContaining({
        id: created.session.id,
        turnCount: 1
      })
    );

    const sessionDetail = await app.inject({
      method: "GET",
      url: `/api/admin/sessions/${created.session.id}`
    });
    expect(sessionDetail.statusCode).toBe(200);
    expect(sessionDetail.json<{ session: StorySession }>().session.id).toBe(created.session.id);

    const moderation = await app.inject({
      method: "GET",
      url: "/api/admin/moderation/events"
    });
    expect(moderation.statusCode).toBe(200);
    expect(moderation.json()).toEqual({ events: [] });
  });

  it("protects admin routes when an admin token is configured", async () => {
    await app.close();
    database.close();
    rmSync(tempDir, { recursive: true, force: true });

    tempDir = mkdtempSync(join(tmpdir(), "instory-api-"));
    database = new AppDatabase(join(tempDir, "api.sqlite"));
    app = await buildApp({
      sessionStore: new SessionStore(database),
      readerProfileStore: new ReaderProfileStore(database),
      storyCatalog: new StoryCatalog(database),
      modelRuntime: new ModelRuntime(new ModelConfigStore(database), {
        provider: "mock",
        updatedAt: "2026-05-20T00:00:00.000Z"
      }),
      adminToken: "secret",
      logger: false
    });

    const unauthorized = await app.inject({
      method: "GET",
      url: "/api/admin/status"
    });
    expect(unauthorized.statusCode).toBe(401);

    const authorized = await app.inject({
      method: "GET",
      url: "/api/admin/status",
      headers: {
        authorization: "Bearer secret"
      }
    });
    expect(authorized.statusCode).toBe(200);
  });

  it("updates model config through admin API without exposing API key", async () => {
    const updated = await app.inject({
      method: "PUT",
      url: "/api/admin/models",
      payload: {
        provider: "openai-compatible",
        baseUrl: "https://api.example.com/v1",
        model: "story-model",
        apiKey: "secret-key"
      }
    });

    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({
      provider: "openai-compatible",
      baseUrl: "https://api.example.com/v1",
      model: "story-model",
      apiKeyConfigured: true
    });
    expect(JSON.stringify(updated.json())).not.toContain("secret-key");

    const loaded = await app.inject({
      method: "GET",
      url: "/api/admin/models"
    });
    expect(loaded.json()).toMatchObject({
      provider: "openai-compatible",
      apiKeyConfigured: true
    });

    const invalid = await app.inject({
      method: "PUT",
      url: "/api/admin/models",
      payload: {
        provider: "openai-compatible",
        baseUrl: "https://api.example.com/v1"
      }
    });
    expect(invalid.statusCode).toBe(400);
  });

  it("updates story summary through admin API", async () => {
    const updated = await app.inject({
      method: "PUT",
      url: "/api/admin/stories/rain-mansion",
      payload: {
        title: "雨夜旧宅：作者修订",
        tagline: "你在雨声里改写旧宅命运。",
        genre: "悬疑互动",
        coverUrl: "https://example.com/rain-cover.png",
        visibility: "public",
        aiFreedom: "high",
        experienceMode: "scripted",
        defaultSegmentLength: "long"
      }
    });

    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toEqual({
      story: {
        id: "rain-mansion",
        ownerId: null,
        visibility: "public",
        title: "雨夜旧宅：作者修订",
        tagline: "你在雨声里改写旧宅命运。",
        genre: "悬疑互动",
        coverUrl: "https://example.com/rain-cover.png",
        aiFreedom: "high",
        experienceMode: "scripted",
        defaultSegmentLength: "long"
      }
    });

    const loaded = await app.inject({
      method: "GET",
      url: "/api/stories/rain-mansion"
    });
    expect(loaded.json<StoryDetail>().story.title).toBe("雨夜旧宅：作者修订");

    const missing = await app.inject({
      method: "PUT",
      url: "/api/admin/stories/missing",
      payload: {
        title: "missing",
        tagline: "missing",
        genre: "missing",
        coverUrl: null,
        visibility: "public",
        aiFreedom: "low",
        experienceMode: "coauthored",
        defaultSegmentLength: "standard"
      }
    });
    expect(missing.statusCode).toBe(404);
  });

  it("creates a minimal story through client story API", async () => {
    const createdProfile = await app.inject({
      method: "POST",
      url: "/api/reader/profiles",
      payload: {
        name: "林向晚",
        gender: "女",
        visibility: "private",
        personality: "冷静、敏锐、习惯观察细节。",
        avatarUrl: null,
        description: "被卷入市集的现代法医。"
      }
    });
    const profileId = createdProfile.json<{ profile: { id: string } }>().profile.id;

    const created = await app.inject({
      method: "POST",
      url: "/api/stories",
      payload: {
        id: "moon-market",
        title: "月下市集",
        tagline: "你在午夜市集里寻找被偷走的名字。",
        genre: "奇幻悬疑",
        coverUrl: "https://example.com/moon-market.png",
        premise: "午夜之后，城市背面的市集会向失去名字的人开放。",
        openingLocationName: "市集入口",
        openingLocationDescription: "湿漉漉的石阶向下延伸，灯笼照出一排没有影子的摊位。",
        worldRules: ["不能直接说出真名", "交易必须付出记忆"],
        castProfileIds: [profileId],
        visibility: "private",
        aiFreedom: "medium",
        experienceMode: "coauthored",
        defaultSegmentLength: "standard"
      }
    });

    expect(created.statusCode).toBe(201);
    expect(created.json<{ story: StoryDetail }>().story).toMatchObject({
      story: {
        id: "moon-market",
        ownerId: "local-reader",
        visibility: "private",
        title: "月下市集",
        coverUrl: "https://example.com/moon-market.png"
      },
      world: {
        premise: "午夜之后，城市背面的市集会向失去名字的人开放。"
      },
      characters: [
        {
          name: "林向晚"
        }
      ],
      anchors: []
    });

    const loaded = await app.inject({
      method: "GET",
      url: "/api/stories/moon-market"
    });
    expect(loaded.statusCode).toBe(200);
    expect(loaded.json<StoryDetail>().world.locations[0]?.name).toBe("市集入口");

    const myStories = await app.inject({
      method: "GET",
      url: "/api/me/stories"
    });
    expect(myStories.statusCode).toBe(200);
    expect(myStories.json<{ stories: Array<{ id: string }> }>().stories).toContainEqual(
      expect.objectContaining({ id: "moon-market" })
    );

    const publicStoriesBeforePublish = await app.inject({
      method: "GET",
      url: "/api/stories"
    });
    expect(publicStoriesBeforePublish.json<{ stories: Array<{ id: string }> }>().stories).not.toContainEqual(
      expect.objectContaining({ id: "moon-market" })
    );

    const updated = await app.inject({
      method: "PUT",
      url: "/api/me/stories/moon-market",
      payload: {
        title: "月下市集：修订",
        tagline: "你重新进入被名字交易支配的午夜市集。",
        genre: "奇幻",
        coverUrl: null,
        visibility: "public",
        premise: "午夜市集只接待失去名字的人，交易会改变记忆。",
        openingLocationName: "旧钟楼下",
        openingLocationDescription: "钟声停在零点，雾气从台阶下涌上来。",
        worldRules: ["不能直接说出真名"],
        aiFreedom: "low",
        experienceMode: "scripted",
        defaultSegmentLength: "long"
      }
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json<{ story: StoryDetail }>().story).toMatchObject({
      story: {
        id: "moon-market",
        ownerId: "local-reader",
        visibility: "public",
        title: "月下市集：修订",
        aiFreedom: "low",
        experienceMode: "scripted",
        defaultSegmentLength: "long"
      },
      world: {
        premise: "午夜市集只接待失去名字的人，交易会改变记忆。"
      }
    });

    const publicStoriesAfterPublish = await app.inject({
      method: "GET",
      url: "/api/stories"
    });
    expect(publicStoriesAfterPublish.json<{ stories: Array<{ id: string }> }>().stories).toContainEqual(
      expect.objectContaining({ id: "moon-market" })
    );

    const updateSeedStory = await app.inject({
      method: "PUT",
      url: "/api/me/stories/rain-mansion",
      payload: {
        title: "不能修改",
        tagline: "不能修改",
        genre: "悬疑",
        coverUrl: null,
        visibility: "public",
        premise: "不能修改",
        openingLocationName: "不能修改",
        openingLocationDescription: "不能修改",
        worldRules: [],
        aiFreedom: "medium",
        experienceMode: "coauthored",
        defaultSegmentLength: "standard"
      }
    });
    expect(updateSeedStory.statusCode).toBe(404);

    const duplicate = await app.inject({
      method: "POST",
      url: "/api/stories",
      payload: {
        id: "moon-market",
        title: "重复故事",
        tagline: "重复",
        genre: "测试",
        coverUrl: null,
        visibility: "private",
        premise: "重复",
        openingLocationName: "入口",
        openingLocationDescription: "入口",
        worldRules: [],
        aiFreedom: "medium",
        experienceMode: "coauthored",
        defaultSegmentLength: "standard"
      }
    });
    expect(duplicate.statusCode).toBe(409);

    const deleted = await app.inject({
      method: "DELETE",
      url: "/api/me/stories/moon-market"
    });
    expect(deleted.statusCode).toBe(204);

    const deletedStory = await app.inject({
      method: "GET",
      url: "/api/stories/moon-market"
    });
    expect(deletedStory.statusCode).toBe(404);
  });

  it("verifies the active admin model provider", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/admin/models/verify"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      ok: true,
      provider: "mock",
      choices: 3,
      memoryEvents: 1
    });
  });
});

async function createSession(): Promise<CreateSessionResponse> {
  const response = await app.inject({
    method: "POST",
    url: "/api/stories/rain-mansion/sessions",
    payload: {
      entryMode: "existing_character",
      characterId: "lu_qinghe"
    }
  });

  expect(response.statusCode).toBe(200);
  return response.json<CreateSessionResponse>();
}
