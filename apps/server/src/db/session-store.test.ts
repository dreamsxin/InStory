import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SessionTurn, StorySession, TimelineNode, WorldState } from "@instory/shared";
import { AppDatabase } from "./app-database.js";
import { SessionStore } from "./session-store.js";

const openDatabases: AppDatabase[] = [];
const tempDirs: string[] = [];
const OWNER_ID = "user_owner";

function seed(store: SessionStore, session: StorySession, ownerId = OWNER_ID): void {
  store.create(session, ownerId, "雨夜旧宅");
}

function createStore(): SessionStore {
  const dir = mkdtempSync(join(tmpdir(), "instory-session-store-"));
  tempDirs.push(dir);
  const database = new AppDatabase(join(dir, "test.sqlite"));
  openDatabases.push(database);
  return new SessionStore(database);
}

afterEach(() => {
  while (openDatabases.length > 0) {
    openDatabases.pop()!.close();
  }
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe("SessionStore", () => {
  it("persists and reads story sessions from SQLite", () => {
    const store = createStore();
    const session = createSession({
      id: "sess_test",
      updatedAt: "2026-05-20T00:00:00.000Z",
      turns: [createTurn("turn_0", "2026-05-20T00:00:00.000Z")],
      timeline: [createNode("node_0", "turn_0", "2026-05-20T00:00:00.000Z")]
    });

    seed(store, session);

    expect(store.findById("sess_test")).toEqual(session);
    expect(store.findById("missing")).toBeNull();
    expect(store.count()).toBe(1);
    expect(store.listRecent()).toEqual([
      {
        id: "sess_test",
        storyId: "rain-mansion",
        createdAt: "2026-05-20T00:00:00.000Z",
        updatedAt: "2026-05-20T00:00:00.000Z",
        turnCount: 1
      }
    ]);
  });

  it("deletes a session with its turns and saves, and only for its owner", () => {
    const store = createStore();
    seed(
      store,
      createSession({
        id: "sess_delete",
        updatedAt: "2026-05-20T00:00:00.000Z",
        turns: [createTurn("turn_0", "2026-05-20T00:00:00.000Z")],
        timeline: [createNode("node_0", "turn_0", "2026-05-20T00:00:00.000Z")]
      })
    );

    // Another reader's id must not be enough to delete this reading.
    expect(store.deleteOwned("sess_delete", "user_someone_else")).toBe(false);
    expect(store.findById("sess_delete")).not.toBeNull();

    expect(store.deleteOwned("sess_delete", OWNER_ID)).toBe(true);
    expect(store.findById("sess_delete")).toBeNull();
    expect(store.count()).toBe(0);
    // The transcript goes with it rather than being left orphaned.
    expect(store.countTurns("sess_delete")).toBe(0);
    expect(store.deleteOwned("sess_delete", OWNER_ID)).toBe(false);
  });

  it("appends a turn without rewriting existing history", () => {
    const store = createStore();
    seed(store, 
      createSession({
        id: "sess_test",
        updatedAt: "2026-05-20T00:00:00.000Z",
        turns: [createTurn("turn_0", "2026-05-20T00:00:00.000Z")],
        timeline: [createNode("node_0", "turn_0", "2026-05-20T00:00:00.000Z")]
      })
    );

    const turn = createTurn("turn_1", "2026-05-20T00:05:00.000Z");
    const node = createNode("node_1", "turn_1", "2026-05-20T00:05:00.000Z");
    const nextState = createState(3);

    store.appendTurn("sess_test", {
      turn,
      state: nextState,
      timelineNode: node,
      updatedAt: "2026-05-20T00:05:00.000Z"
    });

    const stored = store.findById("sess_test");
    expect(stored?.turns.map((item) => item.id)).toEqual(["turn_0", "turn_1"]);
    expect(stored?.timeline.map((item) => item.id)).toEqual(["node_0", "node_1"]);
    expect(stored?.state).toEqual(nextState);
    expect(stored?.updatedAt).toBe("2026-05-20T00:05:00.000Z");
    expect(store.listRecent()[0]?.turnCount).toBe(2);
  });

  it("appends a turn without a timeline node", () => {
    const store = createStore();
    seed(store, createSession({ id: "sess_test", updatedAt: "2026-05-20T00:00:00.000Z" }));

    store.appendTurn("sess_test", {
      turn: createTurn("turn_0", "2026-05-20T00:01:00.000Z"),
      state: createState(1),
      timelineNode: null,
      updatedAt: "2026-05-20T00:01:00.000Z"
    });

    const stored = store.findById("sess_test");
    expect(stored?.turns).toHaveLength(1);
    expect(stored?.timeline).toHaveLength(0);
  });

  it("keeps turn ids from different sessions apart", () => {
    const store = createStore();
    const turnId = "turn_0";

    seed(store, 
      createSession({
        id: "sess_a",
        updatedAt: "2026-05-20T00:00:00.000Z",
        turns: [{ ...createTurn(turnId, "2026-05-20T00:00:00.000Z"), narration: "A 的开场" }]
      })
    );
    seed(store, 
      createSession({
        id: "sess_b",
        updatedAt: "2026-05-20T00:01:00.000Z",
        turns: [{ ...createTurn(turnId, "2026-05-20T00:01:00.000Z"), narration: "B 的开场" }]
      })
    );

    expect(store.findById("sess_a")?.turns[0]?.narration).toBe("A 的开场");
    expect(store.findById("sess_b")?.turns[0]?.narration).toBe("B 的开场");
  });

  it("summarises the latest session per story without loading transcripts", () => {
    const store = createStore();

    seed(store, 
      createSession({
        id: "sess_old",
        updatedAt: "2026-05-20T00:00:00.000Z",
        turns: [{ ...createTurn("turn_0", "2026-05-20T00:00:00.000Z"), narration: "旧的一段" }]
      })
    );
    seed(store, 
      createSession({
        id: "sess_new",
        updatedAt: "2026-05-20T01:00:00.000Z",
        turns: [
          { ...createTurn("turn_0", "2026-05-20T00:59:00.000Z"), narration: "较早的一段" },
          { ...createTurn("turn_1", "2026-05-20T01:00:00.000Z"), narration: "最新的一段" }
        ]
      })
    );

    const overviews = store.listRecentOverviews(OWNER_ID);

    expect(overviews).toHaveLength(1);
    expect(overviews[0]).toMatchObject({
      id: "sess_new",
      storyId: "rain-mansion",
      turnCount: 2,
      readerRoleName: "陆清河",
      latestNarration: "最新的一段"
    });
  });

  it("reports a null latest narration for a session with no turns", () => {
    const store = createStore();
    seed(store, createSession({ id: "sess_empty", updatedAt: "2026-05-20T00:00:00.000Z" }));

    expect(store.listRecentOverviews(OWNER_ID)[0]?.latestNarration).toBeNull();
  });

  it("hides another reader's session from scoped reads and lists", () => {
    const store = createStore();
    seed(store, createSession({ id: "sess_mine", updatedAt: "2026-05-20T00:00:00.000Z" }));
    seed(store, createSession({ id: "sess_theirs", updatedAt: "2026-05-20T01:00:00.000Z" }), "user_other");

    expect(store.findById("sess_mine", OWNER_ID)?.id).toBe("sess_mine");
    expect(store.findById("sess_theirs", OWNER_ID)).toBeNull();
    // An unscoped read is still possible for admin-facing callers.
    expect(store.findById("sess_theirs")?.id).toBe("sess_theirs");

    expect(store.listRecentOverviews(OWNER_ID).map((item) => item.id)).toEqual(["sess_mine"]);
    expect(store.listRecentOverviews("user_other").map((item) => item.id)).toEqual(["sess_theirs"]);
    // listRecent stays global because it backs the admin console.
    expect(store.listRecent()).toHaveLength(2);
  });

  it("reads only the newest turns when a window is given, still oldest first", () => {
    const store = createStore();
    const turns = Array.from({ length: 10 }, (_, index) =>
      createTurn(`turn_${index}`, `2026-05-20T00:${String(index).padStart(2, "0")}:00.000Z`)
    );
    seed(store, createSession({ id: "sess_test", updatedAt: "2026-05-20T00:09:00.000Z", turns }));

    const windowed = store.findById("sess_test", OWNER_ID, { recentTurns: 3 });
    expect(windowed?.turns.map((turn) => turn.id)).toEqual(["turn_7", "turn_8", "turn_9"]);

    // No window still means the whole transcript, which rewind depends on.
    expect(store.findById("sess_test", OWNER_ID)?.turns).toHaveLength(10);
  });

  it("windows timeline nodes independently of turns", () => {
    const store = createStore();
    const timeline = Array.from({ length: 5 }, (_, index) =>
      createNode(`node_${index}`, `turn_${index}`, `2026-05-20T00:0${index}:00.000Z`)
    );
    seed(store, createSession({ id: "sess_test", updatedAt: "2026-05-20T00:04:00.000Z", timeline }));

    const windowed = store.findById("sess_test", OWNER_ID, { recentTimelineNodes: 2 });
    expect(windowed?.timeline.map((node) => node.id)).toEqual(["node_3", "node_4"]);
  });

  it("walks backwards through older turns from a cursor", () => {
    const store = createStore();
    const turns = Array.from({ length: 6 }, (_, index) =>
      createTurn(`turn_${index}`, `2026-05-20T00:0${index}:00.000Z`)
    );
    seed(store, createSession({ id: "sess_test", updatedAt: "2026-05-20T00:05:00.000Z", turns }));

    expect(store.listTurnsBefore("sess_test", "turn_4", 2).map((turn) => turn.id)).toEqual([
      "turn_2",
      "turn_3"
    ]);
    // Asking for more than exists yields what there is, without wrapping around.
    expect(store.listTurnsBefore("sess_test", "turn_1", 5).map((turn) => turn.id)).toEqual(["turn_0"]);
    expect(store.listTurnsBefore("sess_test", "turn_0", 5)).toEqual([]);

    expect(store.hasTurnsBefore("sess_test", "turn_1")).toBe(true);
    expect(store.hasTurnsBefore("sess_test", "turn_0")).toBe(false);
  });

  it("refuses a cursor that belongs to another session", () => {
    const store = createStore();
    seed(
      store,
      createSession({
        id: "sess_a",
        updatedAt: "2026-05-20T00:01:00.000Z",
        turns: [createTurn("turn_0", "2026-05-20T00:00:00.000Z"), createTurn("turn_1", "2026-05-20T00:01:00.000Z")]
      })
    );
    seed(
      store,
      createSession({
        id: "sess_b",
        updatedAt: "2026-05-20T00:01:00.000Z",
        turns: [createTurn("turn_0", "2026-05-20T00:00:00.000Z")]
      })
    );

    // turn_1 exists, but not in sess_b, so it must not leak sess_a's history.
    expect(store.listTurnsBefore("sess_b", "turn_1", 5)).toEqual([]);
    expect(store.hasTurnsBefore("sess_b", "turn_1")).toBe(false);
  });

  it("counts turns from the denormalised counter", () => {
    const store = createStore();
    seed(
      store,
      createSession({
        id: "sess_test",
        updatedAt: "2026-05-20T00:01:00.000Z",
        turns: [createTurn("turn_0", "2026-05-20T00:00:00.000Z"), createTurn("turn_1", "2026-05-20T00:01:00.000Z")]
      })
    );

    expect(store.countTurns("sess_test")).toBe(2);
    expect(store.countTurns("missing")).toBe(0);
  });
});

function createState(turnCount = 0): WorldState {
  return {
    scene: "雨夜醒来",
    location: "旧宅东厢房",
    emotion: {},
    relations: {},
    items: [],
    clues: [],
    flags: {},
    turnCount
  };
}

function createTurn(id: string, createdAt: string): SessionTurn {
  return {
    id,
    sessionId: "sess_test",
    inputType: "free_text",
    input: "进入故事",
    narration: "你醒来时，窗外正落着细雨。",
    dialogues: [{ speaker: "陆清河", text: "别出声。" }],
    choices: [{ id: "c1", text: "继续观察", risk: "low" }],
    stateSnapshot: createState(),
    intervention: null,
    createdAt
  };
}

function createNode(id: string, turnId: string, createdAt: string): TimelineNode {
  return {
    id,
    sessionId: "sess_test",
    turnId,
    title: "雨夜醒来",
    summary: "你醒来。",
    stateSnapshot: createState(),
    createdAt
  };
}

function createSession(overrides: {
  id: string;
  updatedAt: string;
  turns?: SessionTurn[];
  timeline?: TimelineNode[];
}): StorySession {
  const turns = (overrides.turns ?? []).map((turn) => ({ ...turn, sessionId: overrides.id }));
  const timeline = (overrides.timeline ?? []).map((node) => ({ ...node, sessionId: overrides.id }));

  return {
    id: overrides.id,
    storyId: "rain-mansion",
    readerRole: {
      mode: "existing_character",
      characterId: "lu_qinghe",
      name: "陆清河",
      description: "旧宅管事"
    },
    state: createState(turns.length),
    turns,
    timeline,
    createdAt: "2026-05-20T00:00:00.000Z",
    updatedAt: overrides.updatedAt
  };
}
