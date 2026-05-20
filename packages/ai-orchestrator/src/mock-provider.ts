import type { NarrativeResult } from "@instory/shared";
import type { GenerateNarrativeInput, LLMProvider } from "./provider.js";

export class MockNarrativeProvider implements LLMProvider {
  async generateNarrative(input: GenerateNarrativeInput): Promise<NarrativeResult> {
    const turn = input.session.state.turnCount + 1;
    const clue = turn === 1 ? "门外来客知道你的名字" : `第 ${turn} 回合留下的异常细节`;

    return {
      narration: `你刚做出决定，屋外的雨声忽然压低了一瞬。${input.userInput} 这句话像一枚石子落进黑暗，屏风后传来极轻的呼吸声。陆清河抬手示意你别动，目光却越过你，看向那扇没有关严的门。`,
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
      memoryEvents: [`第 ${turn} 回合，玩家选择「${input.userInput}」，并获得线索：${clue}。`]
    };
  }
}
