"use client";

import { Button, Card, Chip, Label, ListBox, Select } from "@heroui/react";
import { useRouter } from "next/navigation";
import type { ReaderProfile, ReaderSessionListItem, ShelfStory, StoryReadingInsight } from "@instory/shared";
import { createSession } from "@/lib/api";
import { readingThemeLabel } from "@/lib/reading-themes";
import { useState } from "react";

export function StoryLauncher({
  existingSession,
  insight,
  profiles,
  story
}: {
  existingSession?: ReaderSessionListItem;
  /** Aggregate reader counts, or undefined before anyone has read anything. */
  insight?: StoryReadingInsight;
  profiles: ReaderProfile[];
  story: ShelfStory;
}) {
  const router = useRouter();
  const [readerProfileId, setReaderProfileId] = useState(profiles[0]?.id ?? DEFAULT_ROLE_KEY);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function startStory() {
    setLoading(true);
    setError(null);

    try {
      if (existingSession) {
        router.push(`/story/${existingSession.id}`);
        return;
      }

      const response = await createSession(story.id, readerProfileId === DEFAULT_ROLE_KEY ? null : readerProfileId);
      router.push(`/story/${response.session.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "启动失败");
      setLoading(false);
    }
  }

  return (
    <Card className="story-card">
      <div className="story-cover" aria-hidden="true">
        {story.coverUrl ? <img alt="" src={story.coverUrl} /> : <div className="story-cover-fallback">{story.title.slice(0, 1)}</div>}
      </div>
      <Card.Header className="story-card-header">
        <h2>{story.title}</h2>
        <p className="muted">{story.tagline}</p>
      </Card.Header>
      <Card.Content className="story-card-content">
        <div className="tag-row">
          <Chip size="sm" variant="soft">{story.genre}</Chip>
          <Chip size="sm" variant="soft">AI 自由度 {story.aiFreedom}</Chip>
          <Chip size="sm" variant="soft">{experienceModeLabel(story.experienceMode)}</Chip>
          <Chip size="sm" variant="soft">{segmentLengthLabel(story.defaultSegmentLength)}</Chip>
          <Chip size="sm" variant="soft">{readingThemeLabel(story.readingTheme)}</Chip>
        </div>
        <ReadCountLine insight={insight} />
        <LengthExpectationLine story={story} />
        {existingSession ? (
          <div className="tag-row compact">
            <Chip size="sm" variant="soft">继续身份：{existingSession.readerRoleName}</Chip>
            <Chip size="sm" variant="soft">{existingSession.turnCount} 回合</Chip>
          </div>
        ) : (
          <Select
            className="instory-select"
            selectedKey={readerProfileId}
            onSelectionChange={(key) => setReaderProfileId(typeof key === "string" ? key : DEFAULT_ROLE_KEY)}
          >
            <Label>入戏身份</Label>
            <Select.Trigger>
              <Select.Value />
              <Select.Indicator />
            </Select.Trigger>
            <Select.Popover>
              <ListBox>
                <ListBox.Item id={DEFAULT_ROLE_KEY} textValue="默认角色（由故事指定）">
                  默认角色（由故事指定）
                  <ListBox.ItemIndicator />
                </ListBox.Item>
                {profiles.map((profile) => (
                  <ListBox.Item id={profile.id} key={profile.id} textValue={profile.name}>
                    {profile.name}
                    <ListBox.ItemIndicator />
                  </ListBox.Item>
                ))}
              </ListBox>
            </Select.Popover>
          </Select>
        )}
        {error ? <p className="error">{error}</p> : null}
        <Button isDisabled={loading} type="button" onPress={startStory}>
          {loading ? "进入中..." : existingSession ? "继续故事" : "进入故事"}
        </Button>
      </Card.Content>
    </Card>
  );
}

const DEFAULT_ROLE_KEY = "__default__";

/**
 * What other readers have done with this story. Aggregates only, and the author's
 * own trials are excluded upstream, so a number here means real readers. Before
 * this a card said nothing about whether the story was worth starting.
 */
function ReadCountLine({ insight }: { insight?: StoryReadingInsight }) {
  if (!insight || insight.readers === 0) {
    return <span className="story-read-count muted">还没有人读过</span>;
  }

  return (
    <span className="story-read-count">
      {insight.readers} 位读者读过 · 最深读到 {insight.deepestTurns} 回合
    </span>
  );
}


/**
 * How long this is, as far as anyone can honestly say. Two known figures: the beats
 * the author planned, and the words a passage is written to. The minutes are a floor,
 * not a promise - a reader can spend several passages on one beat, so the story is at
 * least this long and usually longer, which is why the label says 起.
 *
 * A story with no planned beats gets no number at all. Inventing one for an
 * improvised story would be the same lie the shelf used to tell by saying nothing.
 */
function LengthExpectationLine({ story }: { story: ShelfStory }) {
  if (story.plannedBeats === 0) {
    return (
      <span className="story-expectation muted">
        没有预设主线节点，长度由你和 AI 一起决定 · 每段约 {story.segmentTargetWords} 字
      </span>
    );
  }

  // 400 characters a minute is a middling Chinese reading pace; the floor rounds up so
  // a very short story never reads as "0 分钟".
  const minutes = Math.max(1, Math.round((story.plannedBeats * story.segmentTargetWords) / 400));

  return (
    <span className="story-expectation">
      主线 {story.plannedBeats} 个节点 · 每段约 {story.segmentTargetWords} 字 · 约 {minutes} 分钟起
    </span>
  );
}

function experienceModeLabel(mode: ShelfStory["experienceMode"]) {
  return mode === "scripted" ? "剧本入戏" : mode === "improvised" ? "即兴入戏" : "共演入戏";
}

function segmentLengthLabel(length: ShelfStory["defaultSegmentLength"]) {
  return length === "short" ? "短段" : length === "long" ? "长小节" : "标准小节";
}

