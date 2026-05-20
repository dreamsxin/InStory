import { z } from "zod";

export const createSessionRequestSchema = z.object({
  entryMode: z.enum(["existing_character", "custom_role", "blind"]),
  characterId: z.string().nullish(),
  readerProfileId: z.string().nullish(),
  customRole: z
    .object({
      name: z.string().min(1),
      description: z.string().min(1),
      gender: z.string().nullish(),
      personality: z.string().nullish(),
      avatarUrl: z.string().nullish()
    })
    .nullish()
});

export const readerProfileSchema = z.object({
  id: z.string().min(1),
  ownerId: z.string().min(1),
  name: z.string().min(1).max(40),
  gender: z.string().max(40).nullable(),
  personality: z.string().min(1).max(1200),
  avatarUrl: z.string().max(2000).nullable(),
  description: z.string().min(1).max(2000),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1)
});

export const createReaderProfileRequestSchema = readerProfileSchema
  .pick({
    name: true,
    gender: true,
    personality: true,
    avatarUrl: true,
    description: true
  })
  .extend({
    gender: z.string().max(40).nullish(),
    avatarUrl: z.string().max(2000).nullish()
  });

export const createTurnRequestSchema = z.object({
  inputType: z.enum(["free_text", "choice"]),
  content: z.string().min(1).max(2000),
  choiceId: z.string().nullish()
});

export const narrativeResultSchema = z.object({
  narration: z.string().min(1),
  dialogues: z.array(
    z.object({
      speaker: z.string().min(1),
      text: z.string().min(1)
    })
  ),
  choices: z
    .array(
      z.object({
        id: z.string().min(1),
        text: z.string().min(1),
        risk: z.enum(["low", "medium", "high"])
      })
    )
    .min(1)
    .max(4),
  stateDelta: z.object({
    scene: z.string().optional(),
    location: z.string().optional(),
    emotion: z.record(z.string(), z.number()).optional(),
    relations: z.record(z.string(), z.number()).optional(),
    itemsAdded: z.array(z.string()).optional(),
    cluesAdded: z.array(z.string()).optional(),
    flags: z.record(z.string(), z.boolean()).optional()
  }),
  memoryEvents: z.array(z.string())
});

export const storySummarySchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  tagline: z.string().min(1),
  genre: z.string().min(1),
  aiFreedom: z.enum(["low", "medium", "high"])
});

export const characterProfileSchema = z.object({
  id: z.string().min(1),
  storyId: z.string().min(1),
  name: z.string().min(1),
  role: z.string().min(1),
  personality: z.array(z.string()),
  goals: z.array(z.string()),
  constraints: z.array(z.string())
});

export const storyAnchorSchema = z.object({
  id: z.string().min(1),
  storyId: z.string().min(1),
  title: z.string().min(1),
  type: z.enum(["required", "optional", "forbidden", "ending"]),
  description: z.string().min(1)
});

export const worldProfileSchema = z.object({
  storyId: z.string().min(1),
  premise: z.string().min(1),
  rules: z.array(z.string()),
  locations: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      description: z.string().min(1)
    })
  )
});

export const storySeedSchema = z.object({
  stories: z.array(storySummarySchema),
  worlds: z.array(worldProfileSchema),
  characters: z.array(characterProfileSchema),
  anchors: z.array(storyAnchorSchema)
});
