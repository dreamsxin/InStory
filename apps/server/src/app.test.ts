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
import { UserStore } from "./db/user-store.js";
import { UsageStore } from "./db/usage-store.js";
import { ModerationStore } from "./db/moderation-store.js";
import { ModelRuntime } from "./model-runtime.js";

type TestApp = Awaited<ReturnType<typeof buildApp>>;

let app: TestApp;
let database: AppDatabase;
let userStore: UserStore;
let tempDir: string;

beforeEach(async () => {
  tempDir = mkdtempSync(join(tmpdir(), "instory-api-"));
  database = new AppDatabase(join(tempDir, "api.sqlite"));
  userStore = new UserStore(database);
  app = await buildApp({
    sessionStore: new SessionStore(database),
    readerProfileStore: new ReaderProfileStore(database),
    storyCatalog: new StoryCatalog(database),
      userStore,
      usageStore: new UsageStore(database),
      moderationStore: new ModerationStore(database),
      modelRuntime: new ModelRuntime(new ModelConfigStore(database), {
      provider: "mock",
      updatedAt: "2026-05-20T00:00:00.000Z"
    }),
    // The existing suite exercises the reader flows as the seeded legacy user;
    // dedicated tests below cover the authenticated and unauthenticated paths.
    allowLegacyAnonymousUser: true,
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
    expect(body.story.visibility).toBe("public");
    expect(body.story.ownerId).toBeNull();
    expect(body.world.locations).toHaveLength(5);
    expect(body.characters).toHaveLength(3);
    expect(body.anchors).toHaveLength(5);
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

  it("advances reading segments without storing the old instruction prompt", async () => {
    const created = await createSession();
    const sessionId = created.session.id;

    const turnResponse = await app.inject({
      method: "POST",
      url: `/api/sessions/${sessionId}/turns`,
      payload: {
        inputType: "read_continue",
        content: "阅读推进"
      }
    });
    const turnBody = turnResponse.json<CreateTurnResponse>();

    expect(turnResponse.statusCode).toBe(200);
    expect(turnBody.turn.inputType).toBe("read_continue");
    expect(turnBody.turn.input).toBe("阅读推进");
    expect(turnBody.turn.narration).not.toContain("继续阅读：请按当前角色倾向自然推进下一小节");
  });

  it("returns one latest reading record per story", async () => {
    const older = await createSession();
    await createSession();

    const advanced = await app.inject({
      method: "POST",
      url: `/api/sessions/${older.session.id}/turns`,
      payload: {
        inputType: "free_text",
        content: "我继续查看旧宅走廊。"
      }
    });
    expect(advanced.statusCode).toBe(200);

    const recentSessions = await app.inject({
      method: "GET",
      url: "/api/me/sessions"
    });

    expect(recentSessions.statusCode).toBe(200);
    const sessions = recentSessions.json<{ sessions: Array<{ id: string; storyId: string; story: { id: string }; turnCount: number }> }>().sessions;
    expect(sessions.filter((session) => session.storyId === "rain-mansion")).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      id: older.session.id,
      storyId: "rain-mansion",
      story: {
        id: "rain-mansion"
      },
      turnCount: 2
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

    const missingNode = await app.inject({
      method: "POST",
      url: `/api/sessions/${sessionId}/rewind`,
      payload: {}
    });
    expect(missingNode.statusCode).toBe(400);
  });

  it("resets a session with the same reader role", async () => {
    const created = await createSession();

    const reset = await app.inject({
      method: "POST",
      url: `/api/sessions/${created.session.id}/reset`
    });
    const body = reset.json<{ session: StorySession }>();

    expect(reset.statusCode).toBe(200);
    expect(body.session.id).not.toBe(created.session.id);
    expect(body.session.storyId).toBe(created.session.storyId);
    expect(body.session.readerRole).toEqual(created.session.readerRole);
    expect(body.session.turns).toHaveLength(1);
    expect(body.session.timeline).toHaveLength(1);
    expect(body.session.turns[0]?.input).toBe("重新开始");
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
    expect(moderation.json()).toMatchObject({ events: [], counts: { open: 0 } });
  });

  it("protects admin routes when an admin token is configured", async () => {
    await app.close();
    database.close();
    rmSync(tempDir, { recursive: true, force: true });

    tempDir = mkdtempSync(join(tmpdir(), "instory-api-"));
    database = new AppDatabase(join(tempDir, "api.sqlite"));
    userStore = new UserStore(database);
    app = await buildApp({
      sessionStore: new SessionStore(database),
      readerProfileStore: new ReaderProfileStore(database),
      storyCatalog: new StoryCatalog(database),
      userStore,
      usageStore: new UsageStore(database),
      moderationStore: new ModerationStore(database),
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

  it("opens a newly authored story with its own setting instead of the seed story", async () => {
    const createdProfile = await app.inject({
      method: "POST",
      url: "/api/reader/profiles",
      payload: {
        name: "叶九",
        gender: "女",
        visibility: "private",
        personality: "谨慎、擅长交易。",
        avatarUrl: null,
        description: "在市集里替人赎回名字的中间人。"
      }
    });
    const profileId = createdProfile.json<{ profile: { id: string } }>().profile.id;

    await app.inject({
      method: "POST",
      url: "/api/stories",
      payload: {
        id: "lantern-bazaar",
        title: "提灯集",
        tagline: "你在提灯集里赎回自己的名字。",
        genre: "奇幻悬疑",
        coverUrl: null,
        premise: "提灯集只在雾起时出现，每一次交易都要付出一段记忆。",
        openingLocationName: "提灯长廊",
        openingLocationDescription: "灯笼一路悬到雾里，照不出任何影子。",
        worldRules: ["不能说出真名"],
        castProfileIds: [profileId],
        visibility: "private",
        aiFreedom: "medium",
        experienceMode: "coauthored",
        defaultSegmentLength: "standard"
      }
    });

    const session = await app.inject({
      method: "POST",
      url: "/api/stories/lantern-bazaar/sessions",
      payload: { entryMode: "custom_role", readerProfileId: profileId }
    });
    expect(session.statusCode).toBe(200);

    const body = session.json<CreateSessionResponse>();
    const openingText = [
      body.openingTurn.narration,
      ...body.openingTurn.dialogues.map((dialogue) => `${dialogue.speaker}${dialogue.text}`),
      ...body.openingTurn.choices.map((choice) => choice.text),
      body.session.timeline[0]?.summary ?? ""
    ].join("\n");

    // The seed story must not leak into another story's opening.
    expect(openingText).not.toContain("陆清河");
    expect(openingText).not.toContain("旧宅");
    expect(body.openingTurn.narration).toContain("提灯长廊");
    expect(body.openingTurn.narration).toContain("提灯集只在雾起时出现");
    expect(body.session.state.location).toBe("提灯长廊");

    const advanced = await app.inject({
      method: "POST",
      url: `/api/sessions/${body.session.id}/turns`,
      payload: { inputType: "read_continue", content: "继续阅读" }
    });
    expect(advanced.statusCode).toBe(200);

    const turnBody = advanced.json<CreateTurnResponse>();
    expect(turnBody.turn.narration).not.toContain("陆清河");
    expect(turnBody.turn.narration).not.toContain("旧宅");
    expect(turnBody.turn.narration).toContain("提灯长廊");
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

  it("streams a turn as server-sent events and persists it once", async () => {
    const created = await createSession();

    const response = await app.inject({
      method: "POST",
      url: `/api/sessions/${created.session.id}/turns/stream`,
      payload: { inputType: "read_continue", content: "继续阅读" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/event-stream");

    const events = parseSseEvents(response.body);
    const deltas = events.filter((event) => event.event === "narration_delta");
    const completions = events.filter((event) => event.event === "complete");

    expect(deltas.length).toBeGreaterThan(1);
    expect(completions).toHaveLength(1);
    expect(events.some((event) => event.event === "error")).toBe(false);
    // The last event must be the completion, so a client can stop on it.
    expect(events.at(-1)?.event).toBe("complete");

    const completed = completions[0]!.data as CreateTurnResponse;
    const streamedText = deltas.map((event) => (event.data as { text: string }).text).join("");
    expect(streamedText).toBe(completed.turn.narration);

    // Exactly one turn was appended, and it matches what was streamed.
    const loaded = await app.inject({ method: "GET", url: `/api/sessions/${created.session.id}` });
    const session = loaded.json<{ session: StorySession }>().session;
    expect(session.turns).toHaveLength(2);
    expect(session.turns.at(-1)?.narration).toBe(completed.turn.narration);
    expect(session.turns.at(-1)?.id).toBe(completed.turn.id);
    expect(session.state).toEqual(completed.state);
  });

  it("rejects a streaming turn for an unknown session", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/sessions/sess_missing/turns/stream",
      payload: { inputType: "read_continue", content: "继续阅读" }
    });

    expect(response.statusCode).toBe(404);
  });

  it("validates the streaming turn payload before opening the stream", async () => {
    const created = await createSession();

    const response = await app.inject({
      method: "POST",
      url: `/api/sessions/${created.session.id}/turns/stream`,
      payload: { inputType: "read_continue", content: "" }
    });

    expect(response.statusCode).toBe(400);
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

interface SseEvent {
  event: string;
  data: unknown;
}

/** Parses a buffered SSE body into ordered events. */
function parseSseEvents(body: string): SseEvent[] {
  const events: SseEvent[] = [];

  for (const block of body.split("\n\n")) {
    let event: string | null = null;
    const dataLines: string[] = [];

    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) {
        event = line.slice("event:".length).trim();
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice("data:".length).trim());
      }
    }

    if (event && dataLines.length > 0) {
      events.push({ event, data: JSON.parse(dataLines.join("\n")) });
    }
  }

  return events;
}

describe("generation quota and usage", () => {
  let quotaApp: TestApp;
  let quotaDatabase: AppDatabase;
  let quotaUsageStore: UsageStore;
  let quotaModerationStore: ModerationStore;
  let quotaTempDir: string;

  beforeEach(async () => {
    quotaTempDir = mkdtempSync(join(tmpdir(), "instory-quota-"));
    quotaDatabase = new AppDatabase(join(quotaTempDir, "quota.sqlite"));
    quotaUsageStore = new UsageStore(quotaDatabase);
    quotaModerationStore = new ModerationStore(quotaDatabase);
    quotaApp = await buildApp({
      sessionStore: new SessionStore(quotaDatabase),
      readerProfileStore: new ReaderProfileStore(quotaDatabase),
      storyCatalog: new StoryCatalog(quotaDatabase),
      userStore: new UserStore(quotaDatabase),
      usageStore: quotaUsageStore,
      moderationStore: quotaModerationStore,
      modelRuntime: new ModelRuntime(new ModelConfigStore(quotaDatabase), {
        provider: "mock",
        updatedAt: "2026-05-20T00:00:00.000Z"
      }),
      adminToken: "secret",
      dailyTurnQuota: 2,
      pricing: { inputPerMillion: 1, outputPerMillion: 2 },
      allowLegacyAnonymousUser: true,
      logger: false
    });
  });

  afterEach(async () => {
    await quotaApp.close();
    quotaDatabase.close();
    rmSync(quotaTempDir, { recursive: true, force: true });
  });

  async function startSession(): Promise<string> {
    const response = await quotaApp.inject({
      method: "POST",
      url: "/api/stories/rain-mansion/sessions",
      payload: { entryMode: "existing_character", characterId: "lu_qinghe" }
    });
    return response.json<CreateSessionResponse>().session.id;
  }

  async function advance(sessionId: string) {
    return quotaApp.inject({
      method: "POST",
      url: `/api/sessions/${sessionId}/turns`,
      payload: { inputType: "read_continue", content: "继续阅读" }
    });
  }

  it("counts down the quota and refuses once it is spent", async () => {
    const sessionId = await startSession();

    const first = await advance(sessionId);
    expect(first.statusCode).toBe(200);
    expect(first.json<CreateTurnResponse>().quota).toEqual({
      dailyLimit: 2,
      usedToday: 1,
      remainingTurnsToday: 1
    });

    const second = await advance(sessionId);
    expect(second.json<CreateTurnResponse>().quota.remainingTurnsToday).toBe(0);

    const third = await advance(sessionId);
    expect(third.statusCode).toBe(429);
    expect(third.json<{ quota: { remainingTurnsToday: number } }>().quota.remainingTurnsToday).toBe(0);
  });

  it("applies the same quota to the streaming endpoint", async () => {
    const sessionId = await startSession();

    await advance(sessionId);
    await advance(sessionId);

    const streamed = await quotaApp.inject({
      method: "POST",
      url: `/api/sessions/${sessionId}/turns/stream`,
      payload: { inputType: "read_continue", content: "继续阅读" }
    });

    // Refused before the stream opens, so the client gets JSON rather than SSE.
    expect(streamed.statusCode).toBe(429);
    expect(streamed.headers["content-type"]).toContain("application/json");
  });

  it("records token usage for each generation", async () => {
    const sessionId = await startSession();
    await advance(sessionId);

    const summary = quotaUsageStore.summarizeDay();

    expect(summary.generations).toBe(1);
    expect(summary.successes).toBe(1);
    expect(summary.totalTokens).toBeGreaterThan(0);
    expect(summary.byModel[0]?.provider).toBe("mock");
  });

  it("refuses a blocked reader input without spending quota", async () => {
    const sessionId = await startSession();

    const blocked = await quotaApp.inject({
      method: "POST",
      url: `/api/sessions/${sessionId}/turns`,
      payload: { inputType: "free_text", content: "我想写一段未成年人发生关系的剧情" }
    });

    expect(blocked.statusCode).toBe(422);
    expect(blocked.json<{ moderated: boolean }>().moderated).toBe(true);

    // Nothing was generated, so neither quota nor tokens were spent.
    expect(quotaUsageStore.summarizeDay().generations).toBe(0);
    const events = quotaModerationStore.list();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ surface: "reader_input", action: "blocked", status: "resolved" });

    // The turn was never appended.
    const loaded = await quotaApp.inject({ method: "GET", url: `/api/sessions/${sessionId}` });
    expect(loaded.json<{ session: StorySession }>().session.turns).toHaveLength(1);
  });

  it("blocks the streaming endpoint on the same input before opening the stream", async () => {
    const sessionId = await startSession();

    const blocked = await quotaApp.inject({
      method: "POST",
      url: `/api/sessions/${sessionId}/turns/stream`,
      payload: { inputType: "free_text", content: "我想写一段未成年人发生关系的剧情" }
    });

    expect(blocked.statusCode).toBe(422);
    expect(blocked.headers["content-type"]).toContain("application/json");
  });

  it("keeps a flagged input flowing but leaves an open review item", async () => {
    const sessionId = await startSession();

    const allowed = await quotaApp.inject({
      method: "POST",
      url: `/api/sessions/${sessionId}/turns`,
      payload: { inputType: "free_text", content: "角色想知道自杀的方法" }
    });

    // Flagged content is reviewed, not refused.
    expect(allowed.statusCode).toBe(200);
    // The mock echoes the reader's words into the narration, so both surfaces flag;
    // what matters is that the input flag is in the queue.
    expect(quotaModerationStore.list({ status: "open" })).toEqual(
      expect.arrayContaining([expect.objectContaining({ surface: "reader_input", action: "flagged" })])
    );
  });

  it("accepts a reader report and lets an admin resolve it", async () => {
    const sessionId = await startSession();
    await advance(sessionId);

    const missingReason = await quotaApp.inject({
      method: "POST",
      url: `/api/sessions/${sessionId}/report`,
      payload: {}
    });
    expect(missingReason.statusCode).toBe(400);

    const reported = await quotaApp.inject({
      method: "POST",
      url: `/api/sessions/${sessionId}/report`,
      payload: { reason: "这段描写让我不适" }
    });
    expect(reported.statusCode).toBe(201);
    const eventId = reported.json<{ event: { id: string; status: string } }>().event.id;

    const queue = await quotaApp.inject({
      method: "GET",
      url: "/api/admin/moderation/events?status=open",
      headers: { authorization: "Bearer secret" }
    });
    expect(queue.json<{ events: Array<{ id: string }>; counts: { open: number } }>().events[0]?.id).toBe(eventId);
    expect(queue.json<{ counts: { open: number } }>().counts.open).toBe(1);

    const resolved = await quotaApp.inject({
      method: "POST",
      url: `/api/admin/moderation/events/${eventId}/resolve`,
      headers: { authorization: "Bearer secret" },
      payload: { status: "dismissed", resolution: "未违规" }
    });
    expect(resolved.json<{ event: { status: string; resolution: string } }>().event).toMatchObject({
      status: "dismissed",
      resolution: "未违规"
    });

    const missing = await quotaApp.inject({
      method: "POST",
      url: "/api/admin/moderation/events/mod_missing/resolve",
      headers: { authorization: "Bearer secret" },
      payload: {}
    });
    expect(missing.statusCode).toBe(404);
  });

  it("exposes today's spend and derived cost to admins", async () => {
    const sessionId = await startSession();
    await advance(sessionId);

    const response = await quotaApp.inject({
      method: "GET",
      url: "/api/admin/usage",
      headers: { authorization: "Bearer secret" }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{
      today: { generations: number; totalTokens: number };
      dailyTurnQuota: number;
      estimatedCost: number | null;
    }>();

    expect(body.today.generations).toBe(1);
    expect(body.today.totalTokens).toBeGreaterThan(0);
    expect(body.dailyTurnQuota).toBe(2);
    expect(body.estimatedCost).toBeGreaterThan(0);
  });
});

describe("authentication", () => {
  let authApp: TestApp;
  let authDatabase: AppDatabase;
  let authTempDir: string;

  async function buildAuthApp(allowLegacyAnonymousUser: boolean): Promise<void> {
    authTempDir = mkdtempSync(join(tmpdir(), "instory-auth-"));
    authDatabase = new AppDatabase(join(authTempDir, "auth.sqlite"));
    authApp = await buildApp({
      sessionStore: new SessionStore(authDatabase),
      readerProfileStore: new ReaderProfileStore(authDatabase),
      storyCatalog: new StoryCatalog(authDatabase),
      userStore: new UserStore(authDatabase),
      usageStore: new UsageStore(authDatabase),
      moderationStore: new ModerationStore(authDatabase),
      modelRuntime: new ModelRuntime(new ModelConfigStore(authDatabase), {
        provider: "mock",
        updatedAt: "2026-05-20T00:00:00.000Z"
      }),
      allowLegacyAnonymousUser,
      logger: false
    });
  }

  async function register(email: string, displayName: string): Promise<string> {
    const response = await authApp.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { email, displayName, password: "pw-12345678" }
    });

    expect(response.statusCode).toBe(201);
    return response.json<{ token: string }>().token;
  }

  afterEach(async () => {
    await authApp.close();
    authDatabase.close();
    rmSync(authTempDir, { recursive: true, force: true });
  });

  it("registers, identifies and logs out a reader", async () => {
    await buildAuthApp(false);

    const registered = await authApp.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { email: "Reader@Example.com", displayName: "林向晚", password: "pw-12345678" }
    });

    expect(registered.statusCode).toBe(201);
    const body = registered.json<{ user: { id: string; role: string }; token: string }>();
    expect(body.user.role).toBe("reader");
    expect(registered.headers["set-cookie"]).toContain("instory_session=");
    expect(registered.headers["set-cookie"]).toContain("HttpOnly");

    const me = await authApp.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { authorization: `Bearer ${body.token}` }
    });
    expect(me.json<{ user: { email: string } }>().user.email).toBe("Reader@Example.com");

    // The cookie alone is enough, so the browser never needs the raw token.
    const viaCookie = await authApp.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { cookie: `instory_session=${body.token}` }
    });
    expect(viaCookie.statusCode).toBe(200);

    const loggedOut = await authApp.inject({
      method: "POST",
      url: "/api/auth/logout",
      headers: { authorization: `Bearer ${body.token}` }
    });
    expect(loggedOut.statusCode).toBe(204);

    const afterLogout = await authApp.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { authorization: `Bearer ${body.token}` }
    });
    expect(afterLogout.statusCode).toBe(401);
  });

  it("rejects a duplicate email and a wrong password", async () => {
    await buildAuthApp(false);
    await register("reader@example.com", "读者");

    const duplicate = await authApp.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { email: "READER@example.com", displayName: "冒名者", password: "pw-12345678" }
    });
    expect(duplicate.statusCode).toBe(409);

    const wrongPassword = await authApp.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "reader@example.com", password: "not-the-password" }
    });
    expect(wrongPassword.statusCode).toBe(401);

    const unknownAccount = await authApp.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "nobody@example.com", password: "pw-12345678" }
    });
    // Same status and message, so accounts cannot be enumerated.
    expect(unknownAccount.statusCode).toBe(401);
    expect(unknownAccount.json()).toEqual(wrongPassword.json());

    const login = await authApp.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "reader@example.com", password: "pw-12345678" }
    });
    expect(login.statusCode).toBe(200);
    expect(login.json<{ token: string }>().token).toBeTruthy();
  });

  it("requires a session for owner-scoped routes when anonymous access is off", async () => {
    await buildAuthApp(false);

    for (const url of ["/api/me/stories", "/api/me/sessions", "/api/reader/profiles"]) {
      const response = await authApp.inject({ method: "GET", url });
      expect(response.statusCode).toBe(401);
    }

    const createSessionResponse = await authApp.inject({
      method: "POST",
      url: "/api/stories/rain-mansion/sessions",
      payload: { entryMode: "existing_character", characterId: "lu_qinghe" }
    });
    expect(createSessionResponse.statusCode).toBe(401);

    // Public discovery stays open.
    expect((await authApp.inject({ method: "GET", url: "/api/stories" })).statusCode).toBe(200);
  });

  it("falls back to the legacy reader only while anonymous access is on", async () => {
    await buildAuthApp(true);

    const response = await authApp.inject({ method: "GET", url: "/api/me/stories" });

    expect(response.statusCode).toBe(200);
  });

  it("keeps one reader's stories, roles and sessions away from another", async () => {
    await buildAuthApp(false);
    const alice = await register("alice@example.com", "Alice");
    const bob = await register("bob@example.com", "Bob");

    const aliceProfile = await authApp.inject({
      method: "POST",
      url: "/api/reader/profiles",
      headers: { authorization: `Bearer ${alice}` },
      payload: {
        name: "叶九",
        gender: "女",
        visibility: "private",
        personality: "谨慎。",
        avatarUrl: null,
        description: "中间人。"
      }
    });
    const aliceProfileId = aliceProfile.json<{ profile: { id: string } }>().profile.id;

    await authApp.inject({
      method: "POST",
      url: "/api/stories",
      headers: { authorization: `Bearer ${alice}` },
      payload: {
        id: "alice-story",
        title: "爱丽丝的故事",
        tagline: "只属于爱丽丝。",
        genre: "悬疑",
        coverUrl: null,
        premise: "一段只有作者自己能看到的故事。",
        openingLocationName: "起点",
        openingLocationDescription: "一切从这里开始。",
        worldRules: ["保持安静"],
        castProfileIds: [aliceProfileId],
        visibility: "private",
        aiFreedom: "medium",
        experienceMode: "coauthored",
        defaultSegmentLength: "standard"
      }
    });

    const aliceSession = await authApp.inject({
      method: "POST",
      url: "/api/stories/alice-story/sessions",
      headers: { authorization: `Bearer ${alice}` },
      payload: { entryMode: "custom_role", readerProfileId: aliceProfileId }
    });
    const aliceSessionId = aliceSession.json<CreateSessionResponse>().session.id;

    // Bob sees none of it.
    expect(
      (
        await authApp.inject({
          method: "GET",
          url: "/api/me/stories",
          headers: { authorization: `Bearer ${bob}` }
        })
      ).json<{ stories: unknown[] }>().stories
    ).toEqual([]);
    expect(
      (
        await authApp.inject({
          method: "GET",
          url: "/api/reader/profiles",
          headers: { authorization: `Bearer ${bob}` }
        })
      ).json<{ profiles: unknown[] }>().profiles
    ).toEqual([]);
    expect(
      (
        await authApp.inject({
          method: "GET",
          url: "/api/me/sessions",
          headers: { authorization: `Bearer ${bob}` }
        })
      ).json<{ sessions: unknown[] }>().sessions
    ).toEqual([]);

    // Bob cannot read, advance or delete Alice's resources, and gets 404 rather
    // than 403 so ids cannot be probed.
    for (const request of [
      { method: "GET" as const, url: `/api/sessions/${aliceSessionId}` },
      { method: "POST" as const, url: `/api/sessions/${aliceSessionId}/reset`, payload: {} },
      { method: "DELETE" as const, url: "/api/me/stories/alice-story" },
      { method: "DELETE" as const, url: `/api/reader/profiles/${aliceProfileId}` }
    ]) {
      const response = await authApp.inject({
        ...request,
        headers: { authorization: `Bearer ${bob}` }
      });
      expect(response.statusCode).toBe(404);
    }

    const advance = await authApp.inject({
      method: "POST",
      url: `/api/sessions/${aliceSessionId}/turns`,
      headers: { authorization: `Bearer ${bob}` },
      payload: { inputType: "read_continue", content: "继续阅读" }
    });
    expect(advance.statusCode).toBe(404);

    // Alice still has full access.
    expect(
      (
        await authApp.inject({
          method: "GET",
          url: `/api/sessions/${aliceSessionId}`,
          headers: { authorization: `Bearer ${alice}` }
        })
      ).statusCode
    ).toBe(200);
  });

  it("lets an admin account through without the shared token", async () => {
    authTempDir = mkdtempSync(join(tmpdir(), "instory-auth-"));
    authDatabase = new AppDatabase(join(authTempDir, "auth.sqlite"));
    const adminUserStore = new UserStore(authDatabase);
    authApp = await buildApp({
      sessionStore: new SessionStore(authDatabase),
      readerProfileStore: new ReaderProfileStore(authDatabase),
      storyCatalog: new StoryCatalog(authDatabase),
      userStore: adminUserStore,
      usageStore: new UsageStore(authDatabase),
      moderationStore: new ModerationStore(authDatabase),
      modelRuntime: new ModelRuntime(new ModelConfigStore(authDatabase), {
        provider: "mock",
        updatedAt: "2026-05-20T00:00:00.000Z"
      }),
      adminToken: "shared-secret",
      allowLegacyAnonymousUser: false,
      logger: false
    });

    const admin = adminUserStore.create({
      email: "admin@example.com",
      displayName: "管理员",
      password: "pw-12345678",
      role: "admin"
    });
    const adminToken = adminUserStore.issueSession(admin.id).token;

    expect(
      (
        await authApp.inject({
          method: "GET",
          url: "/api/admin/status",
          headers: { authorization: `Bearer ${adminToken}` }
        })
      ).statusCode
    ).toBe(200);

    const reader = adminUserStore.create({
      email: "reader@example.com",
      displayName: "读者",
      password: "pw-12345678"
    });
    const readerToken = adminUserStore.issueSession(reader.id).token;

    expect(
      (
        await authApp.inject({
          method: "GET",
          url: "/api/admin/status",
          headers: { authorization: `Bearer ${readerToken}` }
        })
      ).statusCode
    ).toBe(401);
  });
});

describe("abuse limits", () => {
  let limitApp: TestApp;
  let limitDatabase: AppDatabase;
  let limitTempDir: string;

  /** Limits are set tight so a test can reach them without hundreds of requests. */
  async function buildLimitApp(abuseLimits: Parameters<typeof buildApp>[0]["abuseLimits"]) {
    limitTempDir = mkdtempSync(join(tmpdir(), "instory-limit-"));
    limitDatabase = new AppDatabase(join(limitTempDir, "limit.sqlite"));
    limitApp = await buildApp({
      sessionStore: new SessionStore(limitDatabase),
      readerProfileStore: new ReaderProfileStore(limitDatabase),
      storyCatalog: new StoryCatalog(limitDatabase),
      userStore: new UserStore(limitDatabase),
      usageStore: new UsageStore(limitDatabase),
      moderationStore: new ModerationStore(limitDatabase),
      modelRuntime: new ModelRuntime(new ModelConfigStore(limitDatabase), {
        provider: "mock",
        updatedAt: "2026-05-20T00:00:00.000Z"
      }),
      abuseLimits,
      allowLegacyAnonymousUser: true,
      logger: false
    });
  }

  afterEach(async () => {
    await limitApp?.close();
    limitDatabase?.close();
    rmSync(limitTempDir, { recursive: true, force: true });
  });

  it("stops sign-in attempts from one address once the burst limit is reached", async () => {
    await buildLimitApp({ authAttempts: { limit: 2, windowMs: 60_000 } });

    const attempt = async () =>
      limitApp.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { email: "nobody@example.com", password: "pw-12345678" }
      });

    expect((await attempt()).statusCode).toBe(401);
    expect((await attempt()).statusCode).toBe(401);

    const blocked = await attempt();
    expect(blocked.statusCode).toBe(429);
    expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(0);
    expect(blocked.json<{ retryAfterSeconds: number }>().retryAfterSeconds).toBeGreaterThan(0);
  });

  it("locks a single account after repeated failures without burning the address budget", async () => {
    // A generous address budget isolates the per-account rule.
    await buildLimitApp({
      authAttempts: { limit: 100, windowMs: 60_000 },
      loginFailuresPerAccount: { limit: 2, windowMs: 900_000 }
    });

    const registered = await limitApp.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { email: "target@example.com", displayName: "目标", password: "pw-12345678" }
    });
    expect(registered.statusCode).toBe(201);

    const guess = async (password: string) =>
      limitApp.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { email: "target@example.com", password }
      });

    expect((await guess("wrong-guess-1")).statusCode).toBe(401);
    expect((await guess("wrong-guess-2")).statusCode).toBe(401);
    // Locked out even with the right password, which is the point of the rule.
    expect((await guess("pw-12345678")).statusCode).toBe(429);

    // Another account is unaffected, so one victim cannot deny service to everyone.
    const other = await limitApp.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "someone-else@example.com", password: "pw-12345678" }
    });
    expect(other.statusCode).toBe(401);
  });

  it("clears an account's failure tally after a successful sign-in", async () => {
    await buildLimitApp({
      authAttempts: { limit: 100, windowMs: 60_000 },
      loginFailuresPerAccount: { limit: 3, windowMs: 900_000 }
    });

    await limitApp.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { email: "typo@example.com", displayName: "手滑", password: "pw-12345678" }
    });

    const login = async (password: string) =>
      limitApp.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { email: "typo@example.com", password }
      });

    expect((await login("wrong")).statusCode).toBe(401);
    expect((await login("wrong")).statusCode).toBe(401);
    expect((await login("pw-12345678")).statusCode).toBe(200);

    // Two more mistakes would have tripped the limit had the success not reset it.
    expect((await login("wrong")).statusCode).toBe(401);
    expect((await login("wrong")).statusCode).toBe(401);
    expect((await login("pw-12345678")).statusCode).toBe(200);
  });

  it("caps how fast one reader can drive the model", async () => {
    await buildLimitApp({ generationBurst: { limit: 1, windowMs: 60_000 } });

    const created = await limitApp.inject({
      method: "POST",
      url: "/api/stories/rain-mansion/sessions",
      payload: { entryMode: "existing_character", characterId: "lu_qinghe" }
    });
    const sessionId = created.json<CreateSessionResponse>().session.id;

    const advance = async () =>
      limitApp.inject({
        method: "POST",
        url: `/api/sessions/${sessionId}/turns`,
        payload: { inputType: "read_continue", content: "继续阅读" }
      });

    expect((await advance()).statusCode).toBe(200);

    const throttled = await advance();
    expect(throttled.statusCode).toBe(429);
    expect(throttled.json<{ error: string }>().error).toContain("推进太快");

    // The streaming endpoint shares the budget, so it cannot be used to sidestep it.
    const streamed = await limitApp.inject({
      method: "POST",
      url: `/api/sessions/${sessionId}/turns/stream`,
      payload: { inputType: "read_continue", content: "继续阅读" }
    });
    expect(streamed.statusCode).toBe(429);
  });
});

