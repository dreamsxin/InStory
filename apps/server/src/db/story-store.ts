import type {
  CharacterProfile,
  CreateStoryRequest,
  StoryAnchor,
  StoryDetail,
  StorySummary,
  UpdateStoryAnchorsRequest,
  UpdateStoryCharacterRequest,
  UpdateStoryRequest,
  WorldProfile
} from "@instory/shared";
import { DEFAULT_READING_THEME } from "@instory/shared";
import type { AppDatabase } from "./app-database.js";

export interface StorySeedData {
  stories: StorySummary[];
  worlds: WorldProfile[];
  characters: CharacterProfile[];
  anchors: StoryAnchor[];
}

/**
 * Thrown when the author picked an id another story already holds. Typed rather
 * than matched by message: the route turns it into the one thing the author can
 * act on, and a message comparison would break the day the wording changes.
 */
export class DuplicateStoryIdError extends Error {
  readonly storyId: string;

  constructor(storyId: string) {
    super(`Story id already exists: ${storyId}`);
    this.name = "DuplicateStoryIdError";
    this.storyId = storyId;
  }
}

export class StoryStore {
  private readonly database: AppDatabase;

  constructor(database: AppDatabase) {
    this.database = database;
  }

  seedIfEmpty(seed: StorySeedData): void {
    if (this.countStories() > 0) {
      return;
    }

    this.database.db.exec("BEGIN");
    try {
      for (const story of seed.stories) {
        this.database.db.prepare("INSERT INTO stories (id, payload) VALUES (?, ?)").run(story.id, JSON.stringify(story));
      }

      for (const world of seed.worlds) {
        this.database.db
          .prepare("INSERT INTO worlds (story_id, payload) VALUES (?, ?)")
          .run(world.storyId, JSON.stringify(world));
      }

      for (const character of seed.characters) {
        this.database.db
          .prepare("INSERT INTO characters (id, story_id, payload) VALUES (?, ?, ?)")
          .run(character.id, character.storyId, JSON.stringify(character));
      }

      for (const anchor of seed.anchors) {
        this.database.db
          .prepare("INSERT INTO story_anchors (id, story_id, payload) VALUES (?, ?, ?)")
          .run(anchor.id, anchor.storyId, JSON.stringify(anchor));
      }

      this.database.db.exec("COMMIT");
    } catch (error) {
      this.database.db.exec("ROLLBACK");
      throw error;
    }
  }

  listStories(): StorySummary[] {
    const rows = this.database.db.prepare("SELECT payload FROM stories ORDER BY id ASC").all() as Array<{ payload: string }>;
    return rows.map((row) => normalizeStorySummary(JSON.parse(row.payload) as StorySummary));
  }

  listPublicStories(): StorySummary[] {
    return this.listStories().filter((story) => story.visibility === "public");
  }

  /**
   * The public stories matching a shelf query, still unpaged: the caller orders them
   * by reading history (which lives in another table) and then takes its window.
   * Filtering is here rather than in the route because the alternative - and what
   * this replaced - was handing the whole shelf to the browser and letting it filter.
   *
   * The keyword covers title, tagline and genre: a reader looking for a story types
   * whichever of the three they remember. LIKE is case-insensitive for ASCII only,
   * which is all the case there is to fold - the rest of the text is Chinese.
   */
  searchPublicStories(filter: { q?: string; genre?: string } = {}): StorySummary[] {
    const conditions = [PUBLIC_VISIBILITY_SQL];
    const params: string[] = [];

    if (filter.genre) {
      conditions.push(`json_extract(payload, '$.genre') = ?`);
      params.push(filter.genre);
    }

    const keyword = filter.q?.trim();
    if (keyword) {
      conditions.push(
        `(lower(json_extract(payload, '$.title')) LIKE ? ESCAPE '\\'
          OR lower(json_extract(payload, '$.tagline')) LIKE ? ESCAPE '\\'
          OR lower(json_extract(payload, '$.genre')) LIKE ? ESCAPE '\\')`
      );
      const pattern = `%${escapeLikePattern(keyword.toLowerCase())}%`;
      params.push(pattern, pattern, pattern);
    }

    const rows = this.database.db
      .prepare(`SELECT payload FROM stories WHERE ${conditions.join(" AND ")} ORDER BY id ASC`)
      .all(...params) as Array<{ payload: string }>;
    return rows.map((row) => normalizeStorySummary(JSON.parse(row.payload) as StorySummary));
  }

  /** How many stories are public at all, ignoring any query. */
  countPublicStories(): number {
    const row = this.database.db
      .prepare(`SELECT COUNT(*) AS count FROM stories WHERE ${PUBLIC_VISIBILITY_SQL}`)
      .get() as { count: number };
    return row.count;
  }

  /**
   * Every genre on the public shelf, deliberately ignoring the current filters: the
   * dropdown has to offer the genre a reader wants to switch to, not only the ones
   * left after the switch they already made.
   */
  listPublicGenres(): string[] {
    const rows = this.database.db
      .prepare(
        `SELECT DISTINCT json_extract(payload, '$.genre') AS genre
           FROM stories
          WHERE ${PUBLIC_VISIBILITY_SQL}`
      )
      .all() as Array<{ genre: string | null }>;

    return rows
      .map((row) => row.genre)
      .filter((genre): genre is string => Boolean(genre))
      .sort((left, right) => left.localeCompare(right, "zh-CN"));
  }

  listStoriesByOwner(ownerId: string): StorySummary[] {
    return this.listStories().filter((story) => story.ownerId === ownerId);
  }

  findStory(storyId: string): StoryDetail | null {
    const story = this.findStorySummary(storyId);
    const world = this.findWorld(storyId);

    if (!story || !world) {
      return null;
    }

    return {
      story,
      world,
      characters: this.findCharacters(storyId),
      anchors: this.findAnchors(storyId)
    };
  }

  updateStorySummary(storyId: string, input: Omit<StorySummary, "id" | "ownerId">): StorySummary | null {
    const current = this.findStorySummary(storyId);
    if (!current) {
      return null;
    }

    const updated: StorySummary = {
      id: current.id,
      ownerId: current.ownerId,
      ...input
    };
    this.database.db.prepare("UPDATE stories SET payload = ? WHERE id = ?").run(JSON.stringify(updated), storyId);
    return updated;
  }

  createStory(input: CreateStoryRequest, characters: CharacterProfile[] = [], ownerId: string | null = null): StoryDetail {
    const existing = this.findStorySummary(input.id);
    if (existing) {
      throw new DuplicateStoryIdError(input.id);
    }

    const story: StorySummary = {
      id: input.id,
      ownerId,
      visibility: input.visibility ?? "private",
      title: input.title,
      tagline: input.tagline,
      genre: input.genre,
      coverUrl: input.coverUrl ?? null,
      readingTheme: input.readingTheme ?? DEFAULT_READING_THEME,
      aiFreedom: input.aiFreedom,
      experienceMode: input.experienceMode,
      defaultSegmentLength: input.defaultSegmentLength
    };
    const world: WorldProfile = {
      storyId: input.id,
      premise: input.premise,
      rules: input.worldRules,
      locations: [
        {
          id: `${input.id}-opening`,
          name: input.openingLocationName,
          description: input.openingLocationDescription
        }
      ]
    };

    this.database.db.exec("BEGIN");
    try {
      this.database.db.prepare("INSERT INTO stories (id, payload) VALUES (?, ?)").run(story.id, JSON.stringify(story));
      this.database.db
        .prepare("INSERT INTO worlds (story_id, payload) VALUES (?, ?)")
        .run(world.storyId, JSON.stringify(world));
      for (const character of characters) {
        this.database.db
          .prepare("INSERT INTO characters (id, story_id, payload) VALUES (?, ?, ?)")
          .run(character.id, character.storyId, JSON.stringify(character));
      }
      this.database.db.exec("COMMIT");
    } catch (error) {
      this.database.db.exec("ROLLBACK");
      throw error;
    }

    return {
      story,
      world,
      characters,
      anchors: []
    };
  }

  updateOwnedStory(storyId: string, ownerId: string, input: UpdateStoryRequest): StoryDetail | null {
    const current = this.findStory(storyId);
    if (!current || current.story.ownerId !== ownerId) {
      return null;
    }

    const story: StorySummary = {
      ...current.story,
      visibility: input.visibility,
      title: input.title,
      tagline: input.tagline,
      genre: input.genre,
      coverUrl: input.coverUrl ?? null,
      readingTheme: input.readingTheme ?? current.story.readingTheme,
      aiFreedom: input.aiFreedom,
      experienceMode: input.experienceMode,
      defaultSegmentLength: input.defaultSegmentLength
    };
    const world: WorldProfile = {
      storyId,
      premise: input.premise,
      rules: input.worldRules,
      locations: [
        {
          id: current.world.locations[0]?.id ?? `${storyId}-opening`,
          name: input.openingLocationName,
          description: input.openingLocationDescription
        }
      ]
    };

    this.database.db.exec("BEGIN");
    try {
      this.database.db.prepare("UPDATE stories SET payload = ? WHERE id = ?").run(JSON.stringify(story), storyId);
      this.database.db
        .prepare("UPDATE worlds SET payload = ? WHERE story_id = ?")
        .run(JSON.stringify(world), storyId);
      this.database.db.exec("COMMIT");
    } catch (error) {
      this.database.db.exec("ROLLBACK");
      throw error;
    }

    return {
      story,
      world,
      characters: current.characters,
      anchors: current.anchors
    };
  }

  deleteOwnedStory(storyId: string, ownerId: string): boolean {
    const current = this.findStorySummary(storyId);
    if (!current || current.ownerId !== ownerId) {
      return false;
    }

    this.database.db.exec("BEGIN");
    try {
      this.database.db.prepare("DELETE FROM story_anchors WHERE story_id = ?").run(storyId);
      this.database.db.prepare("DELETE FROM characters WHERE story_id = ?").run(storyId);
      this.database.db.prepare("DELETE FROM worlds WHERE story_id = ?").run(storyId);
      const result = this.database.db.prepare("DELETE FROM stories WHERE id = ?").run(storyId);
      this.database.db.exec("COMMIT");
      return result.changes > 0;
    } catch (error) {
      this.database.db.exec("ROLLBACK");
      throw error;
    }
  }

  findCharacter(characterId: string): CharacterProfile | null {
    const row = this.database.db.prepare("SELECT payload FROM characters WHERE id = ?").get(characterId) as
      | { payload: string }
      | undefined;
    return row ? normalizeCharacter(JSON.parse(row.payload) as CharacterProfile) : null;
  }

  /**
   * Applies the author's in-story re-set to one actor. Returns null when the story
   * is not theirs or the actor does not belong to it, so the route can answer 404
   * without leaking whose story it is.
   */
  updateOwnedCharacter(
    storyId: string,
    characterId: string,
    ownerId: string,
    input: UpdateStoryCharacterRequest
  ): CharacterProfile | null {
    const story = this.findStorySummary(storyId);
    if (!story || story.ownerId !== ownerId) {
      return null;
    }

    const current = this.findCharacter(characterId);
    if (!current || current.storyId !== storyId) {
      return null;
    }

    const updated: CharacterProfile = {
      ...current,
      role: input.role,
      relationToReader: input.relationToReader,
      secret: input.secret,
      personality: input.personality,
      goals: input.goals,
      constraints: input.constraints
    };
    this.database.db
      .prepare("UPDATE characters SET payload = ? WHERE id = ?")
      .run(JSON.stringify(updated), characterId);
    return updated;
  }

  /**
   * Replaces the story's plot anchors. Whole-set replacement rather than per-row
   * edits: an author rewrites and reorders these together.
   *
   * A row that carries an id this story already has keeps it. Ids used to be
   * positional (`story-anchor-1`, `-2`, …), which was harmless while nothing pointed
   * at them; now that a turn records the anchor it advanced, deleting the first beat
   * would have slid every later beat one slot down and handed each one the previous
   * occupant's readers. New rows get a random suffix instead, so no future insert can
   * ever take over an id that a turn already refers to.
   */
  replaceOwnedAnchors(
    storyId: string,
    ownerId: string,
    input: UpdateStoryAnchorsRequest
  ): StoryAnchor[] | null {
    const story = this.findStorySummary(storyId);
    if (!story || story.ownerId !== ownerId) {
      return null;
    }

    const existingIds = new Set(this.findAnchors(storyId).map((anchor) => anchor.id));
    const keptIds = new Set<string>();
    const anchors: StoryAnchor[] = input.anchors.map((anchor) => {
      // Only an id this story really has, and only once: a client that repeats one
      // must not collapse two beats onto a single row.
      const reusable = anchor.id && existingIds.has(anchor.id) && !keptIds.has(anchor.id);
      const id = reusable ? anchor.id! : `${storyId}-anchor-${crypto.randomUUID().slice(0, 8)}`;
      keptIds.add(id);

      return {
        id,
        storyId,
        title: anchor.title,
        type: anchor.type,
        description: anchor.description
      };
    });


    this.database.db.exec("BEGIN");
    try {
      this.database.db.prepare("DELETE FROM story_anchors WHERE story_id = ?").run(storyId);
      anchors.forEach((anchor, index) => {
        this.database.db
          .prepare("INSERT INTO story_anchors (id, story_id, payload, seq) VALUES (?, ?, ?, ?)")
          .run(anchor.id, storyId, JSON.stringify(anchor), index);
      });
      this.database.db.exec("COMMIT");

    } catch (error) {
      this.database.db.exec("ROLLBACK");
      throw error;
    }

    return anchors;
  }



  countStories(): number {
    const row = this.database.db.prepare("SELECT COUNT(*) AS count FROM stories").get() as { count: number };
    return row.count;
  }

  /**
   * How many beats each story has planned, by story id. Counts 必经 and 可作为结局
   * anchors: those are the ones a reading has to pass through, so they are the only
   * honest basis for "how long is this". 可选 may never happen and 禁止 is a thing
   * that must not, so neither says anything about length.
   *
   * A count, deliberately: the anchor titles are the author's outline, and shipping
   * them to a shelf would hand every reader the ending before they start.
   */
  countPlannedBeats(): Map<string, number> {
    const rows = this.database.db
      .prepare(
        `SELECT story_id AS storyId, COUNT(*) AS beats
           FROM story_anchors
          WHERE json_extract(payload, '$.type') IN ('required', 'ending')
          GROUP BY story_id`
      )
      .all() as Array<{ storyId: string; beats: number }>;

    return new Map(rows.map((row) => [row.storyId, row.beats]));
  }


  private findStorySummary(storyId: string): StorySummary | null {
    const row = this.database.db.prepare("SELECT payload FROM stories WHERE id = ?").get(storyId) as
      | { payload: string }
      | undefined;
    return row ? normalizeStorySummary(JSON.parse(row.payload) as StorySummary) : null;
  }

  private findWorld(storyId: string): WorldProfile | null {
    const row = this.database.db.prepare("SELECT payload FROM worlds WHERE story_id = ?").get(storyId) as
      | { payload: string }
      | undefined;
    return row ? (JSON.parse(row.payload) as WorldProfile) : null;
  }

  private findCharacters(storyId: string): CharacterProfile[] {
    const rows = this.database.db.prepare("SELECT payload FROM characters WHERE story_id = ? ORDER BY id ASC").all(storyId) as Array<{
      payload: string;
    }>;
    return rows.map((row) => normalizeCharacter(JSON.parse(row.payload) as CharacterProfile));
  }

  private findAnchors(storyId: string): StoryAnchor[] {
    // seq is the author's order; id breaks ties for rows written before seq existed,
    // which is exactly the order they had then.
    const rows = this.database.db
      .prepare("SELECT payload FROM story_anchors WHERE story_id = ? ORDER BY seq ASC, id ASC")
      .all(storyId) as Array<{ payload: string }>;
    return rows.map((row) => JSON.parse(row.payload) as StoryAnchor);
  }

}

/**
 * "This story is on the public shelf", in SQL. It has to repeat what
 * normalizeStorySummary decides in TypeScript, because rows written before
 * `visibility` existed have no such field and a plain `= 'public'` would drop the
 * platform's own seed stories from the shelf. Change one of the two and change both.
 */
const PUBLIC_VISIBILITY_SQL = `COALESCE(
  json_extract(payload, '$.visibility'),
  CASE WHEN json_extract(payload, '$.ownerId') IS NULL THEN 'public' ELSE 'private' END
) = 'public'`;

/** `%` and `_` are wildcards in LIKE; a reader typing them means the characters. */
function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

function normalizeCharacter(character: CharacterProfile): CharacterProfile {
  return {
    ...character,
    // Actors stored before the in-story re-set existed carry neither field.
    relationToReader: character.relationToReader ?? "",
    secret: character.secret ?? ""
  };
}

function normalizeStorySummary(story: StorySummary): StorySummary {
  return {
    ...story,
    ownerId: story.ownerId ?? null,
    visibility: story.visibility ?? (story.ownerId === null ? "public" : "private"),
    coverUrl: story.coverUrl ?? null,
    experienceMode: story.experienceMode ?? "coauthored",
    defaultSegmentLength: story.defaultSegmentLength ?? "standard",
    // Stories written before themes existed keep the plain book page.
    readingTheme: story.readingTheme ?? DEFAULT_READING_THEME
  };
}
