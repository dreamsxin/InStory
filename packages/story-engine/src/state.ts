import type {
  InterventionCue,
  NarrativeResult,
  StateDelta,
  StorySession,
  TimelineNode,
  TurnInputType,
  WorldState
} from "@instory/shared";

export interface StoryOpening {
  scene?: string;
  location?: string;
}

/**
 * Builds the opening world state. The defaults are deliberately story-agnostic:
 * callers should pass the opening scene/location from the story's world config so
 * that a newly authored story never inherits another story's setting.
 */
export function createInitialState(opening: StoryOpening = {}): WorldState {
  return {
    scene: opening.scene ?? "故事开场",
    location: opening.location ?? "未知之地",
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
  if (state.turnCount === 0 || result.memoryEvents.length > 0) {
    return true;
  }

  return (result.stateDelta.cluesAdded?.length ?? 0) > 0;
}

/**
 * Reads a key node (§5.3) out of what the passage actually changed, for when the
 * model did not mark one itself. Without this the whole feature would depend on
 * the model's diligence: a model that never fills in `intervention` would leave
 * the reader with no key nodes at all, and nothing would look broken.
 *
 * Only for passages the reader chose to read on from. A passage that answered
 * their own action was already their turn to act, so naming it as an opening to
 * act is noise. Two of the six kinds are never derived here - a fork and an
 * actor's question live in the prose, not in the state - so those stay the
 * model's to report.
 */
export function deriveIntervention(params: {
  result: NarrativeResult;
  previous: WorldState;
  next: WorldState;
  inputType: TurnInputType;
}): InterventionCue | null {
  if (params.inputType !== "read_continue") {
    return null;
  }

  const delta = params.result.stateDelta;

  if (rose(params.previous.emotion, params.next.emotion, ["fear", "alertness"], 3)) {
    return { kind: "crisis", prompt: "局势在这一段收紧了。你可以继续读下去，也可以现在就动。" };
  }

  if (shifted(params.previous.relations, params.next.relations, 2)) {
    return { kind: "relationship_shift", prompt: "有人对你的态度变了。你可以继续读下去，也可以现在开口。" };
  }

  const clue = delta.cluesAdded?.[0];
  if (clue) {
    return { kind: "clue_found", prompt: `「${trim(clue, 24)}」摆在眼前。你可以继续读下去，也可以现在追下去。` };
  }

  if (params.next.scene !== params.previous.scene) {
    return { kind: "turning_point", prompt: `${trim(params.next.scene, 24)} 到这里转了向。你可以继续读下去，也可以现在介入。` };
  }

  return null;
}

/** Whether any of the named readings climbed by at least `by`. */
function rose(
  previous: Record<string, number>,
  next: Record<string, number>,
  keys: string[],
  by: number
): boolean {
  return keys.some((key) => (next[key] ?? 0) - (previous[key] ?? 0) >= by);
}

/** Whether any relation moved by at least `by`, in either direction. */
function shifted(previous: Record<string, number>, next: Record<string, number>, by: number): boolean {
  return Object.entries(next).some(([actor, value]) => Math.abs(value - (previous[actor] ?? 0)) >= by);
}

function trim(text: string, max: number): string {
  const clean = text.trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
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
