import { z } from "zod";

export const visibilitySchema = z.enum(["private", "public"]);

/** Keep in step with ReadingTheme and the [data-reading-theme] frames in styles.css. */
export const readingThemeSchema = z.enum([
  "classic",
  "western-fantasy",
  "eastern-ink",
  "gothic-mystery",
  "cyber-frontier"
]);

export const registerRequestSchema = z.object({
  email: z.string().email().max(200),
  displayName: z.string().min(1).max(40),
  // Long enough to matter, capped so a huge input cannot be used to burn CPU in scrypt.
  password: z.string().min(8).max(200)
});

export const loginRequestSchema = z.object({
  email: z.string().email().max(200),
  password: z.string().min(1).max(200)
});


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
  visibility: visibilitySchema.default("private"),
  name: z.string().min(1).max(40),
  gender: z.string().max(40).nullable(),
  personality: z.string().min(1).max(1200),
  avatarUrl: z.string().max(2000).nullable(),
  description: z.string().min(1).max(2000),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1)
});

/**
 * Deliberately without `visibility`. A reader profile is stored with one and nothing
 * ever read it: there is no way to browse other people's personas and no way to cast
 * one into a story. Accepting the field kept the promise alive in the API, so it is
 * gone from the request; new profiles are private, which is what they always were in
 * practice. Making it mean something (public personas an author may cast) is a product
 * decision, not a gap to be quietly filled.
 */
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
  inputType: z.enum(["free_text", "choice", "read_continue"]),
  content: z.string().min(1).max(2000),
  choiceId: z.string().nullish()
});

export const interventionCueSchema = z.object({
  kind: z.enum(["npc_question", "clue_found", "crisis", "fork", "relationship_shift", "turning_point"]),
  prompt: z.string().min(1).max(400)
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
  memoryEvents: z.array(z.string()),
  // A malformed cue must not cost the reader the whole passage, so anything the
  // model gets wrong here degrades to "no cue" instead of failing validation.
  intervention: interventionCueSchema.nullable().catch(null).default(null),
  // Same treatment for the anchor the model claims to have advanced: anything wrong
  // or missing means "no beat reported", never a lost passage. The server checks the
  // id against the story's real anchors before storing it.
  anchorId: z.string().nullable().catch(null).default(null)
});


export const storySummarySchema = z.object({
  id: z.string().min(1),
  ownerId: z.string().min(1).nullable(),
  visibility: visibilitySchema.default("public"),
  title: z.string().min(1),
  tagline: z.string().min(1),
  genre: z.string().min(1),
  coverUrl: z.string().max(2000).nullable(),
  readingTheme: readingThemeSchema.default("classic"),
  aiFreedom: z.enum(["low", "medium", "high"]),
  experienceMode: z.enum(["scripted", "coauthored", "improvised"]),
  defaultSegmentLength: z.enum(["short", "standard", "long"])
});

export const createStoryRequestSchema = storySummarySchema
  .omit({ aiFreedom: true, ownerId: true })
  .extend({
    id: z.string().min(3).max(80).regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/),
    title: z.string().min(1).max(80),
    tagline: z.string().min(1).max(160),
    genre: z.string().min(1).max(40),
    coverUrl: z.string().max(2000).nullish(),
    premise: z.string().min(1).max(4000),
    openingLocationName: z.string().min(1).max(80),
    openingLocationDescription: z.string().min(1).max(1000),
    worldRules: z.array(z.string().min(1).max(500)).max(20),
    castProfileIds: z.array(z.string().min(1)).max(12).optional(),
    visibility: visibilitySchema.default("private"),
    aiFreedom: z.enum(["low", "medium", "high"]).default("medium")
  });

export const updateStoryRequestSchema = createStoryRequestSchema.omit({
  id: true,
  castProfileIds: true
});

export const characterProfileSchema = z.object({
  id: z.string().min(1),
  storyId: z.string().min(1),
  name: z.string().min(1),
  role: z.string().min(1),
  // Defaulted, not required: stories created before the in-story re-set existed
  // have stored payloads without these two fields.
  relationToReader: z.string().default(""),
  secret: z.string().default(""),
  personality: z.array(z.string()),
  goals: z.array(z.string()),
  constraints: z.array(z.string())
});

export const updateStoryCharacterRequestSchema = z.object({
  role: z.string().min(1).max(2000),
  relationToReader: z.string().max(2000),
  secret: z.string().max(2000),
  personality: z.array(z.string().max(400)).max(20),
  goals: z.array(z.string().max(400)).max(20),
  constraints: z.array(z.string().max(400)).max(20)
});


export const storyAnchorSchema = z.object({
  id: z.string().min(1),
  storyId: z.string().min(1),
  title: z.string().min(1),
  type: z.enum(["required", "optional", "forbidden", "ending"]),
  description: z.string().min(1)
});

export const updateStoryAnchorsRequestSchema = z.object({
  anchors: z
    .array(
      z.object({
        // Sent back for a row that already exists, so its id - and the reader counts
        // hanging off it - survive a reorder or an unrelated edit.
        id: z.string().min(1).max(200).nullish(),
        title: z.string().min(1).max(80),
        type: z.enum(["required", "optional", "forbidden", "ending"]),
        description: z.string().min(1).max(2000)
      })
    )
    .max(20)
});



export const storySegmentSchema = z.object({
  id: z.string().min(1),
  storyId: z.string().min(1),
  title: z.string().min(1),
  narration: z.string().min(1),
  anchorId: z.string().nullable()
});

/**
 * The author's own passages, replaced as a whole set like the anchors. `narration` is
 * capped well above a long passage (the 详细 preset asks the model for ~1600 字) but
 * not unbounded: this text is handed to a reader verbatim and stored per story.
 */
export const updateStorySegmentsRequestSchema = z.object({
  segments: z
    .array(
      z.object({
        // Sent back for a row that already exists, so a reader who branched away is
        // not served a passage they have already read.
        id: z.string().min(1).max(200).nullish(),
        title: z.string().min(1).max(80),
        narration: z.string().min(1).max(8000),
        anchorId: z.string().min(1).max(200).nullish()
      })
    )
    .max(50)
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

/**
 * The public shelf's query. Everything is optional - an unadorned `GET /api/stories`
 * is the default shelf - but nothing is guessed: a `sort` or `limit` the server
 * cannot read is refused rather than quietly replaced by the default, because a
 * shelf that silently ignores what it was asked for is the same kind of lie as a
 * card that invents a number.
 *
 * `limit` is capped because it is the only knob a caller could use to ask for the
 * whole shelf at once, which is exactly what paging exists to stop.
 */
export const shelfQuerySchema = z.object({
  q: z.string().max(80).optional(),
  genre: z.string().max(80).optional(),
  sort: z.enum(["recent", "readers", "title"]).default("recent"),
  limit: z.coerce.number().int().min(1).max(60).default(24),
  offset: z.coerce.number().int().min(0).default(0)
});

