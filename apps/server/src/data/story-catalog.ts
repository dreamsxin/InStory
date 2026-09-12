import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { storySeedSchema } from "@instory/shared";
import { StoryStore } from "../db/story-store.js";
import type { AppDatabase } from "../db/app-database.js";
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

  listPublicStories(): StorySummary[] {
    return this.store.listPublicStories();
  }

  /** Public stories matching a shelf query, unpaged; the route orders and slices. */
  searchPublicStories(filter: { q?: string; genre?: string } = {}): StorySummary[] {
    return this.store.searchPublicStories(filter);
  }

  countPublicStories(): number {
    return this.store.countPublicStories();
  }

  listPublicGenres(): string[] {
    return this.store.listPublicGenres();
  }


  listStoriesByOwner(ownerId: string): StorySummary[] {
    return this.store.listStoriesByOwner(ownerId);
  }

  /** Planned-beat counts by story id, for the shelf's length estimate. */
  countPlannedBeats(): Map<string, number> {
    return this.store.countPlannedBeats();
  }


  findStory(storyId: string): StoryDetail | null {
    return this.store.findStory(storyId);
  }

  updateStorySummary(storyId: string, input: Omit<StorySummary, "id" | "ownerId">): StorySummary | null {
    return this.store.updateStorySummary(storyId, input);
  }

  createStory(input: CreateStoryRequest, characters: CharacterProfile[] = [], ownerId: string | null = null): StoryDetail {
    return this.store.createStory(input, characters, ownerId);
  }

  updateOwnedStory(storyId: string, ownerId: string, input: UpdateStoryRequest): StoryDetail | null {
    return this.store.updateOwnedStory(storyId, ownerId, input);
  }

  deleteOwnedStory(storyId: string, ownerId: string): boolean {
    return this.store.deleteOwnedStory(storyId, ownerId);
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

  updateOwnedCharacter(
    storyId: string,
    characterId: string,
    ownerId: string,
    input: UpdateStoryCharacterRequest
  ): CharacterProfile | null {
    return this.store.updateOwnedCharacter(storyId, characterId, ownerId, input);
  }

  replaceOwnedAnchors(storyId: string, ownerId: string, input: UpdateStoryAnchorsRequest): StoryAnchor[] | null {
    return this.store.replaceOwnedAnchors(storyId, ownerId, input);
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
