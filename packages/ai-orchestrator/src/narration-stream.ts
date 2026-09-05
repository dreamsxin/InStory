import type { GenerationUsage } from "@instory/shared";

/**
 * The model returns one JSON object, so the raw stream cannot be shown to the reader
 * as-is. This extractor pulls the `narration` string out of a JSON document that is
 * still arriving, returning only the part that is certain.
 *
 * Two things make it more than a substring search:
 *
 * - A chunk can split an escape sequence (`\` or `\u12` at the end of the buffer).
 *   Emitting those raw would leak backslashes into the reader's text, so an
 *   incomplete escape is held back until the rest arrives.
 * - `narration` may not be the first key, and the value may contain `"` and `\"`,
 *   so the closing quote has to be found by honouring escapes rather than by
 *   searching for the next quote.
 */
export class NarrationExtractor {
  private buffer = "";
  private emittedLength = 0;
  private finished = false;

  /** Appends a raw chunk and returns the newly confirmed narration text. */
  push(chunk: string): string {
    this.buffer += chunk;

    const { text, closed } = extractNarration(this.buffer);
    if (closed) {
      this.finished = true;
    }

    if (text.length <= this.emittedLength) {
      return "";
    }

    const delta = text.slice(this.emittedLength);
    this.emittedLength = text.length;
    return delta;
  }

  /** The full raw document received so far, for final JSON parsing. */
  get raw(): string {
    return this.buffer;
  }

  /** The narration emitted so far. */
  get narration(): string {
    return extractNarration(this.buffer).text;
  }

  /** True once the narration string has been closed by the model. */
  get isComplete(): boolean {
    return this.finished;
  }
}

const NARRATION_KEY = /"narration"\s*:\s*"/;

export interface ExtractedNarration {
  text: string;
  closed: boolean;
}

/**
 * Decodes as much of the `narration` value as is unambiguously present.
 * Returns empty text when the key has not arrived yet.
 */
export function extractNarration(raw: string): ExtractedNarration {
  const keyMatch = NARRATION_KEY.exec(raw);
  if (!keyMatch) {
    return { text: "", closed: false };
  }

  let index = keyMatch.index + keyMatch[0].length;
  let decoded = "";

  while (index < raw.length) {
    const char = raw[index]!;

    if (char === '"') {
      return { text: decoded, closed: true };
    }

    if (char !== "\\") {
      decoded += char;
      index += 1;
      continue;
    }

    const escape = decodeEscape(raw, index);
    if (!escape) {
      // The escape sequence is still arriving; stop before it.
      return { text: decoded, closed: false };
    }

    decoded += escape.text;
    index += escape.length;
  }

  return { text: decoded, closed: false };
}

const SIMPLE_ESCAPES: Record<string, string> = {
  '"': '"',
  "\\": "\\",
  "/": "/",
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t"
};

function decodeEscape(raw: string, index: number): { text: string; length: number } | null {
  const marker = raw[index + 1];
  if (marker === undefined) {
    return null;
  }

  if (marker === "u") {
    const hex = raw.slice(index + 2, index + 6);
    if (hex.length < 4) {
      return null;
    }
    if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
      // Not a valid escape: pass it through rather than dropping reader-visible text.
      return { text: `\\u${hex}`, length: 6 };
    }
    return { text: String.fromCharCode(Number.parseInt(hex, 16)), length: 6 };
  }

  const simple = SIMPLE_ESCAPES[marker];
  if (simple !== undefined) {
    return { text: simple, length: 2 };
  }

  return { text: marker, length: 2 };
}

/**
 * Pulls `choices[0].delta.content` out of an OpenAI-compatible SSE stream.
 * Incomplete trailing lines are buffered until the rest of the line arrives.
 */
export class SseContentReader {
  private buffer = "";
  private done = false;
  private usageValue: GenerationUsage | null = null;

  push(chunk: string): string[] {
    this.buffer += chunk;

    const lines = this.buffer.split("\n");
    // The last element may be a partial line.
    this.buffer = lines.pop() ?? "";

    const contents: string[] = [];
    for (const line of lines) {
      const content = this.readLine(line);
      if (content) {
        contents.push(content);
      }
    }

    return contents;
  }

  /** Flushes any trailing line left without a newline. */
  flush(): string[] {
    const line = this.buffer;
    this.buffer = "";
    const content = line ? this.readLine(line) : null;
    return content ? [content] : [];
  }

  get isDone(): boolean {
    return this.done;
  }

  /**
   * Token accounting from the final chunk. Providers only send it when the request
   * asked for it, and some omit it entirely, so this stays null in that case.
   */
  get usage(): GenerationUsage | null {
    return this.usageValue;
  }

  private readLine(line: string): string | null {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) {
      return null;
    }

    const payload = trimmed.slice("data:".length).trim();
    if (payload === "[DONE]") {
      this.done = true;
      return null;
    }

    try {
      const parsed = JSON.parse(payload) as {
        choices?: Array<{ delta?: { content?: string }; message?: { content?: string } }>;
        usage?: unknown;
      };

      const usage = readUsage(parsed.usage);
      if (usage) {
        this.usageValue = usage;
      }

      const choice = parsed.choices?.[0];
      return choice?.delta?.content ?? choice?.message?.content ?? null;
    } catch {
      // A malformed line should not abort a long generation.
      return null;
    }
  }
}

/** Normalises the snake_case token fields providers report. */
export function readUsage(value: unknown): GenerationUsage | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const promptTokens = toCount(record.prompt_tokens ?? record.promptTokens);
  const completionTokens = toCount(record.completion_tokens ?? record.completionTokens);
  const totalTokens = toCount(record.total_tokens ?? record.totalTokens);

  if (promptTokens === null && completionTokens === null && totalTokens === null) {
    return null;
  }

  const prompt = promptTokens ?? 0;
  const completion = completionTokens ?? 0;

  return {
    promptTokens: prompt,
    completionTokens: completion,
    totalTokens: totalTokens ?? prompt + completion
  };
}

function toCount(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}
