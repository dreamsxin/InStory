"use client";

import { Button, Card, Chip } from "@heroui/react";
import type {
  InterventionCue,
  ReadingTheme,
  RiskLevel,
  SessionTurn,
  StorySession,
  TurnQuota,
  WorldState
} from "@instory/shared";
import {
  createTurn,
  getOlderTurns,
  QuotaExceededError,
  RateLimitedError,
  resetSession,
  rewindSession,
  streamTurn,
  UnauthenticatedError,
  type SessionHistoryInfo
} from "@/lib/api";
import { BrandMark } from "@/components/brand-mark";
import { useEffect, useRef, useState, Fragment } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type ReaderPanel = "status" | "memory" | "action" | null;

export function ReaderClient({
  initialHistory,
  initialQuota,
  initialSession,
  readingTheme,
  storyTitle
}: {
  initialHistory: SessionHistoryInfo;
  initialQuota: TurnQuota;
  initialSession: StorySession;
  readingTheme: ReadingTheme;
  storyTitle: string;
}) {
  const router = useRouter();
  const [session, setSession] = useState(initialSession);
  const [activePanel, setActivePanel] = useState<ReaderPanel>(null);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [streamingNarration, setStreamingNarration] = useState("");
  const [quota, setQuota] = useState<TurnQuota>(initialQuota);
  // Visible by default: the bar carries the story title, the reader's identity and
  // the remaining daily quota, none of which are worth having if nobody sees them.
  const [chromeVisible, setChromeVisible] = useState(true);
  // Only a window of the transcript is loaded; this tracks how much is still behind us.
  const [history, setHistory] = useState(initialHistory);
  const [loadingOlder, setLoadingOlder] = useState(false);
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

  /**
   * Prepends the previous page of turns. Scroll position is restored by height delta,
   * because inserting text above the viewport would otherwise throw the reader back
   * to a passage they had already left.
   */
  async function loadOlder() {
    const cursor = history.oldestLoadedTurnId;
    if (!cursor || loadingOlder) {
      return;
    }

    setLoadingOlder(true);
    setError(null);

    const container = scrollRef.current;
    const heightBefore = container?.scrollHeight ?? 0;
    const offsetBefore = container?.scrollTop ?? 0;

    try {
      const page = await getOlderTurns(session.id, cursor);
      if (page.turns.length === 0) {
        setHistory((current) => ({ ...current, hasMore: false }));
        return;
      }

      setSession((current) => ({ ...current, turns: [...page.turns, ...current.turns] }));
      setHistory((current) => ({
        ...current,
        loadedTurns: current.loadedTurns + page.turns.length,
        oldestLoadedTurnId: page.turns[0]?.id ?? current.oldestLoadedTurnId,
        hasMore: page.hasMore
      }));

      requestAnimationFrame(() => {
        if (container) {
          container.scrollTop = offsetBefore + (container.scrollHeight - heightBefore);
        }
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载更早的回合失败");
    } finally {
      setLoadingOlder(false);
    }
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
      // Keep the counter honest, otherwise it drifts behind as the story grows.
      setHistory((current) => ({
        ...current,
        turnCount: current.turnCount + 1,
        loadedTurns: current.loadedTurns + 1
      }));
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
    <main className="reader-shell reader-shell-focus h-dvh w-full overflow-hidden" data-reading-theme={readingTheme}>
      <section className="reader reader-stage h-dvh w-full min-w-0 p-0 sm:p-4 md:p-8">
        <div className={`topbar reader-topbar${chromeVisible ? "" : " reader-chrome-hidden"}`}>
          <div className="brand-row">
            {/* The way out. Without it the reader is a dead end: the only exits were
                the browser's own back button and editing the address bar. */}
            <Link aria-label="返回书架" className="reader-exit" href="/">
              ← 书架
            </Link>
            <BrandMark size={40} />
            <div className="brand">
              <h1>{storyTitle}</h1>
              <p className="muted">身份：{session.readerRole.name}</p>
            </div>
          </div>
          {/* Always present: the budget arrives with the session, so a reader knows
              what is left before spending any of it. */}
          <Chip className="quota-chip" aria-label={`今日剩余推进 ${quota.remainingTurnsToday} 次`}>
            今日剩余 {quota.remainingTurnsToday}/{quota.dailyLimit}
          </Chip>
        </div>

        <div
          className="reader-scroll w-full min-w-0 flex-1 overflow-x-hidden overflow-y-auto"
          ref={scrollRef}
        >
          <div className="turns reading-surface w-full min-w-0 sm:max-w-[760px]">
            {history.hasMore ? (
              <div className="older-turns-row">
                <Button
                  isDisabled={loadingOlder || loading}
                  size="sm"
                  variant="outline"
                  onPress={() => void loadOlder()}
                >
                  {loadingOlder ? "载入中..." : "载入更早的回合"}
                </Button>
                <span className="muted">
                  已载入 {history.loadedTurns}/{history.turnCount} 回合
                </span>
              </div>
            ) : null}
            {session.turns.map((turn, index) => {
              // Only the loaded window is in hand, so a divider above the first
              // passage is honest only when that passage really opens the story.
              const scene = sceneChangeLabel(turn, session.turns[index - 1], index === 0 && !history.hasMore);
              return (
                <Fragment key={turn.id}>
                  {scene ? <SceneDivider label={scene} /> : null}
                  <TurnView
                    turn={turn}
                    onStepIn={
                      index === session.turns.length - 1 ? () => setActivePanel("action") : undefined
                    }
                  />
                </Fragment>
              );
            })}
            {loading ? (
              <StreamingTurnView narration={streamingNarration} onStop={stopGeneration} />
            ) : null}
          </div>
        </div>

        {/* The action panel shows its own copy, so this only covers the case where a
            failure from 继续阅读 would otherwise leave the reader with no explanation. */}
        {error && activePanel !== "action" ? (
          <p className="reader-error error" role="alert">
            {error}
          </p>
        ) : null}

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

      {/* Panel and dock share one fixed column so they can never cover each other.
          They used to be independently fixed to the bottom right, and the dock's
          higher z-index made the panel's own submit button unclickable. */}
      <div className="reader-side-rail">
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
          <Button
            aria-pressed={!chromeVisible}
            className="w-full min-w-0 sm:w-auto"
            size="sm"
            variant={chromeVisible ? "outline" : "secondary"}
            onPress={() => setChromeVisible((visible) => !visible)}
          >
            {chromeVisible ? "沉浸阅读" : "显示信息栏"}
          </Button>
        </nav>
      </div>
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

function TurnView({ turn, onStepIn }: { turn: SessionTurn; onStepIn?: () => void }) {
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
      {turn.intervention ? <InterventionCueView cue={turn.intervention} onStepIn={onStepIn} /> : null}
    </article>
  );
}

/**
 * A key node (§5.3), marked in the transcript where it happened. It never blocks:
 * reading on is always allowed, and the bar below the transcript keeps 继续阅读, so
 * this only adds the one thing that was missing - the invitation, and why it is
 * being offered here. Past cues keep the label and lose the button, because
 * stepping into a scene that has already moved on is not on offer.
 */
function InterventionCueView({ cue, onStepIn }: { cue: InterventionCue; onStepIn?: () => void }) {
  return (
    <aside className="intervention-cue" data-kind={cue.kind}>
      <span className="intervention-cue-kind">{interventionKindLabel(cue.kind)}</span>
      <p className="intervention-cue-prompt">{cue.prompt}</p>
      {onStepIn ? (
        <Button className="intervention-cue-action" size="sm" variant="outline" onPress={onStepIn}>
          入戏参与
        </Button>
      ) : null}
    </aside>
  );
}

function interventionKindLabel(kind: InterventionCue["kind"]): string {
  switch (kind) {
    case "npc_question":
      return "有人在等你回答";
    case "clue_found":
      return "你发现了线索";
    case "crisis":
      return "危机逼近";
    case "fork":
      return "路线出现分歧";
    case "relationship_shift":
      return "关系发生变化";
    default:
      return "剧情转折";
  }
}


/**
 * The place a passage happens in, but only when it is news. Printing the location
 * above every passage is noise; marking the move is what tells the reader they
 * walked somewhere.
 */
function sceneChangeLabel(
  turn: SessionTurn,
  previous: SessionTurn | undefined,
  isStoryStart: boolean
): string | null {
  const location = turn.stateSnapshot.location?.trim();
  if (!location) {
    return null;
  }
  if (!previous) {
    return isStoryStart ? location : null;
  }
  return previous.stateSnapshot.location?.trim() === location ? null : location;
}

/** A break in the transcript where the story changes place. */
function SceneDivider({ label }: { label: string }) {
  return (
    <div className="scene-divider" role="separator">
      <span className="scene-divider-label">{label}</span>
    </div>
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
          {/* Both controls here throw away reading nobody can get back, so they ask
              first - the same way deleting a story or a role already does. */}
          <Button
            isDisabled={loading}
            size="sm"
            type="button"
            variant="outline"
            onPress={() => {
              // No turn count in the copy: only a window of the transcript is
              // loaded, so any number here would be smaller than the truth.
              if (window.confirm("确认重置本故事？全部回合与存档都会清空，从开场重新开始，无法撤销。")) {
                onReset();
              }
            }}
          >
            重置会话
          </Button>
        </div>
        <div className="timeline">
          {session.timeline.map((node) => (
            <div className="timeline-item" key={node.id}>
              <strong>{node.title}</strong>
              <p className="muted">{node.summary}</p>
              <Button
                isDisabled={loading}
                size="sm"
                type="button"
                variant="outline"
                onPress={() => {
                  if (window.confirm(`确认恢复到「${node.title}」？这之后的回合会被丢弃，无法撤销。`)) {
                    onRewind(node.id);
                  }
                }}
              >
                恢复此存档
              </Button>
            </div>
          ))}
        </div>
      </Card.Content>
    </Card>
  );
}

/** Matches createTurnRequestSchema on the server, so the counter tells the truth. */
const MAX_ACTION_LENGTH = 2000;

const RISK_LABELS: Record<RiskLevel, string> = {
  low: "稳妥",
  medium: "有风险",
  high: "危险"
};

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
  const canSubmit = !loading && text.trim().length > 0;

  return (
    <div className="action-panel">
      <p className="action-panel-intro">选一个快捷动作，或者自己写下想说的话、想做的事。</p>

      <section className="action-section">
        <div className="action-section-head">
          <h3>快捷动作</h3>
        </div>
        <div className="action-preset-grid" aria-label="固定入戏行动">
          {ACTION_PRESETS.map((action) => (
            <button
              className="action-preset"
              disabled={loading}
              key={action.id}
              type="button"
              onClick={() => onPresetAction(action.prompt)}
            >
              <span className="action-preset-label">{action.label}</span>
              <span className="action-preset-hint">{action.hint}</span>
            </button>
          ))}
        </div>
      </section>

      {latestTurn.choices.length > 0 ? (
        <section className="action-section">
          <div className="action-section-head">
            <h3>本幕建议</h3>
            <span className="action-section-note">来自上一段叙事</span>
          </div>
          <div className="action-choice-list">
            {latestTurn.choices.map((choice) => (
              <button
                className="action-choice"
                disabled={loading}
                key={choice.id}
                type="button"
                onClick={() => onChoice(choice.text, choice.id)}
              >
                <span className="action-choice-text">{choice.text}</span>
                <span className={`risk-badge risk-badge-${choice.risk}`}>{RISK_LABELS[choice.risk]}</span>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      <section className="action-section">
        <form
          className="action-form"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmitText();
          }}
        >
          <div className="action-section-head">
            <h3>自由行动</h3>
            <span className={`action-section-note${text.length > MAX_ACTION_LENGTH - 100 ? " is-near-limit" : ""}`}>
              {text.length}/{MAX_ACTION_LENGTH}
            </span>
          </div>
          <textarea
            className="action-textarea"
            disabled={loading}
            maxLength={MAX_ACTION_LENGTH}
            name="action"
            placeholder="例如：我压低声音问陆清河，昨夜谁最后见过父亲。"
            rows={4}
            value={text}
            onChange={(event) => onTextChange(event.target.value)}
            onKeyDown={(event) => {
              // Long-form input needs Enter for newlines, so submit takes a modifier.
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && canSubmit) {
                event.preventDefault();
                onSubmitText();
              }
            }}
          />
          {error ? (
            <p className="action-form-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="action-form-footer">
            <span className="action-form-hint">Ctrl / ⌘ + Enter 提交</span>
            <Button isDisabled={!canSubmit} type="submit">
              {loading ? "生成中..." : "提交行动"}
            </Button>
          </div>
        </form>
      </section>
    </div>
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
