import { describe, expect, it } from "vitest";
import { cueForPassage, SOUND_CUES, type SoundCueId } from "./reading-sounds";

const CUE_IDS: SoundCueId[] = ["passage", "beat", "question", "crisis"];

describe("SOUND_CUES", () => {
  it("has a recipe for every cue the reader can trigger", () => {
    expect(Object.keys(SOUND_CUES).sort()).toEqual([...CUE_IDS].sort());
  });

  /**
   * The reason the recipes are plain data: a cue can be judged without a speaker.
   * These bounds are what "short, quiet, audible" means numerically - outside them a
   * tone is either inaudible on a phone, loud enough to startle someone reading, or
   * long enough to become a noise they wait out.
   */
  it("keeps every tone short, quiet and inside what a phone speaker reproduces", () => {
    for (const [cue, steps] of Object.entries(SOUND_CUES)) {
      expect(steps.length, cue).toBeGreaterThan(0);

      for (const step of steps) {
        expect(step.frequency, cue).toBeGreaterThanOrEqual(120);
        expect(step.frequency, cue).toBeLessThanOrEqual(2000);
        expect(step.duration, cue).toBeGreaterThan(0);
        expect(step.duration, cue).toBeLessThanOrEqual(0.4);
        expect(step.peak, cue).toBeGreaterThan(0);
        expect(step.peak, cue).toBeLessThanOrEqual(0.1);
      }

      // Nothing overlaps into a chord, and no cue outlasts the moment it belongs to.
      const end = Math.max(...steps.map((step) => step.startAt + step.duration));
      expect(end, cue).toBeLessThanOrEqual(0.6);
    }
  });

  it("makes the page-turn the quietest cue, because it plays most often", () => {
    const loudest = (cue: SoundCueId) => Math.max(...SOUND_CUES[cue].map((step) => step.peak));

    for (const cue of CUE_IDS.filter((id) => id !== "passage")) {
      expect(loudest("passage"), cue).toBeLessThanOrEqual(loudest(cue));
    }
  });
});

describe("cueForPassage", () => {
  it("uses the page-turn when the passage stopped at nothing in particular", () => {
    expect(cueForPassage(null)).toBe("passage");
    expect(cueForPassage(undefined)).toBe("passage");
  });

  it("says the specific thing when there is one, instead of the page-turn", () => {
    expect(cueForPassage("npc_question")).toBe("question");
    expect(cueForPassage("crisis")).toBe("crisis");
  });

  it("falls back to one key-node cue for the kinds without their own sound", () => {
    // Four kinds share it on purpose: six distinguishable cues would be a language the
    // reader has to learn, and 线索/转折/关系变化/分歧 all mean "something happened here".
    for (const kind of ["clue_found", "fork", "relationship_shift", "turning_point"]) {
      expect(cueForPassage(kind)).toBe("beat");
    }
  });
});
