/**
 * The reading surface's sound cues. Three deliberate choices sit behind this file:
 *
 * - **Synthesised, not sampled.** A handful of short tones from the Web Audio API
 *   ship as code, so the repo grows by no binary assets and nothing has to be
 *   downloaded before a passage can be read. It also means no cue can be a bad
 *   recording of the wrong thing.
 * - **Only after the reader's own click.** Every cue is triggered by something they
 *   pressed, which is also what browsers require before audio may start. Nothing
 *   plays on arrival, and nothing loops.
 * - **Off until asked for.** Sound in a reading app is an interruption until the
 *   reader says otherwise - a page opened in a quiet room should stay quiet - so the
 *   preference starts at "off" and the reader turns it on from the tool dock.
 *
 * The recipes are plain data so they can be checked without a speaker: a test can
 * assert nothing is inaudible, harsh or longer than a beat.
 */
export type SoundCueId = "passage" | "beat" | "question" | "crisis";

export interface ToneStep {
  /** Hz. Kept inside the range a phone speaker can actually reproduce. */
  frequency: number;
  /** Seconds after the cue starts. */
  startAt: number;
  /** Seconds. */
  duration: number;
  /** Peak gain, 0-1. Low on purpose: this plays over someone's reading. */
  peak: number;
  type: OscillatorType;
}

/**
 * What each cue is for:
 *
 * - `passage`: a new passage arrived. The quietest of the four, because it is the one
 *   that plays most often.
 * - `beat`: the passage stopped at a key node - a clue, a turn, a change in someone's
 *   feeling towards the reader. Two rising notes, the sound of something noticed.
 * - `question`: an actor asked the reader something. Rising, so it reads as a question
 *   rather than an announcement.
 * - `crisis`: the passage stopped at something closing in. Falling and lower.
 */
export const SOUND_CUES: Record<SoundCueId, ToneStep[]> = {
  passage: [{ frequency: 196, startAt: 0, duration: 0.16, peak: 0.045, type: "triangle" }],
  beat: [
    { frequency: 659, startAt: 0, duration: 0.18, peak: 0.06, type: "sine" },
    { frequency: 880, startAt: 0.12, duration: 0.22, peak: 0.05, type: "sine" }
  ],
  question: [
    { frequency: 523, startAt: 0, duration: 0.16, peak: 0.06, type: "sine" },
    { frequency: 698, startAt: 0.11, duration: 0.2, peak: 0.055, type: "sine" }
  ],
  crisis: [
    { frequency: 262, startAt: 0, duration: 0.2, peak: 0.07, type: "triangle" },
    { frequency: 156, startAt: 0.14, duration: 0.28, peak: 0.06, type: "triangle" }
  ]
};

/**
 * Which cue a finished passage deserves. One sound per passage, never two: when a
 * passage stops at a key node, that is the more specific thing to say, so the plain
 * page-turn gives way to it.
 */
export function cueForPassage(interventionKind: string | null | undefined): SoundCueId {
  if (!interventionKind) {
    return "passage";
  }

  if (interventionKind === "npc_question") {
    return "question";
  }

  return interventionKind === "crisis" ? "crisis" : "beat";
}

/** One context per page. Created on the first cue, which is always after a click. */
let audioContext: AudioContext | null = null;

function resolveContext(): AudioContext | null {
  if (typeof window === "undefined") {
    return null;
  }

  if (audioContext) {
    return audioContext;
  }

  // Not every browser and not every embedded webview has it, and some throw on
  // construction rather than reporting absence. A reader without audio still reads.
  const Constructor =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Constructor) {
    return null;
  }

  try {
    audioContext = new Constructor();
    return audioContext;
  } catch {
    return null;
  }
}

/**
 * Plays one cue. Silently does nothing when there is no audio to be had - a missing
 * speaker, a blocked context, a browser without Web Audio - because a failed sound is
 * not worth an error in front of someone who is reading.
 */
export function playSoundCue(cue: SoundCueId): void {
  const context = resolveContext();
  if (!context) {
    return;
  }

  try {
    // Autoplay policy parks a context created before the first gesture; the click that
    // reached this line is that gesture.
    if (context.state === "suspended") {
      void context.resume();
    }

    const startedAt = context.currentTime;
    for (const step of SOUND_CUES[cue]) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = step.type;
      oscillator.frequency.value = step.frequency;

      // Ramped, not switched: a square-edged start and stop is heard as a click.
      const start = startedAt + step.startAt;
      const end = start + step.duration;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(step.peak, start + Math.min(0.03, step.duration / 3));
      gain.gain.exponentialRampToValueAtTime(0.0001, end);

      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(start);
      oscillator.stop(end + 0.02);
    }
  } catch {
    // Same reason as above.
  }
}
