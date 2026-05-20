import { z } from "zod";

export const createSessionRequestSchema = z.object({
  entryMode: z.enum(["existing_character", "custom_role", "blind"]),
  characterId: z.string().nullish(),
  customRole: z
    .object({
      name: z.string().min(1),
      description: z.string().min(1)
    })
    .nullish()
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
