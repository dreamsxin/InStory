import { describe, expect, it } from "vitest";
import {
  DEFAULT_READING_PREFS,
  FONT_SCALE_OPTIONS,
  parseReadingPrefs,
  readingPrefsVars
} from "./reading-prefs";

describe("parseReadingPrefs", () => {
  it("falls back to defaults when nothing is stored", () => {
    expect(parseReadingPrefs(null)).toEqual(DEFAULT_READING_PREFS);
  });

  it("survives a corrupt value instead of throwing", () => {
    expect(parseReadingPrefs("{not json")).toEqual(DEFAULT_READING_PREFS);
    expect(parseReadingPrefs("\"medium\"")).toEqual(DEFAULT_READING_PREFS);
    expect(parseReadingPrefs("null")).toEqual(DEFAULT_READING_PREFS);
  });

  it("keeps the fields it recognises and defaults only the rest", () => {
    const prefs = parseReadingPrefs(JSON.stringify({ fontScale: "large", lineHeight: "enormous" }));

    expect(prefs).toEqual({
      fontScale: "large",
      lineHeight: DEFAULT_READING_PREFS.lineHeight,
      measure: DEFAULT_READING_PREFS.measure,
      sound: DEFAULT_READING_PREFS.sound
    });
  });

  it("leaves sound off unless it was really turned on", () => {
    // A choice stored before sound existed, and a hand-edited nonsense value, both mean
    // "nobody asked for sound here".
    expect(parseReadingPrefs(JSON.stringify({ fontScale: "large" })).sound).toBe("off");
    expect(parseReadingPrefs(JSON.stringify({ sound: "loud" })).sound).toBe("off");
    expect(parseReadingPrefs(JSON.stringify({ sound: true })).sound).toBe("off");
    expect(parseReadingPrefs(JSON.stringify({ sound: "on" })).sound).toBe("on");
  });

  it("rejects raw numbers, so an old format cannot produce unreadable type", () => {
    expect(parseReadingPrefs(JSON.stringify({ fontScale: 0.02 })).fontScale).toBe(
      DEFAULT_READING_PREFS.fontScale
    );
  });
});

describe("readingPrefsVars", () => {
  it("maps a choice onto the custom properties the surface reads", () => {
    const vars = readingPrefsVars({ fontScale: "xlarge", lineHeight: "loose", measure: "narrow", sound: "on" });

    expect(vars).toEqual({
      "--reader-font-scale": "1.3",
      "--reader-line-height": "2.05",
      "--reader-measure": "600px"
    });
  });

  it("keeps every font scale above the size a page becomes unreadable at", () => {
    for (const option of FONT_SCALE_OPTIONS) {
      expect(option.scale).toBeGreaterThanOrEqual(0.9);
      expect(option.scale).toBeLessThanOrEqual(1.5);
    }
  });
});
