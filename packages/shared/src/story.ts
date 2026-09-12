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
  /**
   * When the counter goes back to zero, as an absolute instant. The day is a UTC
   * day, so east of Greenwich "tomorrow" is not midnight local time - in UTC+8 it
   * is 08:00. Clients render this in the reader's own timezone instead of saying
   * "come back tomorrow", which is only true for part of the world.
   */
  resetsAt: string;
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

/**
 * A story as the shelf shows it: the summary plus what can honestly be said about
 * its length. Counts and word targets only - anchor titles and descriptions are the
 * author's outline and never leave the author's own view.
 */
export interface ShelfStory extends StorySummary {
  /** Anchors the author marked 必经 or 可作为结局, so "how many beats are planned". */
  plannedBeats: number;
  /** Words the model is actually asked for per passage, from defaultSegmentLength. */
  segmentTargetWords: number;
}

/**
 * How the shelf is ordered. Decided on the server, because the order depends on
 * reading history the browser is no longer handed in full: once the shelf is paged,
 * sorting in the client could only order the page it happens to hold, which is a
 * different shelf than the one the reader asked for.
 */
export type ShelfSort = "recent" | "readers" | "title";

/**
 * One page of the public shelf, plus what the page needs to describe itself. The
 * reader counts travel with the stories instead of coming from a second endpoint:
 * two endpoints each deciding what "public" means is how a card ends up showing
 * numbers computed for a different set than the one it is part of.
 */
export interface ShelfPage {
  stories: ShelfStory[];
  /** Reader counts for exactly the stories on this page. */
  insights: StoryReadingInsight[];
  /** How many public stories match the query - not how many this page holds. */
  total: number;
  /**
   * How many public stories exist at all, ignoring the query. This is what tells
   * "nobody has published anything yet" apart from "your keyword matched nothing",
   * and those two need different words on screen.
   */
  publicTotal: number;
  /** Every genre on the public shelf, so the filter offers more than this page's. */
  genres: string[];
  /** The window as the server actually applied it, after clamping. */
  limit: number;
  offset: number;
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
 * The plot anchors of one story, replaced as a whole. A row that already exists sends
 * its `id` back so the server can keep it: ids were positional
 * (`story-anchor-1`, `-2`, …), and now that turns record which anchor they advanced,
 * a positional id would hand one beat's readers to whichever beat later took that
 * slot. Deleting a beat drops its counts, which is what deleting a beat means; a new
 * row gets a fresh id that no future insert can shadow.
 */
export interface UpdateStoryAnchorsRequest {
  anchors: Array<{
    /** The existing anchor's id, or omitted for a row the author just added. */
    id?: string | null;
    title: string;
    type: StoryAnchorType;
    description: string;
  }>;
}



/**
 * A passage the author wrote themselves, to be handed to the reader word for word
 * instead of generated. This is the first level of `ARCHITECTURE.md`'s three-level
 * priority (预设 → 已生成 → 现生成), which until now had no data behind it: an author
 * could only write anchors, which are constraints on generation, not the text.
 *
 * Passages are an ordered list per story and are served in that order, one per
 * 继续阅读, only while the story is in 剧本 mode - see `experienceMode`. A passage that
 * is served costs no model call, so it also costs the reader nothing from the daily
 * quota.
 */
export interface StorySegment {
  id: string;
  storyId: string;
  /** The author's own label for this passage. Never shown to a reader. */
  title: string;
  /** The passage as the reader will read it, unchanged. */
  narration: string;
  /**
   * The beat this passage carries, if the author tied it to one. Kept so a preset
   * passage counts in the author's beat report the same way a generated one does -
   * without it, a fully scripted story would report that nobody reached any beat.
   */
  anchorId: string | null;
}

/**
 * The preset passages of one story, replaced as a whole, like the anchors. An
 * existing row sends its `id` back so it keeps its identity: turns record which
 * passage they served, and reusing an id positionally would let a reader who
 * branched away be served a passage they already read.
 */
export interface UpdateStorySegmentsRequest {
  segments: Array<{
    /** The existing passage's id, or omitted for a row the author just added. */
    id?: string | null;
    title: string;
    narration: string;
    /** An anchor id of this same story, or null for "not tied to a beat". */
    anchorId?: string | null;
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
  /** Passages the author wrote out in full. Author view only, like the anchors. */
  segments: StorySegment[];
}

/**
 * What an actor looks like to someone who is not the author: name and in-story
 * role only. `secret`, `goals`, `constraints` and `relationToReader` are written
 * for the model, not for the reader - handing them over spoils the story the
 * author is trying to tell.
 */
export interface PublicCharacterProfile {
  id: string;
  storyId: string;
  name: string;
  role: string;
}

/**
 * A story as a reader may know it. Plot anchors are absent rather than emptied:
 * they are the author's outline, including what must never happen early and how
 * the story can end, so a reader is not told there are none - they are simply not
 * part of this view.
 */
export interface PublicStoryDetail {
  story: StorySummary;
  world: WorldProfile;
  characters: PublicCharacterProfile[];
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
  /**
   * Which plot anchor this passage advanced, as the model reports it, or null when it
   * advanced none. The server keeps it only when the id really belongs to that story,
   * so an invented id becomes null instead of a phantom beat. Never returned to a
   * reader: the anchor list is the author's outline.
   */
  anchorId: string | null;
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
  /** Snapshotted when the reader opened it, so a deleted story still has a name. */
  storyTitle: string;
  /**
   * The story as it is configured now, or null when the author has deleted it. Null
   * makes the card a tombstone: it says the story is gone rather than quietly
   * disappearing from the shelf, and nothing downstream invents a genre to fill the
   * gap.
   */
  story: StorySummary | null;
  readerRoleName: string;
  latestSummary: string;
  turnCount: number;
  /**
   * True when the viewer is the story's author, so this session is a trial of their
   * own work rather than reading. The list used to mix the two with nothing to tell
   * them apart, which matters because insights already exclude an author's trials -
   * the same session counted as reading here and not there.
   */
  isAuthorTrial: boolean;
  createdAt: string;
  updatedAt: string;
}


/**
 * What one of the author's stories has actually done with readers. Aggregates
 * only: an author sees how far their story carried people, never who those people
 * are or what they wrote. The author's own trial sessions are left out, so a story
 * nobody else has opened honestly reads as zero.
 */
export interface StoryReadingInsight {
  storyId: string;
  /** Distinct accounts other than the author. */
  readers: number;
  /** Reading progress cards, which can exceed the reader count. */
  sessions: number;
  /** Turns spent across all of those sessions. */
  turns: number;
  /** The furthest any single session got, in turns. */
  deepestTurns: number;
  /** When the story was last read, or null if it never was. */
  lastReadAt: string | null;
  /**
   * How many readers each plot anchor was actually reached by, so an author can see
   * whether the beats they planned happen at all. Only anchors some passage claimed
   * appear here; the author's own view knows the full list and shows the rest as
   * "nobody yet". Distinct readers with the author excluded, like `readers`.
   *
   * This counts what the model reported, not ground truth: a passage that advanced a
   * beat without saying so is missing from it.
   */
  anchorReach: Array<{ anchorId: string; readers: number }>;
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
