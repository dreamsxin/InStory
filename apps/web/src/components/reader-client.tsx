"use client";

import { Button, Card, CardContent, Chip, Label, TextArea, TextField } from "@heroui/react";
import type { SessionTurn, StorySession, WorldState } from "@instory/shared";
import { createTurn } from "@/lib/api";
import { BrandMark } from "@/components/brand-mark";
import { useState } from "react";

export function ReaderClient({ initialSession }: { initialSession: StorySession }) {
  const [session, setSession] = useState(initialSession);
  const [chromeVisible, setChromeVisible] = useState(true);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latestTurn = session.turns.at(-1);

  async function submit(content: string, inputType: "free_text" | "choice", choiceId?: string) {
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
    } catch (err) {
      setError(err instanceof Error ? err.message : "提交失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className={`shell reader-shell ${chromeVisible ? "" : "reader-shell-focus"}`}>
      <section className="reader reader-stage">
        <div className={`topbar reader-topbar ${chromeVisible ? "" : "reader-chrome-hidden"}`}>
          <div className="brand-row">
            <BrandMark size={40} />
            <div className="brand">
              <h1>雨夜旧宅</h1>
              <p className="muted">身份：{session.readerRole.name}</p>
            </div>
          </div>
        </div>

        <div className="reader-scroll">
          <div
            className="turns reading-surface"
            role="button"
            tabIndex={0}
            aria-label="切换阅读界面栏显示"
            onClick={() => setChromeVisible((visible) => !visible)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                setChromeVisible((visible) => !visible);
              }
            }}
          >
            {session.turns.map((turn) => (
              <TurnView key={turn.id} turn={turn} />
            ))}
          </div>
        </div>

        {latestTurn ? (
          <div className="choices">
            {latestTurn.choices.map((choice) => (
              <Button
                className="choice"
                type="button"
                key={choice.id}
                isDisabled={loading}
                variant="outline"
                onPress={() => void submit(choice.text, "choice", choice.id)}
              >
                {choice.text} <span className="muted">({choice.risk})</span>
              </Button>
            ))}
          </div>
        ) : null}

        <form
          className={`composer reader-composer ${chromeVisible ? "" : "reader-chrome-hidden"}`}
          onSubmit={(event) => {
            event.preventDefault();
            void submit(text, "free_text");
          }}
        >
          <TextField name="action" isDisabled={loading}>
            <Label>行动</Label>
            <TextArea
              value={text}
              onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => setText(event.target.value)}
              placeholder="输入你想说的话，或想做的动作..."
              rows={2}
            />
          </TextField>
          {error ? <p className="error">{error}</p> : null}
          <Button isDisabled={loading || !text.trim()} type="submit">
            {loading ? "生成中..." : "提交行动"}
          </Button>
        </form>
      </section>

      <aside className={`sidebar reader-sidebar ${chromeVisible ? "" : "reader-chrome-hidden"}`}>
        <StatePanel state={session.state} />
        <TimelinePanel session={session} />
      </aside>

      <Button className="reader-chrome-toggle" type="button" variant="outline" onPress={() => setChromeVisible((visible) => !visible)}>
        {chromeVisible ? "专注阅读" : "显示菜单"}
      </Button>
    </main>
  );
}

function TurnView({ turn }: { turn: SessionTurn }) {
  return (
    <article className="turn">
      <p>{turn.narration}</p>
      {turn.dialogues.map((dialogue) => (
        <p className="dialogue" key={`${turn.id}_${dialogue.speaker}_${dialogue.text}`}>
          <strong>{dialogue.speaker}</strong>：{dialogue.text}
        </p>
      ))}
    </article>
  );
}

function StatePanel({ state }: { state: WorldState }) {
  return (
    <Card className="panel">
      <CardContent>
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
      </CardContent>
    </Card>
  );
}

function TimelinePanel({ session }: { session: StorySession }) {
  return (
    <Card className="panel">
      <CardContent>
        <h2>记忆书签</h2>
        <div className="timeline">
          {session.timeline.map((node) => (
            <div className="timeline-item" key={node.id}>
              <strong>{node.title}</strong>
              <p className="muted">{node.summary}</p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
