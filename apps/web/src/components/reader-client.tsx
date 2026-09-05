"use client";

import { Button, Card, Chip, Label, TextArea, TextField } from "@heroui/react";
import type { SessionTurn, StorySession, TurnQuota, WorldState } from "@instory/shared";
import {
  createTurn,
  QuotaExceededError,
  RateLimitedError,
  resetSession,
  rewindSession,
  streamTurn,
  UnauthenticatedError
} from "@/lib/api";
import { BrandMark } from "@/components/brand-mark";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type ReaderPanel = "status" | "memory" | "action" | null;

export function ReaderClient({ initialSession }: { initialSession: StorySession }) {
  const router = useRouter();
  const [session, setSession] = useState(initialSession);
  const [activePanel, setActivePanel] = useState<ReaderPanel>(null);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [streamingNarration, setStreamingNarration] = useState("");
  const [quota, setQuota] = useState<TurnQuota | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const latestTurn = session.turns.at(-1);

  // Follow the text while it is being written; text appearing below the fold is
  // text the reader never sees.
  useEffect(() => {
    const container = scrollRef.current;
    if (!container || !loading) {
      return;
    }
    container.scrollTop = container.scrollHeight;
  }, [streamingNarration, loading]);

  function stopGeneration() {
    abortRef.current?.abort();
  }

  async function submit(content: string, inputType: "free_text" | "choice" | "read_continue", choiceId?: string) {
    if (!content.trim()) {
      return;
    }

    setLoading(true);
    setError(null);
    setStreamingNarration("");

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      // Streaming is preferred so the reader sees text as it is written; the plain
      // endpoint stays as the fallback when the provider or transport cannot stream.
      let response;
      try {
        response = await streamTurn(
          { sessionId: session.id, content, inputType, choiceId, signal: controller.signal },
          (delta) => setStreamingNarration((current) => current + delta)
        );
      } catch (streamError) {
        if (
          streamError instanceof UnauthenticatedError ||
          streamError instanceof QuotaExceededError ||
          // The plain endpoint shares the same budget, so retrying it would just
          // spend another rejected request.
          streamError instanceof RateLimitedError ||
          controller.signal.aborted
        ) {
          throw streamError;
        }
        setStreamingNarration("");
        response = await createTurn({
          sessionId: session.id,
          content,
          inputType,
          choiceId
        });
      }

      setSession((current) => ({
        ...current,
        state: response.state,
        turns: [...current.turns, response.turn],
        timeline: response.timelineNode ? [...current.timeline, response.timelineNode] : current.timeline,
        updatedAt: new Date().toISOString()
      }));
      setQuota(response.quota);
      setText("");
      setActivePanel(null);
    } catch (err) {
      if (controller.signal.aborted) {
        setError("已停止这次生成。");
      } else if (err instanceof RateLimitedError) {
        // Recoverable on its own, so tell the reader how long rather than just failing.
        setError(`${err.message}（约 ${err.retryAfterSeconds} 秒后可再试）`);
      } else {
        setError(err instanceof Error ? err.message : "提交失败");
      }
    } finally {
      abortRef.current = null;
      setStreamingNarration("");
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
          {quota ? (
            <Chip className="quota-chip" aria-label={`今日剩余推进 ${quota.remainingTurnsToday} 次`}>
              今日剩余 {quota.remainingTurnsToday}/{quota.dailyLimit}
            </Chip>
          ) : null}
        </div>

        <div
          className="reader-scroll w-full min-w-0 flex-1 overflow-x-hidden overflow-y-auto"
          ref={scrollRef}
        >
          <div className="turns reading-surface w-full min-w-0 sm:max-w-[760px]">
            {session.turns.map((turn) => (
              <TurnView key={turn.id} turn={turn} />
            ))}
            {loading ? (
              <StreamingTurnView narration={streamingNarration} onStop={stopGeneration} />
            ) : null}
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
          {activePanel === "memory" ? (
            <TimelinePanel
              loading={loading}
              session={session}
              onReset={() => void resetCurrentSession()}
              onRewind={(timelineNodeId) => void rewindToNode(timelineNodeId)}
            />
          ) : null}
          {activePanel === "action" && latestTurn ? (
            <ActionPanel
              error={error}
              latestTurn={latestTurn}
              loading={loading}
              text={text}
              onChoice={(choiceText, choiceId) => void submit(choiceText, "choice", choiceId)}
              onPresetAction={(content) => void submit(content, "free_text")}
              onSubmitText={() => void submit(text, "free_text")}
              onTextChange={setText}
            />
          ) : null}
        </aside>
      ) : null}
    </main>
  );

  async function rewindToNode(timelineNodeId: string) {
    setLoading(true);
    setError(null);

    try {
      const branch = await rewindSession(session.id, timelineNodeId);
      router.push(`/story/${branch.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "回退失败");
    } finally {
      setLoading(false);
    }
  }

  async function resetCurrentSession() {
    setLoading(true);
    setError(null);

    try {
      const nextSession = await resetSession(session.id);
      router.push(`/story/${nextSession.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "重置失败");
    } finally {
      setLoading(false);
    }
  }
}

function panelTitle(panel: Exclude<ReaderPanel, null>) {
  return panel === "status" ? "当前状态" : panel === "memory" ? "存档记忆" : "入戏行动";
}

function TurnView({ turn }: { turn: SessionTurn }) {
  const paragraphs = turn.narration
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  return (
    <article className="turn w-full min-w-0">
      {paragraphs.map((paragraph, index) => (
        <p className="reader-paragraph" key={`${turn.id}_p_${index}`}>
          {paragraph}
        </p>
      ))}
      {turn.dialogues.map((dialogue) => (
        <p className="reader-paragraph dialogue" key={`${turn.id}_${dialogue.speaker}_${dialogue.text}`}>
          <strong>{dialogue.speaker}</strong>：{dialogue.text}
        </p>
      ))}
    </article>
  );
}

/**
 * The turn being written right now. Dialogues and choices are omitted because they
 * are only trustworthy once the whole result has arrived.
 */
function StreamingTurnView({ narration, onStop }: { narration: string; onStop: () => void }) {
  const paragraphs = narration.split(/\n{2,}/).filter((paragraph) => paragraph.trim());

  return (
    <article className="turn turn-streaming w-full min-w-0" aria-busy="true" aria-live="polite">
      {paragraphs.length > 0 ? (
        paragraphs.map((paragraph, index) => (
          <p className="reader-paragraph" key={`streaming_p_${index}`}>
            {paragraph}
          </p>
        ))
      ) : (
        <p className="reader-paragraph muted">正在续写…</p>
      )}
      <div className="streaming-controls">
        <button className="streaming-stop" type="button" onClick={onStop}>
          停止生成
        </button>
      </div>
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

function TimelinePanel({
  loading,
  onReset,
  onRewind,
  session
}: {
  loading: boolean;
  onReset: () => void;
  onRewind: (timelineNodeId: string) => void;
  session: StorySession;
}) {
  return (
    <Card className="panel">
      <Card.Content>
        <div className="memory-panel-heading">
          <div>
            <h2>存档记忆</h2>
            <p className="muted">选择一个记忆恢复为新分支，或重新开启本故事。</p>
          </div>
          <Button isDisabled={loading} size="sm" type="button" variant="outline" onPress={onReset}>
            重置会话
          </Button>
        </div>
        <div className="timeline">
          {session.timeline.map((node) => (
            <div className="timeline-item" key={node.id}>
              <strong>{node.title}</strong>
              <p className="muted">{node.summary}</p>
              <Button isDisabled={loading} size="sm" type="button" variant="outline" onPress={() => onRewind(node.id)}>
                恢复此存档
              </Button>
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
  onPresetAction,
  onSubmitText,
  onTextChange,
  text
}: {
  error: string | null;
  latestTurn: SessionTurn;
  loading: boolean;
  onChoice: (choiceText: string, choiceId: string) => void;
  onPresetAction: (content: string) => void;
  onSubmitText: () => void;
  onTextChange: (value: string) => void;
  text: string;
}) {
  return (
    <Card className="panel action-panel">
      <Card.Content>
        <h2>入戏行动</h2>
        <div className="action-preset-grid" aria-label="固定入戏行动">
          {ACTION_PRESETS.map((action) => (
            <Button
              className="action-preset"
              isDisabled={loading}
              key={action.id}
              type="button"
              variant="outline"
              onPress={() => onPresetAction(action.prompt)}
            >
              <strong>{action.label}</strong>
              <span>{action.hint}</span>
            </Button>
          ))}
        </div>
        <h3>本幕建议</h3>
        <div className="choices secondary-choices">
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

const ACTION_PRESETS = [
  {
    id: "observe",
    label: "观察",
    hint: "看清环境、人物表情和异常细节",
    prompt: "我先不打断剧情，仔细观察当前场景、人物表情和可疑细节。"
  },
  {
    id: "ask",
    label: "询问",
    hint: "向当前最关键的人追问",
    prompt: "我向当前最关键的人追问一个能推进真相的问题，同时观察对方反应。"
  },
  {
    id: "inspect",
    label: "检查",
    hint: "检查线索、物品或地点",
    prompt: "我检查当前场景中最可疑的线索、物品或地点，尽量不惊动其他人。"
  },
  {
    id: "act",
    label: "行动",
    hint: "做一个谨慎但能推进局面的动作",
    prompt: "我采取一个谨慎但能推进局面的行动，优先保证自己不暴露。"
  }
];
