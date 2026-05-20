export type EntryMode = "existing_character" | "custom_role" | "blind";

export type TurnInputType = "free_text" | "choice";

export type RiskLevel = "low" | "medium" | "high";

export type ExperienceMode = "scripted" | "coauthored" | "improvised";

export type SegmentLengthPreset = "short" | "standard" | "long";

export type Visibility = "private" | "public";

export interface StorySummary {
  id: string;
  ownerId: string | null;
  visibility: Visibility;
  title: string;
  tagline: string;
  genre: string;
  coverUrl: string | null;
  aiFreedom: "low" | "medium" | "high";
  experienceMode: ExperienceMode;
  defaultSegmentLength: SegmentLengthPreset;
}

export interface CreateStoryRequest {
  id: string;
  title: string;
  tagline: string;
  genre: string;
  coverUrl?: string | null;
  premise: string;
  openingLocationName: string;
  openingLocationDescription: string;
  worldRules: string[];
  castProfileIds?: string[];
  visibility?: Visibility;
  aiFreedom: "low" | "medium" | "high";
  experienceMode: ExperienceMode;
  defaultSegmentLength: SegmentLengthPreset;
}

export interface UpdateStoryRequest {
  visibility: Visibility;
  title: string;
  tagline: string;
  genre: string;
  coverUrl?: string | null;
  premise: string;
  openingLocationName: string;
  openingLocationDescription: string;
  worldRules: string[];
  aiFreedom: "low" | "medium" | "high";
  experienceMode: ExperienceMode;
  defaultSegmentLength: SegmentLengthPreset;
}

export interface CharacterProfile {
  id: string;
  storyId: string;
  name: string;
  role: string;
  personality: string[];
  goals: string[];
  constraints: string[];
}

export interface StoryAnchor {
  id: string;
  storyId: string;
  title: string;
  type: "required" | "optional" | "forbidden" | "ending";
  description: string;
}

export interface WorldProfile {
  storyId: string;
  premise: string;
  rules: string[];
  locations: Array<{
    id: string;
    name: string;
    description: string;
  }>;
}

export interface StoryDetail {
  story: StorySummary;
  world: WorldProfile;
  characters: CharacterProfile[];
  anchors: StoryAnchor[];
}

export interface ReaderRole {
  mode: EntryMode;
  characterId?: string;
  name: string;
  description: string;
  gender?: string | null;
  personality?: string | null;
  avatarUrl?: string | null;
}

export interface ReaderProfile {
  id: string;
  ownerId: string;
  visibility: Visibility;
  name: string;
  gender: string | null;
  personality: string;
  avatarUrl: string | null;
  description: string;
  createdAt: string;
  updatedAt: string;
}

export interface StoryChoice {
  id: string;
  text: string;
  risk: RiskLevel;
}

export interface StoryDialogue {
  speaker: string;
  text: string;
}

export interface WorldState {
  scene: string;
  location: string;
  emotion: Record<string, number>;
  relations: Record<string, number>;
  items: string[];
  clues: string[];
  flags: Record<string, boolean>;
  turnCount: number;
}

export interface StateDelta {
  scene?: string;
  location?: string;
  emotion?: Record<string, number>;
  relations?: Record<string, number>;
  itemsAdded?: string[];
  cluesAdded?: string[];
  flags?: Record<string, boolean>;
}

export interface NarrativeResult {
  narration: string;
  dialogues: StoryDialogue[];
  choices: StoryChoice[];
  stateDelta: StateDelta;
  memoryEvents: string[];
}

export interface SessionTurn {
  id: string;
  sessionId: string;
  inputType: TurnInputType;
  input: string;
  narration: string;
  dialogues: StoryDialogue[];
  choices: StoryChoice[];
  stateSnapshot: WorldState;
  createdAt: string;
}

export interface TimelineNode {
  id: string;
  sessionId: string;
  turnId: string;
  title: string;
  summary: string;
  stateSnapshot: WorldState;
  createdAt: string;
}

export interface StorySession {
  id: string;
  storyId: string;
  readerRole: ReaderRole;
  state: WorldState;
  turns: SessionTurn[];
  timeline: TimelineNode[];
  createdAt: string;
  updatedAt: string;
}

export interface ReaderSessionListItem {
  id: string;
  storyId: string;
  storyTitle: string;
  readerRoleName: string;
  latestSummary: string;
  turnCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSessionRequest {
  entryMode: EntryMode;
  characterId?: string | null;
  readerProfileId?: string | null;
  customRole?: {
    name: string;
    description: string;
    gender?: string | null;
    personality?: string | null;
    avatarUrl?: string | null;
  } | null;
}

export interface CreateSessionResponse {
  session: StorySession;
  openingTurn: SessionTurn;
}

export interface CreateTurnRequest {
  inputType: TurnInputType;
  content: string;
  choiceId?: string | null;
}

export interface CreateTurnResponse {
  turn: SessionTurn;
  state: WorldState;
  timelineNode: TimelineNode | null;
  quota: {
    remainingTurnsToday: number;
  };
}
