/**
 * How the reader wants a page to look. The story owns its framing (readingTheme);
 * this owns the things only the person holding the screen can judge - type size,
 * how far apart the lines sit, and how wide a line of text may run.
 *
 * Stored as option ids rather than raw numbers so an old or hand-edited value can
 * never produce 3px type: an id we do not recognise falls back to the default for
 * that one field, and the rest of the choice survives.
 */
export type FontScaleId = "small" | "medium" | "large" | "xlarge";
export type LineHeightId = "tight" | "normal" | "loose";
export type MeasureId = "narrow" | "standard" | "wide";
export type SoundId = "on" | "off";

export interface ReadingPrefs {
  fontScale: FontScaleId;
  lineHeight: LineHeightId;
  measure: MeasureId;
  /** Whether the reading surface may make a sound. See lib/reading-sounds.ts. */
  sound: SoundId;
}

export const FONT_SCALE_OPTIONS: Array<{ id: FontScaleId; label: string; scale: number }> = [
  { id: "small", label: "小", scale: 0.92 },
  { id: "medium", label: "适中", scale: 1 },
  { id: "large", label: "大", scale: 1.14 },
  { id: "xlarge", label: "特大", scale: 1.3 }
];

export const LINE_HEIGHT_OPTIONS: Array<{ id: LineHeightId; label: string; ratio: number }> = [
  { id: "tight", label: "紧凑", ratio: 1.62 },
  { id: "normal", label: "适中", ratio: 1.8 },
  { id: "loose", label: "疏朗", ratio: 2.05 }
];

/** How wide one line may run. Long lines are the usual reason a page tires the eye. */
export const MEASURE_OPTIONS: Array<{ id: MeasureId; label: string; width: string }> = [
  { id: "narrow", label: "窄", width: "600px" },
  { id: "standard", label: "标准", width: "760px" },
  { id: "wide", label: "宽", width: "960px" }
];

/**
 * Sound is off until the reader asks for it. A story opened in a quiet room should
 * stay quiet, and a cue nobody chose is an interruption rather than atmosphere.
 */
export const SOUND_OPTIONS: Array<{ id: SoundId; label: string }> = [
  { id: "off", label: "关" },
  { id: "on", label: "开" }
];

export const DEFAULT_READING_PREFS: ReadingPrefs = {
  fontScale: "medium",
  lineHeight: "normal",
  measure: "standard",
  sound: "off"
};

export const READING_PREFS_STORAGE_KEY = "instory.reading-prefs";

/** Tolerant on purpose: anything unrecognised falls back per field, never throws. */
export function parseReadingPrefs(raw: string | null): ReadingPrefs {
  if (!raw) {
    return DEFAULT_READING_PREFS;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return DEFAULT_READING_PREFS;
  }

  if (!parsed || typeof parsed !== "object") {
    return DEFAULT_READING_PREFS;
  }

  const candidate = parsed as Partial<Record<keyof ReadingPrefs, unknown>>;
  return {
    fontScale: pick(FONT_SCALE_OPTIONS, candidate.fontScale, DEFAULT_READING_PREFS.fontScale),
    lineHeight: pick(LINE_HEIGHT_OPTIONS, candidate.lineHeight, DEFAULT_READING_PREFS.lineHeight),
    measure: pick(MEASURE_OPTIONS, candidate.measure, DEFAULT_READING_PREFS.measure),
    // A value written before sound existed lands on "off", which is the same answer
    // as never having been asked.
    sound: pick(SOUND_OPTIONS, candidate.sound, DEFAULT_READING_PREFS.sound)
  };
}

function pick<Id extends string>(options: Array<{ id: Id }>, value: unknown, fallback: Id): Id {
  return options.some((option) => option.id === value) ? (value as Id) : fallback;
}

/**
 * The CSS custom properties the reading surface reads. Keeping the mapping here
 * means the layout rules in styles.css never need to know the option ids.
 */
export function readingPrefsVars(prefs: ReadingPrefs): Record<string, string> {
  const fontScale = FONT_SCALE_OPTIONS.find((option) => option.id === prefs.fontScale)?.scale ?? 1;
  const lineHeight = LINE_HEIGHT_OPTIONS.find((option) => option.id === prefs.lineHeight)?.ratio ?? 1.8;
  const measure = MEASURE_OPTIONS.find((option) => option.id === prefs.measure)?.width ?? "760px";

  return {
    "--reader-font-scale": String(fontScale),
    "--reader-line-height": String(lineHeight),
    "--reader-measure": measure
  };
}

/** Reads the saved choice. Returns defaults during SSR, where there is no storage. */
export function loadReadingPrefs(): ReadingPrefs {
  if (typeof window === "undefined") {
    return DEFAULT_READING_PREFS;
  }

  try {
    return parseReadingPrefs(window.localStorage.getItem(READING_PREFS_STORAGE_KEY));
  } catch {
    // Private mode and blocked storage both throw here; reading should still work.
    return DEFAULT_READING_PREFS;
  }
}

export function saveReadingPrefs(prefs: ReadingPrefs): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(READING_PREFS_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // A preference that cannot be stored is not worth failing a reading session over.
  }
}
