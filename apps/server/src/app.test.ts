import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  CreateSessionResponse,
  CreateTurnResponse,
  PublicStoryDetail,
  ReaderSessionListItem,
  SessionTurn,
  StoryAnchor,
  StoryDetail,
  StoryReadingInsight,
  StorySession,
  TurnQuota
} from "@instory/shared";
import { MockNarrativeProvider } from "@instory/ai-orchestrator";
import type {
  GenerateNarrativeInput,
  LLMProvider,
  NarrativeGeneration,
  NarrativeStreamEvent
} from "@instory/ai-orchestrator";
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
    const body = story.json<PublicStoryDetail>();

    expect(story.statusCode).toBe(200);
    expect(body.story.title).toBe("雨夜旧宅");
    expect(body.story.visibility).toBe("public");
    expect(body.story.ownerId).toBeNull();
    expect(body.world.locations).toHaveLength(5);
    // The seed story has no author, so nobody reads it through this route as one:
    // the cast comes back by name and role, and the anchors - which include how it
    // can end - are not part of a reader's copy. Admins see the full sheet through
    // /api/admin/stories.
    expect(body.characters).toHaveLength(3);
    expect(Object.keys(body.characters[0] ?? {}).sort()).toEqual(["id", "name", "role", "storyId"]);
    expect(story.json<Record<string, unknown>>().anchors).toBeUndefined();
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

  it("deletes a session and then reports it as missing", async () => {
    const created = await createSession();

    const removed = await app.inject({
      method: "DELETE",
      url: `/api/sessions/${created.session.id}`
    });
    expect(removed.statusCode).toBe(204);

    // Gone means gone: the read route no longer finds it, and deleting twice is a
    // 404 rather than a silent success.
    expect((await app.inject({ method: "GET", url: `/api/sessions/${created.session.id}` })).statusCode).toBe(404);
    expect((await app.inject({ method: "DELETE", url: `/api/sessions/${created.session.id}` })).statusCode).toBe(404);
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
        readingTheme: "western-fantasy",
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
        readingTheme: "western-fantasy",
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

    // The "default role" path sends no characterId, so the story's own leading
    // character has to be chosen. Naming one client-side would name the seed
    // story's character, which this story does not have.
    const defaultRole = await app.inject({
      method: "POST",
      url: "/api/stories/lantern-bazaar/sessions",
      payload: { entryMode: "existing_character", characterId: null }
    });
    expect(defaultRole.statusCode).toBe(200);

    const defaultRoleBody = defaultRole.json<CreateSessionResponse>();
    expect(defaultRoleBody.session.readerRole.name).not.toBe("陆清河");
    expect(defaultRoleBody.session.readerRole.characterId).not.toBe("lu_qinghe");
    expect(defaultRoleBody.session.state.location).toBe("提灯长廊");
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

    // The in-story re-set: who the actor is here, how they stand towards the
    // reader, and what they are hiding - none of it touches the reader profile
    // the actor was snapshotted from.
    const castId = loaded.json<StoryDetail>().characters[0]?.id ?? "";
    const recast = await app.inject({
      method: "PUT",
      url: `/api/me/stories/moon-market/characters/${castId}`,
      payload: {
        role: "替人保管名字的市集掌柜",
        relationToReader: "认得你，却装作第一次见面",
        secret: "她卖掉的第一个名字是你的",
        personality: ["冷静", "话少"],
        goals: ["拖住你直到子夜过去"],
        constraints: ["不能主动说出交易规则"]
      }
    });
    expect(recast.statusCode).toBe(200);
    expect(recast.json<{ character: { role: string; relationToReader: string; secret: string } }>().character).toMatchObject({
      role: "替人保管名字的市集掌柜",
      relationToReader: "认得你，却装作第一次见面",
      secret: "她卖掉的第一个名字是你的"
    });

    const afterRecast = await app.inject({ method: "GET", url: "/api/stories/moon-market" });
    expect(afterRecast.json<StoryDetail>().characters[0]).toMatchObject({
      name: "林向晚",
      secret: "她卖掉的第一个名字是你的",
      goals: ["拖住你直到子夜过去"]
    });

    const seedCast = await app.inject({
      method: "PUT",
      url: `/api/me/stories/rain-mansion/characters/${castId}`,
      payload: {
        role: "不能修改",
        relationToReader: "",
        secret: "",
        personality: [],
        goals: [],
        constraints: []
      }
    });
    expect(seedCast.statusCode).toBe(404);

    // Plot anchors used to be seed-only: a story an author created always had none,
    // so the one hard constraint on the AI was unreachable from the console.
    const anchored = await app.inject({
      method: "PUT",
      url: "/api/me/stories/moon-market/anchors",
      payload: {
        anchors: [
          { title: "名字被换走", type: "required", description: "读者必须发现自己的名字已经被交易过。" },
          { title: "提前离场", type: "forbidden", description: "天亮之前不能走出市集。" }
        ]
      }
    });
    expect(anchored.statusCode).toBe(200);
    expect(anchored.json<{ anchors: StoryAnchor[] }>().anchors).toMatchObject([
      { id: "moon-market-anchor-1", storyId: "moon-market", type: "required" },
      { id: "moon-market-anchor-2", storyId: "moon-market", type: "forbidden" }
    ]);

    const withAnchors = await app.inject({ method: "GET", url: "/api/stories/moon-market" });
    expect(withAnchors.json<StoryDetail>().anchors).toHaveLength(2);

    // The set is replaced, not appended to.
    const replaced = await app.inject({
      method: "PUT",
      url: "/api/me/stories/moon-market/anchors",
      payload: {
        anchors: [{ title: "带着别人的名字离开", type: "ending", description: "读者用另一个名字走出市集。" }]
      }
    });
    expect(replaced.statusCode).toBe(200);
    expect(replaced.json<{ anchors: StoryAnchor[] }>().anchors).toHaveLength(1);

    const seedAnchors = await app.inject({
      method: "PUT",
      url: "/api/me/stories/rain-mansion/anchors",
      payload: { anchors: [] }
    });
    expect(seedAnchors.statusCode).toBe(404);



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
    // Words the author can act on, naming the field to change. The store's own
    // message ("Story id already exists") belongs in a log, not in a form.
    const refusal = duplicate.json<{ error: string; field?: string }>();
    expect(refusal.error).toContain("moon-market");
    expect(refusal.error).toContain("已经被占用");
    expect(refusal.field).toBe("id");

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

  it("marks a read passage as a key node and keeps that mark on reload", async () => {
    const created = await createSession();

    // The opening is just the story starting, so it carries no invitation.
    expect(created.openingTurn.intervention).toBeNull();

    const read = await app.inject({
      method: "POST",
      url: `/api/sessions/${created.session.id}/turns`,
      payload: { inputType: "read_continue", content: "继续阅读" }
    });
    expect(read.statusCode).toBe(200);
    expect(read.json<CreateTurnResponse>().turn.intervention).toMatchObject({ kind: "clue_found" });

    // A turn that answered the reader's own action does not put the invitation
    // straight back in front of them.
    const acted = await app.inject({
      method: "POST",
      url: `/api/sessions/${created.session.id}/turns`,
      payload: { inputType: "free_text", content: "我压低声音追问真相" }
    });
    expect(acted.statusCode).toBe(200);
    expect(acted.json<CreateTurnResponse>().turn.intervention).toBeNull();

    const reloaded = await app.inject({ method: "GET", url: `/api/sessions/${created.session.id}` });
    const turns = reloaded.json<{ session: StorySession }>().session.turns;
    expect(turns.map((turn) => turn.intervention?.kind ?? null)).toEqual([null, "clue_found", null]);
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

  async function buildAuthApp(
    allowLegacyAnonymousUser: boolean,
    adminToken?: string
  ): Promise<void> {
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
      adminToken,
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

    // Promoting through the console is what keeps the shared token a bootstrap
    // path rather than the permanent way in.
    const promoted = await authApp.inject({
      method: "PUT",
      url: `/api/admin/users/${reader.id}/role`,
      headers: { authorization: "Bearer shared-secret" },
      payload: { role: "admin" }
    });
    expect(promoted.statusCode).toBe(200);
    expect(promoted.json<{ user: { role: string } }>().user.role).toBe("admin");

    expect(
      (
        await authApp.inject({
          method: "GET",
          url: "/api/admin/status",
          headers: { authorization: `Bearer ${readerToken}` }
        })
      ).statusCode
    ).toBe(200);

    // A reader cannot promote themselves, and an unknown id is a 404 rather than
    // a silent success.
    expect(
      (
        await authApp.inject({
          method: "PUT",
          url: `/api/admin/users/${admin.id}/role`,
          payload: { role: "reader" }
        })
      ).statusCode
    ).toBe(401);
    expect(
      (
        await authApp.inject({
          method: "PUT",
          url: "/api/admin/users/missing/role",
          headers: { authorization: "Bearer shared-secret" },
          payload: { role: "admin" }
        })
      ).statusCode
    ).toBe(404);
  });

  it("lists accounts so the role can be handed out without opening the database", async () => {
    await buildAuthApp(false, "shared-secret");
    await register("listed-reader@example.com", "读者");
    const secondToken = await register("listed-second@example.com", "另一个读者");

    const listed = await authApp.inject({
      method: "GET",
      url: "/api/admin/users",
      headers: { authorization: "Bearer shared-secret" }
    });
    expect(listed.statusCode).toBe(200);

    const users = listed.json<{ users: Array<Record<string, unknown>> }>().users;
    // Newest first, so whoever just signed up is at the top of the console.
    expect(users[0]?.email).toBe("listed-second@example.com");
    expect(users.map((account) => account.email)).toContain("listed-reader@example.com");

    // Enough to identify and act on an account, and nothing more: no password
    // material of any kind reaches the console.
    expect(Object.keys(users[0] ?? {}).sort()).toEqual([
      "createdAt",
      "displayName",
      "email",
      "id",
      "role",
      "updatedAt"
    ]);

    // The pairing this exists for: find the id in the list, then use it.
    const target = users.find((account) => account.email === "listed-reader@example.com");
    const promoted = await authApp.inject({
      method: "PUT",
      url: `/api/admin/users/${String(target?.id)}/role`,
      headers: { authorization: "Bearer shared-secret" },
      payload: { role: "admin" }
    });
    expect(promoted.statusCode).toBe(200);
    expect(promoted.json<{ user: { role: string } }>().user.role).toBe("admin");

    // A reader still cannot read the list. The account promoted above would pass,
    // so this uses the one that stayed a reader.
    expect(
      (
        await authApp.inject({
          method: "GET",
          url: "/api/admin/users",
          headers: { authorization: `Bearer ${secondToken}` }
        })
      ).statusCode
    ).toBe(401);
  });


  it("keeps configured operator addresses on the admin role", async () => {
    authTempDir = mkdtempSync(join(tmpdir(), "instory-auth-"));
    authDatabase = new AppDatabase(join(authTempDir, "auth.sqlite"));
    const listedUserStore = new UserStore(authDatabase);
    authApp = await buildApp({
      sessionStore: new SessionStore(authDatabase),
      readerProfileStore: new ReaderProfileStore(authDatabase),
      storyCatalog: new StoryCatalog(authDatabase),
      userStore: listedUserStore,
      usageStore: new UsageStore(authDatabase),
      moderationStore: new ModerationStore(authDatabase),
      modelRuntime: new ModelRuntime(new ModelConfigStore(authDatabase), {
        provider: "mock",
        updatedAt: "2026-05-20T00:00:00.000Z"
      }),
      adminToken: "shared-secret",
      // Deliberately cased and padded: the address comes from an env file.
      adminEmails: [" Operator@Example.com "],
      allowLegacyAnonymousUser: false,
      logger: false
    });

    // A listed address is an admin from the moment it registers.
    const registered = await authApp.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { email: "operator@example.com", displayName: "运营", password: "pw-12345678" }
    });
    expect(registered.statusCode).toBe(201);
    expect(registered.json<{ user: { role: string } }>().user.role).toBe("admin");

    // An account that already existed is promoted on its next sign-in, which is
    // what makes the setting usable on a database that is already in service.
    const reader = listedUserStore.create({
      email: "listed-later@example.com",
      displayName: "后加入的运营",
      password: "pw-12345678"
    });
    expect(reader.role).toBe("reader");
    await authApp.close();
    authApp = await buildApp({
      sessionStore: new SessionStore(authDatabase),
      readerProfileStore: new ReaderProfileStore(authDatabase),
      storyCatalog: new StoryCatalog(authDatabase),
      userStore: listedUserStore,
      usageStore: new UsageStore(authDatabase),
      moderationStore: new ModerationStore(authDatabase),
      modelRuntime: new ModelRuntime(new ModelConfigStore(authDatabase), {
        provider: "mock",
        updatedAt: "2026-05-20T00:00:00.000Z"
      }),
      adminToken: "shared-secret",
      adminEmails: ["listed-later@example.com"],
      allowLegacyAnonymousUser: false,
      logger: false
    });

    const signedIn = await authApp.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "listed-later@example.com", password: "pw-12345678" }
    });
    expect(signedIn.statusCode).toBe(200);
    expect(signedIn.json<{ user: { role: string } }>().user.role).toBe("admin");
    expect(listedUserStore.findById(reader.id)?.role).toBe("admin");
  });

  it("shows an author how far readers got, and does not count their own trials", async () => {
    await buildAuthApp(false);
    const author = await register("insight-author@example.com", "作者");
    const reader = await register("insight-reader@example.com", "读者");
    const asAuthor = { authorization: `Bearer ${author}` };
    const asReader = { authorization: `Bearer ${reader}` };

    const created = await authApp.inject({
      method: "POST",
      url: "/api/stories",
      headers: asAuthor,
      payload: {
        id: "tide-archive",
        title: "潮汐档案",
        tagline: "退潮后，档案室多了一份卷宗。",
        genre: "悬疑",
        coverUrl: null,
        premise: "一座靠潮水记事的港城。",
        openingLocationName: "潮汐档案室",
        openingLocationDescription: "盐味顺着窗缝进来。",
        worldRules: [],
        visibility: "public",
        aiFreedom: "medium",
        experienceMode: "coauthored",
        defaultSegmentLength: "standard"
      }
    });
    expect(created.statusCode).toBe(201);

    // The author checking their own opening must not read as an audience.
    const trial = await authApp.inject({
      method: "POST",
      url: "/api/stories/tide-archive/sessions",
      headers: asAuthor,
      payload: { entryMode: "existing_character", characterId: null }
    });
    expect(trial.statusCode).toBe(200);

    const beforeReaders = await authApp.inject({
      method: "GET",
      url: "/api/me/story-insights",
      headers: asAuthor
    });
    expect(beforeReaders.statusCode).toBe(200);
    expect(beforeReaders.json<{ insights: StoryReadingInsight[] }>().insights).toMatchObject([
      { storyId: "tide-archive", readers: 0, sessions: 0, turns: 0, lastReadAt: null }
    ]);

    const readerSession = await authApp.inject({
      method: "POST",
      url: "/api/stories/tide-archive/sessions",
      headers: asReader,
      payload: { entryMode: "existing_character", characterId: null }
    });
    const sessionId = readerSession.json<CreateSessionResponse>().session.id;
    const advanced = await authApp.inject({
      method: "POST",
      url: `/api/sessions/${sessionId}/turns`,
      headers: asReader,
      payload: { inputType: "read_continue", content: "继续阅读" }
    });
    expect(advanced.statusCode).toBe(200);

    const afterReaders = await authApp.inject({
      method: "GET",
      url: "/api/me/story-insights",
      headers: asAuthor
    });
    const insight = afterReaders.json<{ insights: StoryReadingInsight[] }>().insights[0];
    expect(insight).toMatchObject({ storyId: "tide-archive", readers: 1, sessions: 1 });
    // Opening turn plus the one the reader spent.
    expect(insight?.turns).toBe(2);
    expect(insight?.deepestTurns).toBe(2);
    expect(insight?.lastReadAt).not.toBeNull();

    // A reader has no business seeing another author's numbers, and has none of
    // their own.
    const readerInsights = await authApp.inject({
      method: "GET",
      url: "/api/me/story-insights",
      headers: asReader
    });
    expect(readerInsights.json<{ insights: StoryReadingInsight[] }>().insights).toEqual([]);
  });

  it("keeps a private story private, and keeps a reader who is already inside", async () => {
    await buildAuthApp(false);
    const author = await register("private-author@example.com", "作者");
    const reader = await register("private-reader@example.com", "读者");
    const asAuthor = { authorization: `Bearer ${author}` };
    const asReader = { authorization: `Bearer ${reader}` };
    const storyPayload = {
      title: "闭门记",
      tagline: "门后的事不外传。",
      genre: "悬疑",
      coverUrl: null,
      premise: "一座不对外开放的宅子。",
      openingLocationName: "前厅",
      openingLocationDescription: "灯只点了一盏。",
      worldRules: [],
      aiFreedom: "medium" as const,
      experienceMode: "coauthored" as const,
      defaultSegmentLength: "standard" as const
    };

    const created = await authApp.inject({
      method: "POST",
      url: "/api/stories",
      headers: asAuthor,
      payload: { id: "closed-door", visibility: "private", ...storyPayload }
    });
    expect(created.statusCode).toBe(201);

    // Knowing the id used to be enough to read the whole world, cast and anchors,
    // and to start reading it.
    const peeked = await authApp.inject({
      method: "GET",
      url: "/api/stories/closed-door",
      headers: asReader
    });
    expect(peeked.statusCode).toBe(404);

    const started = await authApp.inject({
      method: "POST",
      url: "/api/stories/closed-door/sessions",
      headers: asReader,
      payload: { entryMode: "existing_character", characterId: null }
    });
    expect(started.statusCode).toBe(404);

    // 404, not 403: a private story should not confirm that the id exists.
    expect(peeked.json<{ error: string }>().error).toBe("Story not found");

    // The author still reads their own.
    const ownRead = await authApp.inject({
      method: "GET",
      url: "/api/stories/closed-door",
      headers: asAuthor
    });
    expect(ownRead.statusCode).toBe(200);

    // A reader who started while it was public keeps reading after it is hidden:
    // they are already inside, and the reader page needs the story's title and theme.
    const openStory = await authApp.inject({
      method: "POST",
      url: "/api/stories",
      headers: asAuthor,
      payload: { id: "open-door", visibility: "public", ...storyPayload }
    });
    expect(openStory.statusCode).toBe(201);

    const session = await authApp.inject({
      method: "POST",
      url: "/api/stories/open-door/sessions",
      headers: asReader,
      payload: { entryMode: "existing_character", characterId: null }
    });
    expect(session.statusCode).toBe(200);

    const hidden = await authApp.inject({
      method: "PUT",
      url: "/api/me/stories/open-door",
      headers: asAuthor,
      payload: { visibility: "private", ...storyPayload }
    });
    expect(hidden.statusCode).toBe(200);

    const stillReadable = await authApp.inject({
      method: "GET",
      url: "/api/stories/open-door",
      headers: asReader
    });
    expect(stillReadable.statusCode).toBe(200);

    // But it is off the shelf, and nobody new can start it.
    const publicList = await authApp.inject({ method: "GET", url: "/api/stories" });
    expect(publicList.json<{ stories: Array<{ id: string }> }>().stories).not.toContainEqual(
      expect.objectContaining({ id: "open-door" })
    );

    const latecomer = await register("private-latecomer@example.com", "后来者");
    const blocked = await authApp.inject({
      method: "POST",
      url: "/api/stories/open-door/sessions",
      headers: { authorization: `Bearer ${latecomer}` },
      payload: { entryMode: "existing_character", characterId: null }
    });
    expect(blocked.statusCode).toBe(404);
  });

  it("keeps the actors' secrets and the plot outline out of a reader's copy", async () => {
    await buildAuthApp(false);
    const author = await register("spoiler-author@example.com", "作者");
    const reader = await register("spoiler-reader@example.com", "读者");
    const asAuthor = { authorization: `Bearer ${author}` };
    const asReader = { authorization: `Bearer ${reader}` };

    const profile = await authApp.inject({
      method: "POST",
      url: "/api/reader/profiles",
      headers: asAuthor,
      payload: {
        name: "守灯人",
        gender: "男",
        visibility: "private",
        personality: "沉默",
        avatarUrl: null,
        description: "看守灯塔的人。"
      }
    });
    const profileId = profile.json<{ profile: { id: string } }>().profile.id;

    const created = await authApp.inject({
      method: "POST",
      url: "/api/stories",
      headers: asAuthor,
      payload: {
        id: "lamp-keeper",
        title: "守灯人",
        tagline: "灯灭之前不要问他名字。",
        genre: "悬疑",
        coverUrl: null,
        visibility: "public",
        premise: "海雾里只有一座灯塔。",
        openingLocationName: "灯塔底层",
        openingLocationDescription: "铁梯上结着盐。",
        worldRules: [],
        castProfileIds: [profileId],
        aiFreedom: "medium",
        experienceMode: "coauthored",
        defaultSegmentLength: "standard"
      }
    });
    expect(created.statusCode).toBe(201);
    const castId = created.json<{ story: StoryDetail }>().story.characters[0]?.id ?? "";

    await authApp.inject({
      method: "PUT",
      url: `/api/me/stories/lamp-keeper/characters/${castId}`,
      headers: asAuthor,
      payload: {
        role: "灯塔守夜人",
        relationToReader: "认得你，却装作不认得",
        secret: "灯是他自己熄的",
        personality: ["沉默"],
        goals: ["拖到天亮"],
        constraints: ["不能承认上过塔顶"]
      }
    });

    await authApp.inject({
      method: "PUT",
      url: "/api/me/stories/lamp-keeper/anchors",
      headers: asAuthor,
      payload: {
        anchors: [{ title: "灯塔重新亮起", type: "ending", description: "读者点亮灯之后故事可以收束。" }]
      }
    });

    // The author writes against the full sheet, so theirs keeps everything.
    const ownCopy = await authApp.inject({
      method: "GET",
      url: "/api/stories/lamp-keeper",
      headers: asAuthor
    });
    expect(ownCopy.statusCode).toBe(200);
    const full = ownCopy.json<StoryDetail>();
    expect(full.characters[0]?.secret).toBe("灯是他自己熄的");
    expect(full.anchors).toHaveLength(1);

    // A reader gets the world and the cast by name and role. Knowing the id used
    // to be enough to fetch every actor's secret and the whole outline, ending
    // included - the story they came to be told, handed over up front.
    const readerCopy = await authApp.inject({
      method: "GET",
      url: "/api/stories/lamp-keeper",
      headers: asReader
    });
    expect(readerCopy.statusCode).toBe(200);
    expect(readerCopy.body).not.toContain("灯是他自己熄的");
    expect(readerCopy.body).not.toContain("灯塔重新亮起");
    expect(readerCopy.body).not.toContain("拖到天亮");

    const readerBody = readerCopy.json<Record<string, unknown>>();
    // Absent, not emptied: an empty array would claim the story has no anchors.
    expect(readerBody.anchors).toBeUndefined();
    expect(readerBody.characters).toEqual([
      { id: castId, storyId: "lamp-keeper", name: "守灯人", role: "灯塔守夜人" }
    ]);
    // Still enough to render the reader's page and its frame.
    expect(readerCopy.json<{ story: { title: string } }>().story.title).toBe("守灯人");
    expect(readerCopy.json<{ world: { premise: string } }>().world.premise).toBe("海雾里只有一座灯塔。");

    // Same redaction without a session at all: a public story is readable by
    // anyone, so anonymous must not be a way around it.
    const anonymous = await authApp.inject({ method: "GET", url: "/api/stories/lamp-keeper" });
    expect(anonymous.statusCode).toBe(200);
    expect(anonymous.body).not.toContain("灯是他自己熄的");
    expect(anonymous.json<Record<string, unknown>>().anchors).toBeUndefined();
  });


  it("leaves a tombstone card when the author deletes a story someone was reading", async () => {
    await buildAuthApp(false);
    const author = await register("tombstone-author@example.com", "作者");
    const reader = await register("tombstone-reader@example.com", "读者");
    const asAuthor = { authorization: `Bearer ${author}` };
    const asReader = { authorization: `Bearer ${reader}` };

    const created = await authApp.inject({
      method: "POST",
      url: "/api/stories",
      headers: asAuthor,
      payload: {
        id: "vanishing-inn",
        title: "会消失的客栈",
        tagline: "住一晚，第二天路就没了。",
        genre: "奇谈",
        coverUrl: null,
        visibility: "public",
        premise: "一间只在雨天存在的客栈。",
        openingLocationName: "客栈门口",
        openingLocationDescription: "雨水顺着招牌往下流。",
        worldRules: [],
        aiFreedom: "medium",
        experienceMode: "coauthored",
        defaultSegmentLength: "standard"
      }
    });
    expect(created.statusCode).toBe(201);

    const opened = await authApp.inject({
      method: "POST",
      url: "/api/stories/vanishing-inn/sessions",
      headers: asReader,
      payload: { entryMode: "existing_character", characterId: null }
    });
    expect(opened.statusCode).toBe(200);

    const removed = await authApp.inject({
      method: "DELETE",
      url: "/api/me/stories/vanishing-inn",
      headers: asAuthor
    });
    expect(removed.statusCode).toBe(204);

    // The card used to vanish from the shelf without a word, which reads as lost
    // reading rather than a deleted story.
    const shelf = await authApp.inject({ method: "GET", url: "/api/me/sessions", headers: asReader });
    const cards = shelf.json<{ sessions: ReaderSessionListItem[] }>().sessions;
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      storyId: "vanishing-inn",
      // The title is the one recorded when the reader opened it, since the story is
      // no longer there to ask.
      storyTitle: "会消失的客栈",
      story: null
    });
    expect(cards[0]?.turnCount).toBe(1);
  });

  it("puts real reader counts on the public shelf, and keeps private stories off it", async () => {
    await buildAuthApp(false);
    const author = await register("shelf-author@example.com", "作者");
    const reader = await register("shelf-reader@example.com", "读者");
    const asAuthor = { authorization: `Bearer ${author}` };
    const asReader = { authorization: `Bearer ${reader}` };
    const base = {
      tagline: "有人在对岸等着。",
      genre: "民俗奇谈",
      coverUrl: null,
      premise: "一条只在夜里摆渡的河。",
      openingLocationName: "渡口",
      openingLocationDescription: "灯还没点。",
      worldRules: [],
      aiFreedom: "medium" as const,
      experienceMode: "coauthored" as const,
      defaultSegmentLength: "standard" as const
    };

    for (const [id, title, visibility] of [
      ["lantern-ferry", "提灯渡", "public"],
      ["hidden-ferry", "暗渡", "private"]
    ] as const) {
      const created = await authApp.inject({
        method: "POST",
        url: "/api/stories",
        headers: asAuthor,
        payload: { id, title, visibility, ...base }
      });
      expect(created.statusCode).toBe(201);
    }

    // The author checking their own opening is not an audience.
    await authApp.inject({
      method: "POST",
      url: "/api/stories/lantern-ferry/sessions",
      headers: asAuthor,
      payload: { entryMode: "existing_character", characterId: null }
    });

    const beforeReaders = await authApp.inject({ method: "GET", url: "/api/stories/insights" });
    expect(beforeReaders.statusCode).toBe(200);
    const beforeList = beforeReaders.json<{ insights: StoryReadingInsight[] }>().insights;
    expect(beforeList).toContainEqual(expect.objectContaining({ storyId: "lantern-ferry", readers: 0 }));
    // A private story is not on the shelf, so it has no business on the shelf's numbers.
    expect(beforeList).not.toContainEqual(expect.objectContaining({ storyId: "hidden-ferry" }));

    const session = await authApp.inject({
      method: "POST",
      url: "/api/stories/lantern-ferry/sessions",
      headers: asReader,
      payload: { entryMode: "existing_character", characterId: null }
    });
    const sessionId = session.json<CreateSessionResponse>().session.id;
    await authApp.inject({
      method: "POST",
      url: `/api/sessions/${sessionId}/turns`,
      headers: asReader,
      payload: { inputType: "read_continue", content: "继续阅读" }
    });

    const afterReaders = await authApp.inject({ method: "GET", url: "/api/stories/insights" });
    expect(afterReaders.json<{ insights: StoryReadingInsight[] }>().insights).toContainEqual(
      expect.objectContaining({ storyId: "lantern-ferry", readers: 1, deepestTurns: 2 })
    );
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

describe("session history windowing", () => {
  /** Builds a session with the opening turn plus `extra` generated turns. */
  async function seedTranscript(extra: number): Promise<string> {
    const created = await app.inject({
      method: "POST",
      url: "/api/stories/rain-mansion/sessions",
      payload: { entryMode: "existing_character", characterId: "lu_qinghe" }
    });
    const sessionId = created.json<CreateSessionResponse>().session.id;

    for (let index = 0; index < extra; index += 1) {
      const advanced = await app.inject({
        method: "POST",
        url: `/api/sessions/${sessionId}/turns`,
        payload: { inputType: "read_continue", content: "继续阅读" }
      });
      expect(advanced.statusCode).toBe(200);
    }

    return sessionId;
  }

  it("ships only a window of turns and says how much is left", async () => {
    const sessionId = await seedTranscript(3);

    const windowed = await app.inject({ method: "GET", url: `/api/sessions/${sessionId}?turnLimit=2` });
    expect(windowed.statusCode).toBe(200);

    const body = windowed.json<{
      session: StorySession;
      history: { turnCount: number; loadedTurns: number; oldestLoadedTurnId: string | null; hasMore: boolean };
    }>();

    expect(body.session.turns).toHaveLength(2);
    expect(body.history).toMatchObject({ turnCount: 4, loadedTurns: 2, hasMore: true });
    expect(body.history.oldestLoadedTurnId).toBe(body.session.turns[0]?.id);
  });

  it("reports no more history once the whole transcript fits", async () => {
    const sessionId = await seedTranscript(1);

    const body = await app.inject({ method: "GET", url: `/api/sessions/${sessionId}` });
    const parsed = body.json<{
      session: StorySession;
      history: { turnCount: number; hasMore: boolean };
      quota: { remainingTurnsToday: number; dailyLimit: number; usedToday: number };
    }>();

    expect(parsed.session.turns).toHaveLength(2);
    expect(parsed.history).toMatchObject({ turnCount: 2, hasMore: false });
    // The read carries the day's budget, so the reader sees it on arrival rather
    // than after spending a turn to find out.
    expect(parsed.quota.dailyLimit).toBeGreaterThan(0);
    expect(parsed.quota.remainingTurnsToday).toBe(parsed.quota.dailyLimit - parsed.quota.usedToday);
  });

  it("walks backwards through older turns from a cursor", async () => {
    const sessionId = await seedTranscript(3);

    const windowed = await app.inject({ method: "GET", url: `/api/sessions/${sessionId}?turnLimit=1` });
    const cursor = windowed.json<{ session: StorySession }>().session.turns[0]?.id as string;

    const older = await app.inject({
      method: "GET",
      url: `/api/sessions/${sessionId}/turns?before=${cursor}&limit=2`
    });
    expect(older.statusCode).toBe(200);

    const page = older.json<{ turns: SessionTurn[]; hasMore: boolean }>();
    expect(page.turns).toHaveLength(2);
    // Oldest first, and strictly older than the cursor.
    expect(page.turns.every((turn) => turn.createdAt <= cursor)).toBe(true);
    expect(page.hasMore).toBe(true);

    const rest = await app.inject({
      method: "GET",
      url: `/api/sessions/${sessionId}/turns?before=${page.turns[0]?.id}&limit=10`
    });
    expect(rest.json<{ hasMore: boolean }>().hasMore).toBe(false);
  });

  it("requires a cursor and refuses an unknown session", async () => {
    const sessionId = await seedTranscript(1);

    const noCursor = await app.inject({ method: "GET", url: `/api/sessions/${sessionId}/turns` });
    expect(noCursor.statusCode).toBe(400);

    const missing = await app.inject({ method: "GET", url: "/api/sessions/sess_missing/turns?before=turn_0" });
    expect(missing.statusCode).toBe(404);
  });

  it("still resolves a reported turn that falls outside the loaded window", async () => {
    const sessionId = await seedTranscript(3);

    // The opening turn is the oldest, so a windowed read would not contain it.
    const full = await app.inject({ method: "GET", url: `/api/sessions/${sessionId}?turnLimit=200` });
    const oldestTurnId = full.json<{ session: StorySession }>().session.turns[0]?.id as string;

    const reported = await app.inject({
      method: "POST",
      url: `/api/sessions/${sessionId}/report`,
      payload: { turnId: oldestTurnId, reason: "开场这段有问题" }
    });
    expect(reported.statusCode).toBe(201);
    expect(reported.json<{ event: { turnId: string | null } }>().event.turnId).toBe(oldestTurnId);
  });
});

/**
 * A model that never fills in `intervention`. Before the server derived one, such
 * a model left the reader with no key nodes at all and nothing looked broken.
 */
class UnmarkedProvider implements LLMProvider {
  private readonly inner = new MockNarrativeProvider();

  async generateNarrative(input: GenerateNarrativeInput): Promise<NarrativeGeneration> {
    const generation = await this.inner.generateNarrative(input);
    return { ...generation, result: { ...generation.result, intervention: null } };
  }

  async *streamNarrative(input: GenerateNarrativeInput): AsyncGenerator<NarrativeStreamEvent> {
    for await (const event of this.inner.streamNarrative(input)) {
      yield event.type === "complete"
        ? { ...event, result: { ...event.result, intervention: null } }
        : event;
    }
  }
}

class UnmarkedRuntime extends ModelRuntime {
  override getProvider(): LLMProvider {
    return new UnmarkedProvider();
  }
}

describe("key nodes when the model marks none", () => {
  let silentApp: TestApp;
  let silentDatabase: AppDatabase;
  let silentDir: string;

  beforeEach(async () => {
    silentDir = mkdtempSync(join(tmpdir(), "instory-cue-"));
    silentDatabase = new AppDatabase(join(silentDir, "api.sqlite"));
    silentApp = await buildApp({
      sessionStore: new SessionStore(silentDatabase),
      readerProfileStore: new ReaderProfileStore(silentDatabase),
      storyCatalog: new StoryCatalog(silentDatabase),
      userStore: new UserStore(silentDatabase),
      usageStore: new UsageStore(silentDatabase),
      moderationStore: new ModerationStore(silentDatabase),
      modelRuntime: new UnmarkedRuntime(new ModelConfigStore(silentDatabase), {
        provider: "mock",
        updatedAt: "2026-05-20T00:00:00.000Z"
      }),
      allowLegacyAnonymousUser: true,
      logger: false
    });
  });

  afterEach(async () => {
    await silentApp?.close();
    silentDatabase?.close();
    rmSync(silentDir, { recursive: true, force: true });
  });

  it("reads the node out of the state the passage changed", async () => {
    const created = await silentApp.inject({
      method: "POST",
      url: "/api/stories/rain-mansion/sessions",
      payload: { entryMode: "existing_character", characterId: "lu_qinghe" }
    });
    const sessionId = created.json<CreateSessionResponse>().session.id;

    const read = await silentApp.inject({
      method: "POST",
      url: `/api/sessions/${sessionId}/turns`,
      payload: { inputType: "read_continue", content: "继续阅读" }
    });

    expect(read.statusCode).toBe(200);
    // The mock's delta nudges fear and alertness by one - below the crisis
    // threshold - and adds a clue, so a found clue is what the state honestly says
    // happened.
    expect(read.json<CreateTurnResponse>().turn.intervention).toMatchObject({ kind: "clue_found" });
  });
});

/** Resolved by the test once it has abandoned the stream, standing in for a slow model. */
let releaseGeneration: (() => void) | null = null;

/**
 * Delivers one delta, then waits: this is the window in which a reader presses
 * 停止生成, and the model finishes afterwards regardless.
 */
class SlowStreamProvider implements LLMProvider {
  private readonly inner = new MockNarrativeProvider();

  async generateNarrative(input: GenerateNarrativeInput): Promise<NarrativeGeneration> {
    return this.inner.generateNarrative(input);
  }

  async *streamNarrative(input: GenerateNarrativeInput): AsyncGenerator<NarrativeStreamEvent> {
    yield { type: "narration_delta", text: "雨声先到。" };
    await new Promise<void>((resolve) => {
      releaseGeneration = resolve;
    });
    const generation = await this.inner.generateNarrative(input);
    yield { type: "complete", result: generation.result, usage: generation.usage };
  }
}

class SlowRuntime extends ModelRuntime {
  override getProvider(): LLMProvider {
    return new SlowStreamProvider();
  }
}

async function waitUntil(check: () => boolean, label: string): Promise<void> {
  const startedAt = Date.now();
  while (!check()) {
    if (Date.now() - startedAt > 3000) {
      throw new Error(`timed out waiting for ${label}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("a reader who stops the generation", () => {
  let abortApp: TestApp;
  let abortDatabase: AppDatabase;
  let abortUsage: UsageStore;
  let abortDir: string;
  let baseUrl: string;

  beforeEach(async () => {
    releaseGeneration = null;
    abortDir = mkdtempSync(join(tmpdir(), "instory-abort-"));
    abortDatabase = new AppDatabase(join(abortDir, "api.sqlite"));
    abortUsage = new UsageStore(abortDatabase);
    abortApp = await buildApp({
      sessionStore: new SessionStore(abortDatabase),
      readerProfileStore: new ReaderProfileStore(abortDatabase),
      storyCatalog: new StoryCatalog(abortDatabase),
      userStore: new UserStore(abortDatabase),
      usageStore: abortUsage,
      moderationStore: new ModerationStore(abortDatabase),
      modelRuntime: new SlowRuntime(new ModelConfigStore(abortDatabase), {
        provider: "mock",
        updatedAt: "2026-05-20T00:00:00.000Z"
      }),
      allowLegacyAnonymousUser: true,
      logger: false
    });
    // A real socket: inject() cannot hang up mid-response, and hanging up is the
    // whole behaviour under test.
    baseUrl = await abortApp.listen({ port: 0, host: "127.0.0.1" });
  });

  afterEach(async () => {
    releaseGeneration?.();
    await abortApp?.close();
    abortDatabase?.close();
    rmSync(abortDir, { recursive: true, force: true });
  });

  it("keeps the turn and the quota the reader did not spend", async () => {
    const created = await abortApp.inject({
      method: "POST",
      url: "/api/stories/rain-mansion/sessions",
      payload: { entryMode: "existing_character", characterId: "lu_qinghe" }
    });
    const sessionId = created.json<CreateSessionResponse>().session.id;

    const controller = new AbortController();
    const response = await fetch(`${baseUrl}/api/sessions/${sessionId}/turns/stream`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ inputType: "read_continue", content: "继续阅读" }),
      signal: controller.signal
    });
    expect(response.status).toBe(200);

    // Read the first passage, then walk away - exactly what 停止生成 does.
    const reader = response.body?.getReader();
    await reader?.read();
    controller.abort();

    await waitUntil(() => releaseGeneration !== null, "the generator to be waiting");
    await new Promise((resolve) => setTimeout(resolve, 50));
    // The model comes back after the reader is gone. Before this fix that answer
    // was recorded as a success, charged, and committed to the transcript.
    releaseGeneration?.();

    await waitUntil(() => abortUsage.summarizeDay().generations > 0, "the attempt to be recorded");

    const summary = abortUsage.summarizeDay();
    expect(summary.successes).toBe(0);
    // Recorded as a failure rather than not at all: the model was called, so the
    // spend stays visible in the admin view.
    expect(summary.failures).toBe(1);

    const after = await abortApp.inject({ method: "GET", url: `/api/sessions/${sessionId}` });
    const body = after.json<{ session: StorySession; quota: TurnQuota }>();
    // Only the opening turn, and nothing spent today.
    expect(body.session.turns).toHaveLength(1);
    expect(body.quota.usedToday).toBe(0);
    expect(body.quota.remainingTurnsToday).toBe(body.quota.dailyLimit);
  });
});




