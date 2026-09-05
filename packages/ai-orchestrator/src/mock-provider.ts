import type { CharacterProfile, GenerationUsage, NarrativeResult, StoryDetail } from "@instory/shared";
import type {
  GenerateNarrativeInput,
  LLMProvider,
  NarrativeGeneration,
  NarrativeStreamEvent
} from "./provider.js";

/**
 * Deterministic offline provider used for local development and tests. It derives
 * every name, location and clue from the story that is actually being played, so a
 * newly authored story never reads back the seed story's content.
 */
export class MockNarrativeProvider implements LLMProvider {
  /**
   * Pause between streamed pieces. Zero by default so unit tests stay fast, but a
   * real model takes seconds, and with no pause at all the reader's in-progress
   * state exists for less than a frame - which makes it untestable and hides
   * regressions in the streaming UI.
   */
  private readonly chunkDelayMs: number;

  constructor(options: { chunkDelayMs?: number } = {}) {
    this.chunkDelayMs = Math.max(0, options.chunkDelayMs ?? 0);
  }

  async generateNarrative(input: GenerateNarrativeInput): Promise<NarrativeGeneration> {
    const result = this.buildResult(input);
    return { result, usage: estimateUsage(input, result) };
  }

  /**
   * Replays the generated narration in small pieces so the reader UI can be
   * exercised end to end without a real model.
   */
  async *streamNarrative(input: GenerateNarrativeInput): AsyncGenerator<NarrativeStreamEvent> {
    const result = this.buildResult(input);

    for (const piece of chunkText(result.narration, 24)) {
      if (this.chunkDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, this.chunkDelayMs));
      }
      yield { type: "narration_delta", text: piece };
    }

    yield { type: "complete", result, usage: estimateUsage(input, result) };
  }

  private buildResult(input: GenerateNarrativeInput): NarrativeResult {
    const turn = input.session.state.turnCount + 1;
    const stage = describeStage(input.story, turn);
    const host = pickHost(input.story, input.session.readerRole.characterId);
    const hostName = host?.name ?? "同行者";
    const location = input.session.state.location;
    const clue = `${stage}中留下的异常细节`;
    const isReadSegment = input.intent === "read_segment";

    const narration = isReadSegment
      ? buildSegment({
          location,
          hostName,
          stage,
          latestChoice: input.session.turns.at(-1)?.choices[0]?.text ?? "顺着当前线索继续观察",
          paragraphs: input.lengthGuide?.paragraphs ?? 6
        })
      : `你刚做出决定，${location}的空气忽然静了一瞬。${input.userInput} 这句话像一枚石子落进黑暗，${hostName}抬手示意你别动，目光却越过你，看向更远的地方。`;

    return {
      narration,
      dialogues: [
        {
          speaker: hostName,
          text: turn === 1 ? "别出声。这里的规矩不是给外人定的。" : "你已经让局面变了，接下来每句话都要算数。"
        }
      ],
      choices: [
        {
          id: `t${turn}_c1`,
          text: `压低声音向${hostName}追问真相`,
          risk: "medium"
        },
        {
          id: `t${turn}_c2`,
          text: `留在${location}观察动静`,
          risk: "low"
        },
        {
          id: `t${turn}_c3`,
          text: "主动开口打断对方节奏",
          risk: "high"
        }
      ],
      stateDelta: {
        emotion: {
          fear: Math.min(10, 2 + turn),
          alertness: Math.min(10, 4 + turn)
        },
        relations: host ? { [host.id]: turn } : {},
        cluesAdded: [clue],
        flags: {
          heard_footsteps: true
        }
      },
      memoryEvents: [
        isReadSegment
          ? `${stage}，故事按上一幕线索自然推进，并获得线索：${clue}。`
          : `${stage}，玩家选择「${input.userInput}」，并获得线索：${clue}。`
      ]
    };
  }
}

function chunkText(text: string, size: number): string[] {
  const chunks: string[] = [];
  for (let index = 0; index < text.length; index += size) {
    chunks.push(text.slice(index, index + size));
  }
  return chunks;
}

/**
 * Plausible token counts so quota and cost reporting can be exercised without a real
 * model. Roughly one token per 1.6 characters, which is in the right range for
 * Chinese text; it is an estimate, not a billing figure.
 */
function estimateUsage(input: GenerateNarrativeInput, result: NarrativeResult): GenerationUsage {
  const promptChars =
    JSON.stringify(input.story ?? {}).length + JSON.stringify(input.session.turns.slice(-6)).length + input.userInput.length;
  const completionChars = JSON.stringify(result).length;

  const promptTokens = Math.ceil(promptChars / 1.6);
  const completionTokens = Math.ceil(completionChars / 1.6);

  return {
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens
  };
}

/** Prefers a cast member other than the one the reader is playing. */
function pickHost(story: StoryDetail | undefined, readerCharacterId?: string): CharacterProfile | null {
  const cast = story?.characters ?? [];
  return cast.find((character) => character.id !== readerCharacterId) ?? cast[0] ?? null;
}

/** Uses the story's own anchors as act labels when available. */
function describeStage(story: StoryDetail | undefined, turn: number): string {
  const anchors = story?.anchors ?? [];
  const anchor = anchors[(turn - 1) % Math.max(1, anchors.length)];
  return anchor ? `第 ${turn} 回合（${anchor.title}）` : `第 ${turn} 回合`;
}

function buildSegment({
  location,
  hostName,
  stage,
  latestChoice,
  paragraphs
}: {
  location: string;
  hostName: string;
  stage: string;
  latestChoice: string;
  paragraphs: number;
}): string {
  const sections = [
    `${location}的光线暗下来，四周像被慢慢翻开的一页。你没有急着发问，只沿着上一幕留下的线索继续往前。${latestChoice} 这件事在心里沉下去时，远处有极轻的声响，轻得像有人在暗处计数。`,
    `你扶着最近的墙面站起，掌心触到的纹理提醒你这里并不属于你。脚步声并没有远去，而是在不远处短暂停住，随后又刻意压低。那不是路过的人会有的迟疑，更像有人已经知道你醒着，只是在等你先露出破绽。`,
    `${hostName}把光源往身侧挪了半寸，影子遮住他的眼睛。他没有催你，也没有解释，只用指节轻轻叩了叩身边的硬物。${location}里所有声音都被压得很薄，某处传来一声闷响，规矩在这一刻变得具体起来。`,
    `你注意到角落压着一件被忽略的东西，边缘已经被时间磨白，上面只剩半个字迹。${hostName}的视线掠过它时停得太短，短到几乎像没有看见。可正是这一下回避，让它比周围任何摆设都更像线索。`,
    `不远处忽然有人低声唤了一句称谓。${hostName}的肩背绷紧，随即恢复平静。他回头看你，声音压得很低：今晚你若还想安稳到天亮，就不要轻易相信任何解释。话音落下时，那道影子已经贴近。`,
    `你还没来得及追问，另一侧传来器物碎裂的声音。${stage}的局面被推向更深处：有人在阻止你查下去，也有人比你更急着找到那件被藏起来的东西。`
  ];

  return sections.slice(0, Math.max(1, paragraphs)).join("\n\n");
}
