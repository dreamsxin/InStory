import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { storySeedSchema } from "@instory/shared";
import type { CharacterProfile, StoryAnchor, StoryDetail, StorySummary, WorldProfile } from "@instory/shared";

interface StorySeed {
  stories: StorySummary[];
  worlds: WorldProfile[];
  characters: CharacterProfile[];
  anchors: StoryAnchor[];
}

export class StoryCatalog {
  private readonly seed: StorySeed;

  constructor(seedPath = defaultSeedPath()) {
    const raw = readFileSync(seedPath, "utf8");
    this.seed = storySeedSchema.parse(JSON.parse(raw));
  }

  listStories(): StorySummary[] {
    return this.seed.stories;
  }

  findStory(storyId: string): StoryDetail | null {
    const story = this.seed.stories.find((item) => item.id === storyId);
    const world = this.seed.worlds.find((item) => item.storyId === storyId);

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

  findCharacters(storyId: string): CharacterProfile[] {
    return this.seed.characters.filter((item) => item.storyId === storyId);
  }

  findAnchors(storyId: string): StoryAnchor[] {
    return this.seed.anchors.filter((item) => item.storyId === storyId);
  }

  findCharacter(characterId: string): CharacterProfile | null {
    return this.seed.characters.find((item) => item.id === characterId) ?? null;
  }
}

function defaultSeedPath(): string {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  return join(currentDir, "stories.seed.json");
}
