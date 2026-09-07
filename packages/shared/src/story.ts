export type UserRole = "reader" | "admin";

/** Token accounting for one generation attempt. Absent when the provider omits it. */
export interface GenerationUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/** What the reader may still spend today. */
export interface TurnQuota {
  remainingTurnsToday: number;
  dailyLimit: number;
  usedToday: number;
}

/** The authenticated account, as exposed to clients. Never carries credentials. */
export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
}

export interface AuthSessionResponse {
  user: AuthUser;
  expiresAt: string;
}

export type EntryMode = "existing_character" | "custom_role" | "blind";


export type TurnInputType = "free_text" | "choice" | "read_continue";

export type RiskLevel = "low" | "medium" | "high";

export type ExperienceMode = "scripted" | "coauthored" | "improvised";

export type SegmentLengthPreset = "short" | "standard" | "long";

export type Visibility = "private" | "public";

/**
 * The visual dress of the reading surface. A story picks one so its pages feel
 * like they belong to its world: gilded filigree for western fantasy, ink and
 * rice paper for eastern tales, and so on. Purely presentational — the web app
 * owns the labels and the frames, keyed by these ids (see lib/reading-themes.ts
 * and the [data-reading-theme] blocks in styles.css).
 */
export type ReadingTheme = "classic" | "western-fantasy" | "eastern-ink" | "gothic-mystery" | "cyber-frontier";

export const DEFAULT_READING_THEME: ReadingTheme = "classic";

export interface StorySummary {
  id: string;
  ownerId: string | null;
  visibility: Visibility;
  title: string;
  tagline: string;
  genre: string;
  coverUrl: string | null;
  readingTheme: ReadingTheme;
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
  readingTheme?: ReadingTheme;
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
  readingTheme?: ReadingTheme;
  premise: string;
  openingLocationName: string;
  openingLocationDescription: string;
  worldRules: string[];
  aiFreedom: "low" | "medium" | "high";
  experienceMode: ExperienceMode;
  defaultSegmentLength: SegmentLengthPreset;
}

/**
 * One actor inside a story. Created as a snapshot of the author's reader profile,
 * then re-set per story: the same character can be a friend in one story and the
 * one keeping a secret in the next, so these fields belong to the story and never
 * travel back to the profile.
 */
export interface CharacterProfile {
  id: string;
  storyId: string;
  name: string;
  /** Who this actor is inside this story. */
  role: string;
  /** How the actor stands towards the reader when the story opens. */
  relationToReader: string;
  /** Known to the AI and withheld from the reader until the story reveals it. */
  secret: string;
  personality: string[];
  goals: string[];
  constraints: string[];
}

/** The in-story re-set an author can apply to one actor. Name stays as created. */
export interface UpdateStoryCharacterRequest {
  role: string;
  relationToReader: string;
  secret: string;
  personality: string[];
  goals: string[];
  constraints: string[];
}


export type StoryAnchorType = "required" | "optional" | "forbidden" | "ending";

export interface StoryAnchor {
  id: string;
  storyId: string;
  title: string;
  type: StoryAnchorType;
  description: string;
}

/**
 * The plot anchors of one story, replaced as a whole. Ids are the server's to
 * assign: an author reorders and rewrites these freely, and stable ids would only
 * invite a diffing protocol that buys nothing here.
 */
export interface UpdateStoryAnchorsRequest {
  anchors: Array<{
    title: string;
    type: StoryAnchorType;
    description: string;
  }>;
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

/**
 * Why a passage stopped at a place where the reader may want to step in. Six
 * situations, from §5.3 of the interaction design: an actor asks the reader
 * something, a clue surfaces, a crisis closes in, the route forks, a relationship
 * shifts, or the chapter turns.
 */
export type InterventionKind =
  | "npc_question"
  | "clue_found"
  | "crisis"
  | "fork"
  | "relationship_shift"
  | "turning_point";

/**
 * A low-interruption invitation attached to a passage. Absent on passages that
 * are just story: the reader is never made to answer, and continuing reading is
 * always a valid response.
 */
export interface InterventionCue {
  kind: InterventionKind;
  /** One line, in the story's voice, naming what is on offer. */
  prompt: string;
}

export interface NarrativeResult {
  narration: string;
  dialogues: StoryDialogue[];
  choices: StoryChoice[];
  stateDelta: StateDelta;
  memoryEvents: string[];
  /** Null on an ordinary passage; set only at a key node. */
  intervention: InterventionCue | null;
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
  /** Null on an ordinary passage; set only at a key node. */
  intervention: InterventionCue | null;
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
  /**
   * The story as it is configured now. Always present: the server drops a session
   * whose story no longer exists rather than shipping one without it, so nothing
   * downstream has to invent a genre or an experience mode to fill the gap.
   */
  story: StorySummary;
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
  quota: TurnQuota;
}
