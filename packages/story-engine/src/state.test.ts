import { describe, expect, it } from "vitest";
import type { NarrativeResult, StorySession, WorldState } from "@instory/shared";
import { applyStateDelta, createInitialState, createTimelineNode, shouldCreateTimelineNode } from "./state.js";

describe("story state engine", () => {
  it("creates the default opening state", () => {
    const state = createInitialState();

    expect(state).toEqual({
      scene: "雨夜醒来",
      location: "旧宅东厢房",
      emotion: {
        alertness: 4,
        fear: 2
      },
      relations: {},
      items: [],
      clues: [],
      flags: {},
      turnCount: 0
    });
  });

  it("applies state deltas without losing existing values", () => {
    const state: WorldState = {
      scene: "旧场景",
      location: "旧地点",
      emotion: {
        fear: 2,
        alertness: 4
      },
      relations: {
        lu_qinghe: 1
      },
      items: ["铜钥匙"],
      clues: ["旧线索"],
      flags: {
        heard_footsteps: true
      },
      turnCount: 3
    };

    const nextState = applyStateDelta(state, {
      scene: "新场景",
      emotion: {
        fear: 5
      },
      relations: {
        lu_qinghe: 2,
        housekeeper: -1
      },
      itemsAdded: ["铜钥匙", "湿信纸"],
      cluesAdded: ["旧线索", "门缝里的影子"],
      flags: {
        opened_door: false
      }
    });

    expect(nextState).toEqual({
      scene: "新场景",
      location: "旧地点",
      emotion: {
        fear: 5,
        alertness: 4
      },
      relations: {
        lu_qinghe: 2,
        housekeeper: -1
      },
      items: ["铜钥匙", "湿信纸"],
      clues: ["旧线索", "门缝里的影子"],
      flags: {
        heard_footsteps: true,
        opened_door: false
      },
      turnCount: 4
    });
  });

  it("decides when a timeline node should be created", () => {
    const result = createNarrativeResult({
      memoryEvents: [],
      cluesAdded: []
    });

    expect(shouldCreateTimelineNode(createState({ turnCount: 0 }), result)).toBe(true);
    expect(shouldCreateTimelineNode(createState({ turnCount: 2 }), result)).toBe(false);
    expect(
      shouldCreateTimelineNode(
        createState({ turnCount: 2 }),
        createNarrativeResult({
          memoryEvents: ["玩家发现了异常脚印。"],
          cluesAdded: []
        })
      )
    ).toBe(true);
    expect(
      shouldCreateTimelineNode(
        createState({ turnCount: 2 }),
        createNarrativeResult({
          memoryEvents: [],
          cluesAdded: ["异常脚印"]
        })
      )
    ).toBe(true);
  });

  it("creates timeline nodes from session state and narrative result", () => {
    const session = createSession();
    const state = createState({
      scene: "门外脚步",
      turnCount: 2
    });
    const result = createNarrativeResult({
      memoryEvents: ["你决定相信陆清河，并躲到屏风后。"],
      cluesAdded: ["门外脚步"]
    });

    const node = createTimelineNode({
      session,
      turnId: "turn_2",
      result,
      state,
      now: "2026-05-20T00:00:00.000Z"
    });

    expect(node).toEqual({
      id: "node_2",
      sessionId: "sess_test",
      turnId: "turn_2",
      title: "门外脚步",
      summary: "你决定相信陆清河，并躲到屏风后。",
      stateSnapshot: state,
      createdAt: "2026-05-20T00:00:00.000Z"
    });
  });

  it("falls back to narration summary when memory events are empty", () => {
    const longNarration = "你沿着木廊往前走，雨水从檐角落下，远处忽然传来一声短促的敲门声。";
    const node = createTimelineNode({
      session: createSession(),
      turnId: "turn_3",
      result: createNarrativeResult({
        narration: longNarration,
        memoryEvents: [],
        cluesAdded: []
      }),
      state: createState({ scene: "木廊" }),
      now: "2026-05-20T00:00:00.000Z"
    });

    expect(node.summary).toBe(longNarration.slice(0, 36));
  });
});

function createState(overrides: Partial<WorldState> = {}): WorldState {
  return {
    scene: "雨夜醒来",
    location: "旧宅东厢房",
    emotion: {},
    relations: {},
    items: [],
    clues: [],
    flags: {},
    turnCount: 0,
    ...overrides
  };
}

function createNarrativeResult(
  overrides: Partial<NarrativeResult> & { cluesAdded?: string[] } = {}
): NarrativeResult {
  const { cluesAdded, ...resultOverrides } = overrides;

  return {
    narration: "你听见门外脚步忽然停下。",
    dialogues: [],
    choices: [
      {
        id: "c1",
        text: "继续观察",
        risk: "low"
      }
    ],
    stateDelta: {
      cluesAdded
    },
    memoryEvents: [],
    ...resultOverrides
  };
}

function createSession(): StorySession {
  return {
    id: "sess_test",
    storyId: "story_test",
    readerRole: {
      mode: "existing_character",
      characterId: "lu_qinghe",
      name: "陆清河",
      description: "旧宅管事"
    },
    state: createState(),
    turns: [],
    timeline: [
      {
        id: "node_1",
        sessionId: "sess_test",
        turnId: "turn_1",
        title: "雨夜醒来",
        summary: "你醒来。",
        stateSnapshot: createState(),
        createdAt: "2026-05-20T00:00:00.000Z"
      }
    ],
    createdAt: "2026-05-20T00:00:00.000Z",
    updatedAt: "2026-05-20T00:00:00.000Z"
  };
}
