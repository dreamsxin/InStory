import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { storySeedSchema } from "@instory/shared";
import { StoryStore } from "../db/story-store.js";
import type { AppDatabase } from "../db/app-database.js";
import type { CharacterProfile, CreateStoryRequest, StoryAnchor, StoryDetail, StorySummary, WorldProfile } from "@instory/shared";

interface StorySeed {
  stories: StorySummary[];
  worlds: WorldProfile[];
  characters: CharacterProfile[];
  anchors: StoryAnchor[];
}

export class StoryCatalog {
  private readonly store: StoryStore;

  constructor(database: AppDatabase, seedPath = defaultSeedPath()) {
    this.store = new StoryStore(database);
    this.store.seedIfEmpty(loadSeed(seedPath));
  }

  listStories(): StorySummary[] {
    return this.store.listStories();
  }

  findStory(storyId: string): StoryDetail | null {
    return this.store.findStory(storyId);
  }

  updateStorySummary(storyId: string, input: Omit<StorySummary, "id">): StorySummary | null {
    return this.store.updateStorySummary(storyId, input);
  }

  createStory(input: CreateStoryRequest, characters: CharacterProfile[] = []): StoryDetail {
    return this.store.createStory(input, characters);
  }

  findCharacters(storyId: string): CharacterProfile[] {
    return this.findStory(storyId)?.characters ?? [];
  }

  findAnchors(storyId: string): StoryAnchor[] {
    return this.findStory(storyId)?.anchors ?? [];
  }

  findCharacter(characterId: string): CharacterProfile | null {
    return this.store.findCharacter(characterId);
  }
}

export function loadSeed(seedPath = defaultSeedPath()): StorySeed {
  const raw = readFileSync(seedPath, "utf8");
  return storySeedSchema.parse(JSON.parse(raw));
}

function defaultSeedPath(): string {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  return join(currentDir, "stories.seed.json");
}
