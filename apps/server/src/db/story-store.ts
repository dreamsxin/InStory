import type { CharacterProfile, CreateStoryRequest, StoryAnchor, StoryDetail, StorySummary, WorldProfile } from "@instory/shared";
import type { AppDatabase } from "./app-database.js";

export interface StorySeedData {
  stories: StorySummary[];
  worlds: WorldProfile[];
  characters: CharacterProfile[];
  anchors: StoryAnchor[];
}

export class StoryStore {
  private readonly database: AppDatabase;

  constructor(database: AppDatabase) {
    this.database = database;
    this.database.db.exec(`
      CREATE TABLE IF NOT EXISTS stories (
        id TEXT PRIMARY KEY,
        payload TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS worlds (
        story_id TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        FOREIGN KEY(story_id) REFERENCES stories(id)
      );

      CREATE TABLE IF NOT EXISTS characters (
        id TEXT PRIMARY KEY,
        story_id TEXT NOT NULL,
        payload TEXT NOT NULL,
        FOREIGN KEY(story_id) REFERENCES stories(id)
      );

      CREATE TABLE IF NOT EXISTS story_anchors (
        id TEXT PRIMARY KEY,
        story_id TEXT NOT NULL,
        payload TEXT NOT NULL,
        FOREIGN KEY(story_id) REFERENCES stories(id)
      );
    `);
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

  updateStorySummary(storyId: string, input: Omit<StorySummary, "id">): StorySummary | null {
    const current = this.findStorySummary(storyId);
    if (!current) {
      return null;
    }

    const updated: StorySummary = {
      id: current.id,
      ...input
    };
    this.database.db.prepare("UPDATE stories SET payload = ? WHERE id = ?").run(JSON.stringify(updated), storyId);
    return updated;
  }

  createStory(input: CreateStoryRequest): StoryDetail {
    const existing = this.findStorySummary(input.id);
    if (existing) {
      throw new Error("Story id already exists");
    }

    const story: StorySummary = {
      id: input.id,
      title: input.title,
      tagline: input.tagline,
      genre: input.genre,
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
      this.database.db.exec("COMMIT");
    } catch (error) {
      this.database.db.exec("ROLLBACK");
      throw error;
    }

    return {
      story,
      world,
      characters: [],
      anchors: []
    };
  }

  findCharacter(characterId: string): CharacterProfile | null {
    const row = this.database.db.prepare("SELECT payload FROM characters WHERE id = ?").get(characterId) as
      | { payload: string }
      | undefined;
    return row ? (JSON.parse(row.payload) as CharacterProfile) : null;
  }

  countStories(): number {
    const row = this.database.db.prepare("SELECT COUNT(*) AS count FROM stories").get() as { count: number };
    return row.count;
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
    return rows.map((row) => JSON.parse(row.payload) as CharacterProfile);
  }

  private findAnchors(storyId: string): StoryAnchor[] {
    const rows = this.database.db
      .prepare("SELECT payload FROM story_anchors WHERE story_id = ? ORDER BY id ASC")
      .all(storyId) as Array<{ payload: string }>;
    return rows.map((row) => JSON.parse(row.payload) as StoryAnchor);
  }
}

function normalizeStorySummary(story: StorySummary): StorySummary {
  return {
    ...story,
    experienceMode: story.experienceMode ?? "coauthored",
    defaultSegmentLength: story.defaultSegmentLength ?? "standard"
  };
}
