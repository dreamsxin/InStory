"use client";

import type { SessionTurn, StorySession, WorldState } from "@instory/shared";
import { createTurn } from "@/lib/api";
import { useState } from "react";

export function ReaderClient({ initialSession }: { initialSession: StorySession }) {
  const [session, setSession] = useState(initialSession);
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
    <main className="shell">
      <section className="reader">
        <div className="topbar">
          <div className="brand">
            <h1>雨夜旧宅</h1>
            <p className="muted">身份：{session.readerRole.name}</p>
          </div>
        </div>

        <div className="turns">
          {session.turns.map((turn) => (
            <TurnView key={turn.id} turn={turn} />
          ))}
        </div>

        {latestTurn ? (
          <div className="choices">
            {latestTurn.choices.map((choice) => (
              <button
                className="choice"
                type="button"
                key={choice.id}
                disabled={loading}
                onClick={() => void submit(choice.text, "choice", choice.id)}
              >
                {choice.text} <span className="muted">({choice.risk})</span>
              </button>
            ))}
          </div>
        ) : null}

        <form
          className="composer"
          onSubmit={(event) => {
            event.preventDefault();
            void submit(text, "free_text");
          }}
        >
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="输入你想说的话，或想做的动作..."
            disabled={loading}
          />
          {error ? <p className="error">{error}</p> : null}
          <button className="primary" type="submit" disabled={loading || !text.trim()}>
            {loading ? "生成中..." : "提交行动"}
          </button>
        </form>
      </section>

      <aside className="sidebar">
        <StatePanel state={session.state} />
        <TimelinePanel session={session} />
      </aside>
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
    <section className="panel">
      <h2>状态</h2>
      <ul className="stat-list">
        <li>场景：{state.scene}</li>
        <li>位置：{state.location}</li>
        <li>回合：{state.turnCount}</li>
      </ul>
      <h3>情绪</h3>
      <div className="tag-row">
        {Object.entries(state.emotion).map(([key, value]) => (
          <span className="tag" key={key}>
            {key}: {value}
          </span>
        ))}
      </div>
      <h3>线索</h3>
      <div className="tag-row">
        {state.clues.length ? state.clues.map((clue) => <span className="tag" key={clue}>{clue}</span>) : <span className="muted">暂无</span>}
      </div>
    </section>
  );
}

function TimelinePanel({ session }: { session: StorySession }) {
  return (
    <section className="panel">
      <h2>记忆书签</h2>
      <div className="timeline">
        {session.timeline.map((node) => (
          <div className="timeline-item" key={node.id}>
            <strong>{node.title}</strong>
            <p className="muted">{node.summary}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
