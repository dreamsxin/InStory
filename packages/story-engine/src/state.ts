import type {
  NarrativeResult,
  StateDelta,
  StorySession,
  TimelineNode,
  WorldState
} from "@instory/shared";

export function createInitialState(): WorldState {
  return {
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
  };
}

export function applyStateDelta(state: WorldState, delta: StateDelta): WorldState {
  return {
    scene: delta.scene ?? state.scene,
    location: delta.location ?? state.location,
    emotion: {
      ...state.emotion,
      ...delta.emotion
    },
    relations: {
      ...state.relations,
      ...delta.relations
    },
    items: mergeUnique(state.items, delta.itemsAdded ?? []),
    clues: mergeUnique(state.clues, delta.cluesAdded ?? []),
    flags: {
      ...state.flags,
      ...delta.flags
    },
    turnCount: state.turnCount + 1
  };
}

export function shouldCreateTimelineNode(state: WorldState, result: NarrativeResult): boolean {
  return state.turnCount === 0 || result.memoryEvents.length > 0 || result.stateDelta.cluesAdded?.length === 1;
}

export function createTimelineNode(params: {
  session: StorySession;
  turnId: string;
  result: NarrativeResult;
  state: WorldState;
  now: string;
}): TimelineNode {
  const firstMemory = params.result.memoryEvents[0] ?? params.result.narration.slice(0, 36);

  return {
    id: `node_${params.session.timeline.length + 1}`,
    sessionId: params.session.id,
    turnId: params.turnId,
    title: params.state.scene,
    summary: firstMemory,
    stateSnapshot: params.state,
    createdAt: params.now
  };
}

function mergeUnique(current: string[], additions: string[]): string[] {
  return [...new Set([...current, ...additions])];
}
