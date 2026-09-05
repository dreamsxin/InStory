import { describe, expect, it } from "vitest";
import { extractNarration, NarrationExtractor, SseContentReader } from "@instory/ai-orchestrator";

/** Feeds a document one chunk at a time and collects the emitted deltas. */
function collectDeltas(chunks: string[]): { deltas: string[]; text: string; complete: boolean } {
  const extractor = new NarrationExtractor();
  const deltas: string[] = [];

  for (const chunk of chunks) {
    const delta = extractor.push(chunk);
    if (delta) {
      deltas.push(delta);
    }
  }

  return { deltas, text: deltas.join(""), complete: extractor.isComplete };
}

describe("extractNarration", () => {
  it("returns nothing before the key has arrived", () => {
    expect(extractNarration('{"dialog')).toEqual({ text: "", closed: false });
    expect(extractNarration('{"narration"')).toEqual({ text: "", closed: false });
  });

  it("reads a partial value and reports it as still open", () => {
    expect(extractNarration('{"narration": "你醒来时')).toEqual({ text: "你醒来时", closed: false });
  });

  it("closes on the terminating quote and ignores the rest of the document", () => {
    expect(extractNarration('{"narration":"雨声","dialogues":[]}')).toEqual({ text: "雨声", closed: true });
  });

  it("finds narration even when it is not the first key", () => {
    expect(extractNarration('{"dialogues":[],"narration":"门外有人","choices":[]}')).toEqual({
      text: "门外有人",
      closed: true
    });
  });

  it("keeps escaped quotes inside the value instead of ending early", () => {
    // The value really does terminate before `,"x":1`, so this one is closed.
    expect(extractNarration('{"narration":"他说\\"别出声\\"，然后","x":1')).toEqual({
      text: '他说"别出声"，然后',
      closed: true
    });

    // Without a terminating quote the same content is still open.
    expect(extractNarration('{"narration":"他说\\"别出声\\"，然后')).toEqual({
      text: '他说"别出声"，然后',
      closed: false
    });
  });

  it("decodes the escapes a model actually emits", () => {
    expect(extractNarration('{"narration":"第一段\\n\\n第二段\\t结尾\\\\完"}').text).toBe(
      "第一段\n\n第二段\t结尾\\完"
    );
    expect(extractNarration('{"narration":"\\u96e8\\u591c"}').text).toBe("雨夜");
  });

  it("passes through a malformed unicode escape rather than dropping text", () => {
    expect(extractNarration('{"narration":"\\uZZZZ尾"}').text).toBe("\\uZZZZ尾");
  });
});

describe("NarrationExtractor", () => {
  it("emits each chunk exactly once and never re-emits", () => {
    const { deltas, text, complete } = collectDeltas([
      '{"narration": "你醒来时，',
      "窗外正落着细雨。",
      '门外有人停下脚步。","dialogues":[]}'
    ]);

    expect(deltas).toEqual(["你醒来时，", "窗外正落着细雨。", "门外有人停下脚步。"]);
    expect(text).toBe("你醒来时，窗外正落着细雨。门外有人停下脚步。");
    expect(complete).toBe(true);
  });

  it("holds back a backslash split across chunks", () => {
    const extractor = new NarrationExtractor();

    expect(extractor.push('{"narration":"第一段')).toBe("第一段");
    // A lone trailing backslash could become either \n or a literal backslash.
    expect(extractor.push("\\")).toBe("");
    expect(extractor.push("n第二段")).toBe("\n第二段");
  });

  it("holds back a unicode escape split across chunks", () => {
    const extractor = new NarrationExtractor();

    extractor.push('{"narration":"');
    expect(extractor.push("\\u96")).toBe("");
    expect(extractor.push("e8夜")).toBe("雨夜");
  });

  it("emits nothing while only the surrounding JSON has arrived", () => {
    const extractor = new NarrationExtractor();

    expect(extractor.push('{"dialogues":[],"choices":[],')).toBe("");
    expect(extractor.isComplete).toBe(false);
    expect(extractor.push('"narration":"开场"}')).toBe("开场");
    expect(extractor.isComplete).toBe(true);
  });

  it("keeps the raw document so the final JSON can still be parsed", () => {
    const extractor = new NarrationExtractor();
    const document = '{"narration":"开场","memoryEvents":["记住了脚步声"]}';

    extractor.push(document.slice(0, 12));
    extractor.push(document.slice(12));

    expect(extractor.raw).toBe(document);
    expect(JSON.parse(extractor.raw).memoryEvents).toEqual(["记住了脚步声"]);
  });

  it("survives a character-by-character stream", () => {
    const document = '{"narration":"他说\\"走\\"，\\n然后离开。","x":1}';
    const { text, complete } = collectDeltas([...document]);

    expect(text).toBe('他说"走"，\n然后离开。');
    expect(complete).toBe(true);
  });
});

describe("SseContentReader", () => {
  it("reads content out of complete data lines", () => {
    const reader = new SseContentReader();

    const contents = reader.push(
      'data: {"choices":[{"delta":{"content":"你"}}]}\n' +
        'data: {"choices":[{"delta":{"content":"醒来"}}]}\n'
    );

    expect(contents).toEqual(["你", "醒来"]);
    expect(reader.isDone).toBe(false);
  });

  it("buffers a line split across chunks", () => {
    const reader = new SseContentReader();

    expect(reader.push('data: {"choices":[{"delta":{"cont')).toEqual([]);
    expect(reader.push('ent":"雨夜"}}]}\n')).toEqual(["雨夜"]);
  });

  it("recognises the terminator", () => {
    const reader = new SseContentReader();

    reader.push("data: [DONE]\n");

    expect(reader.isDone).toBe(true);
  });

  it("skips comments, blank lines and malformed payloads without aborting", () => {
    const reader = new SseContentReader();

    const contents = reader.push(
      ": keep-alive\n" +
        "\n" +
        "data: {not json}\n" +
        'data: {"choices":[{"delta":{}}]}\n' +
        'data: {"choices":[{"delta":{"content":"继续"}}]}\n'
    );

    expect(contents).toEqual(["继续"]);
  });

  it("flushes a trailing line that never got a newline", () => {
    const reader = new SseContentReader();

    expect(reader.push('data: {"choices":[{"delta":{"content":"尾"}}]}')).toEqual([]);
    expect(reader.flush()).toEqual(["尾"]);
  });

  it("also accepts a non-streaming message payload", () => {
    const reader = new SseContentReader();

    expect(reader.push('data: {"choices":[{"message":{"content":"整段"}}]}\n')).toEqual(["整段"]);
  });
});
