import type { NarrativeResult } from "@instory/shared";
import type { GenerateNarrativeInput, LLMProvider } from "./provider.js";

export class MockNarrativeProvider implements LLMProvider {
  async generateNarrative(input: GenerateNarrativeInput): Promise<NarrativeResult> {
    const turn = input.session.state.turnCount + 1;
    const latestChoice = input.session.turns.at(-1)?.choices[0]?.text ?? "顺着当前线索继续观察";
    const isReadSegment = input.intent === "read_segment";
    const clue = turn === 1 ? "门外来客知道你的名字" : `第 ${turn} 回合留下的异常细节`;
    const narration = isReadSegment
      ? buildReadSegmentNarration({
          latestChoice,
          paragraphs: input.lengthGuide?.paragraphs ?? 6,
          turn
        })
      : `你刚做出决定，屋外的雨声忽然压低了一瞬。${input.userInput} 这句话像一枚石子落进黑暗，屏风后传来极轻的呼吸声。陆清河抬手示意你别动，目光却越过你，看向那扇没有关严的门。`;

    return {
      narration,
      dialogues: [
        {
          speaker: "陆清河",
          text: turn === 1 ? "别出声。外面的人不是来问路的。" : "你已经让局面变了，接下来每句话都要算数。"
        }
      ],
      choices: [
        {
          id: `t${turn}_c1`,
          text: "压低声音追问陆清河真相",
          risk: "medium"
        },
        {
          id: `t${turn}_c2`,
          text: "藏到屏风后观察门外动静",
          risk: "low"
        },
        {
          id: `t${turn}_c3`,
          text: "主动开门打断对方节奏",
          risk: "high"
        }
      ],
      stateDelta: {
        emotion: {
          fear: Math.min(10, 2 + turn),
          alertness: Math.min(10, 4 + turn)
        },
        relations: {
          lu_qinghe: turn
        },
        cluesAdded: [clue],
        flags: {
          heard_footsteps: true
        }
      },
      memoryEvents: [
        isReadSegment
          ? `第 ${turn} 回合，故事按上一幕线索自然推进，并获得线索：${clue}。`
          : `第 ${turn} 回合，玩家选择「${input.userInput}」，并获得线索：${clue}。`
      ]
    };
  }
}

function buildReadSegmentNarration({
  latestChoice,
  paragraphs,
  turn
}: {
  latestChoice: string;
  paragraphs: number;
  turn: number;
}): string {
  const sections = [
    `雨声顺着窗缝渗进屋内，旧宅的黑暗像被慢慢翻开的一页。你没有急着发问，只沿着上一幕留下的线索继续往前。${latestChoice} 这件事在心里沉下去时，房梁上的水珠正一滴一滴落在木盆里，声音轻得像有人在暗处计数。`,
    "你扶着屏风边缘站起，潮湿的木纹硌着掌心。门外的脚步并没有远去，而是在廊下短暂停住，随后又刻意压低。那不是一个路过的人会有的迟疑，更像有人已经知道你醒着，只是在等你先露出破绽。",
    "陆清河把油灯往身侧挪了半寸，灯影遮住他的眼睛。他没有催你，也没有解释，只用指节轻轻叩了叩桌面。旧宅里所有声音都像被雨水包住了，远处正厅传来一声门闩落下的闷响，封门的规矩在这一刻变得具体起来。",
    "你注意到桌角压着一小片湿纸，纸边被雨水泡得发白，上面只剩半个墨字。陆清河的视线掠过那片纸时停得太短，短到几乎像没有看见。可正是这一下回避，让那片纸比屋内任何摆设都更像线索。",
    "廊下忽然有人低声唤了一句“管事”。陆清河的肩背绷紧，随即恢复平静。他回头看你，声音压得很低：今晚你若还想活着等到天亮，就不要轻易相信任何解释。话音落下时，门缝外的影子已经贴近。",
    `你还没来得及追问，正厅方向传来瓷器碎裂的声音。第 ${turn} 回合的局面被推向更深处：有人在阻止你查下去，也有人比你更急着找到那件被藏起来的东西。`
  ];

  return sections.slice(0, Math.max(1, paragraphs)).join("\n\n");
}
