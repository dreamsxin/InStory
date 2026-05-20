"use client";

import { Button, Card, Chip, Label, ListBox, Select } from "@heroui/react";
import { useRouter } from "next/navigation";
import type { ReaderProfile, StorySummary } from "@instory/shared";
import { createSession } from "@/lib/api";
import { useState } from "react";

export function StoryLauncher({ profiles, story }: { profiles: ReaderProfile[]; story: StorySummary }) {
  const router = useRouter();
  const [readerProfileId, setReaderProfileId] = useState(profiles[0]?.id ?? DEFAULT_ROLE_KEY);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function startStory() {
    setLoading(true);
    setError(null);

    try {
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
        </div>
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
              <ListBox.Item id={DEFAULT_ROLE_KEY} textValue="默认角色：陆清河">
                默认角色：陆清河
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
        {error ? <p className="error">{error}</p> : null}
        <Button isDisabled={loading} onPress={startStory}>
          {loading ? "进入中..." : "进入故事"}
        </Button>
      </Card.Content>
    </Card>
  );
}

const DEFAULT_ROLE_KEY = "__default__";

function experienceModeLabel(mode: StorySummary["experienceMode"]) {
  return mode === "scripted" ? "剧本入戏" : mode === "improvised" ? "即兴入戏" : "共演入戏";
}

function segmentLengthLabel(length: StorySummary["defaultSegmentLength"]) {
  return length === "short" ? "短段" : length === "long" ? "长小节" : "标准小节";
}
