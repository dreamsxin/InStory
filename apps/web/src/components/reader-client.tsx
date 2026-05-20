"use client";

import { Button, Card, Chip, Label, TextArea, TextField } from "@heroui/react";
import type { SessionTurn, StorySession, WorldState } from "@instory/shared";
import { createTurn } from "@/lib/api";
import { BrandMark } from "@/components/brand-mark";
import { useState } from "react";

type ReaderPanel = "status" | "memory" | "action" | null;

export function ReaderClient({ initialSession }: { initialSession: StorySession }) {
  const [session, setSession] = useState(initialSession);
  const [activePanel, setActivePanel] = useState<ReaderPanel>(null);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latestTurn = session.turns.at(-1);

  async function submit(content: string, inputType: "free_text" | "choice" | "read_continue", choiceId?: string) {
    if (!content.trim()) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await createTurn({
        sessionId: session.id,
        content,
        inputType,
        choiceId
      });

      setSession((current) => ({
        ...current,
        state: response.state,
        turns: [...current.turns, response.turn],
        timeline: response.timelineNode ? [...current.timeline, response.timelineNode] : current.timeline,
        updatedAt: new Date().toISOString()
      }));
      setText("");
      setActivePanel(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "提交失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="reader-shell reader-shell-focus h-dvh w-full overflow-hidden">
      <section className="reader reader-stage h-dvh w-full min-w-0 p-0 sm:p-4 md:p-8">
        <div className="topbar reader-topbar reader-chrome-hidden">
          <div className="brand-row">
            <BrandMark size={40} />
            <div className="brand">
              <h1>雨夜旧宅</h1>
              <p className="muted">身份：{session.readerRole.name}</p>
            </div>
          </div>
        </div>

        <div className="reader-scroll w-full min-w-0 flex-1 overflow-x-hidden overflow-y-auto">
          <div className="turns reading-surface w-full min-w-0 sm:max-w-[760px]">
            {session.turns.map((turn) => (
              <TurnView key={turn.id} turn={turn} />
            ))}
          </div>
        </div>

        {latestTurn ? (
          <div className="reading-intervention-bar w-full sm:w-auto sm:min-w-[360px] md:min-w-96">
            <Button
              className="continue-reading-button w-full min-w-0 sm:w-auto md:min-w-48"
              isDisabled={loading}
              onPress={() => void submit("阅读推进", "read_continue")}
            >
              {loading ? "生成中..." : "继续阅读"}
            </Button>
            <Button
              className="w-full min-w-0 sm:w-auto md:min-w-36"
              isDisabled={loading}
              variant="outline"
              onPress={() => setActivePanel((panel) => (panel === "action" ? null : "action"))}
            >
              入戏行动
            </Button>
          </div>
        ) : null}
      </section>

      <nav className="reader-tool-dock w-full sm:w-auto" aria-label="阅读工具">
        <Button className="w-full min-w-0 sm:w-auto" size="sm" variant={activePanel === "status" ? "secondary" : "outline"} onPress={() => setActivePanel((panel) => (panel === "status" ? null : "status"))}>
          状态
        </Button>
        <Button className="w-full min-w-0 sm:w-auto" size="sm" variant={activePanel === "memory" ? "secondary" : "outline"} onPress={() => setActivePanel((panel) => (panel === "memory" ? null : "memory"))}>
          记忆
        </Button>
        <Button className="w-full min-w-0 sm:w-auto" size="sm" variant={activePanel === "action" ? "secondary" : "outline"} onPress={() => setActivePanel((panel) => (panel === "action" ? null : "action"))}>
          行动
        </Button>
      </nav>

      {activePanel ? (
        <aside className="reader-context-panel w-full sm:w-[360px]" aria-label="阅读辅助面板">
          <div className="reader-context-panel-header">
            <strong>{panelTitle(activePanel)}</strong>
            <Button size="sm" variant="ghost" onPress={() => setActivePanel(null)}>关闭</Button>
          </div>
          {activePanel === "status" ? <StatePanel state={session.state} /> : null}
          {activePanel === "memory" ? <TimelinePanel session={session} /> : null}
          {activePanel === "action" && latestTurn ? (
            <ActionPanel
              error={error}
              latestTurn={latestTurn}
              loading={loading}
              text={text}
              onChoice={(choiceText, choiceId) => void submit(choiceText, "choice", choiceId)}
              onSubmitText={() => void submit(text, "free_text")}
              onTextChange={setText}
            />
          ) : null}
        </aside>
      ) : null}
    </main>
  );
}

function panelTitle(panel: Exclude<ReaderPanel, null>) {
  return panel === "status" ? "当前状态" : panel === "memory" ? "记忆书签" : "入戏行动";
}

function TurnView({ turn }: { turn: SessionTurn }) {
  return (
    <article className="turn w-full min-w-0">
      <p className="reader-paragraph">{turn.narration}</p>
      {turn.dialogues.map((dialogue) => (
        <p className="reader-paragraph dialogue" key={`${turn.id}_${dialogue.speaker}_${dialogue.text}`}>
          <strong>{dialogue.speaker}</strong>：{dialogue.text}
        </p>
      ))}
    </article>
  );
}

function StatePanel({ state }: { state: WorldState }) {
  return (
    <Card className="panel">
      <Card.Content>
        <h2>状态</h2>
        <ul className="stat-list">
          <li>场景：{state.scene}</li>
          <li>位置：{state.location}</li>
          <li>回合：{state.turnCount}</li>
        </ul>
        <h3>情绪</h3>
        <div className="tag-row">
          {Object.entries(state.emotion).map(([key, value]) => (
            <Chip key={key} size="sm" variant="soft">
              {key}: {value}
            </Chip>
          ))}
        </div>
        <h3>线索</h3>
        <div className="tag-row">
          {state.clues.length ? state.clues.map((clue) => <Chip key={clue} size="sm" variant="soft">{clue}</Chip>) : <span className="muted">暂无</span>}
        </div>
      </Card.Content>
    </Card>
  );
}

function TimelinePanel({ session }: { session: StorySession }) {
  return (
    <Card className="panel">
      <Card.Content>
        <h2>记忆书签</h2>
        <div className="timeline">
          {session.timeline.map((node) => (
            <div className="timeline-item" key={node.id}>
              <strong>{node.title}</strong>
              <p className="muted">{node.summary}</p>
            </div>
          ))}
        </div>
      </Card.Content>
    </Card>
  );
}

function ActionPanel({
  error,
  latestTurn,
  loading,
  onChoice,
  onSubmitText,
  onTextChange,
  text
}: {
  error: string | null;
  latestTurn: SessionTurn;
  loading: boolean;
  onChoice: (choiceText: string, choiceId: string) => void;
  onSubmitText: () => void;
  onTextChange: (value: string) => void;
  text: string;
}) {
  return (
    <Card className="panel action-panel">
      <Card.Content>
        <h2>介入建议</h2>
        <div className="choices">
          {latestTurn.choices.map((choice) => (
            <Button
              className="choice"
              isDisabled={loading}
              key={choice.id}
              type="button"
              variant="outline"
              onPress={() => onChoice(choice.text, choice.id)}
            >
              {choice.text} <span className="muted">({choice.risk})</span>
            </Button>
          ))}
        </div>
        <form
          className="composer reader-composer"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmitText();
          }}
        >
          <TextField className="reader-action-field" isDisabled={loading}>
            <Label>自由行动</Label>
            <TextArea
              className="reader-action-textarea"
              name="action"
              value={text}
              onChange={(event) => onTextChange(event.target.value)}
              placeholder="输入你想说的话，或想做的动作..."
              rows={3}
            />
          </TextField>
          {error ? <p className="error">{error}</p> : null}
          <Button type="submit" isDisabled={loading || !text.trim()}>
            {loading ? "生成中..." : "提交行动"}
          </Button>
        </form>
      </Card.Content>
    </Card>
  );
}
