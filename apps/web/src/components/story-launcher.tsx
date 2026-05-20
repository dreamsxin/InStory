"use client";

import { Button, Card, CardContent, CardHeader, Chip, Label, ListBox, Select } from "@heroui/react";
import { useRouter } from "next/navigation";
import type { ReaderProfile, StorySummary } from "@instory/shared";
import { createSession } from "@/lib/api";
import { useState } from "react";

export function StoryLauncher({ profiles, story }: { profiles: ReaderProfile[]; story: StorySummary }) {
  const router = useRouter();
  const [readerProfileId, setReaderProfileId] = useState(profiles[0]?.id ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function startStory() {
    setLoading(true);
    setError(null);

    try {
      const response = await createSession(story.id, readerProfileId || null);
      router.push(`/story/${response.session.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "启动失败");
      setLoading(false);
    }
  }

  return (
    <Card className="story-card">
      <CardHeader className="story-card-header">
        <h2>{story.title}</h2>
        <p className="muted">{story.tagline}</p>
      </CardHeader>
      <CardContent className="story-card-body">
        <div className="tag-row">
          <Chip size="sm" variant="soft">{story.genre}</Chip>
          <Chip size="sm" variant="soft">AI 自由度 {story.aiFreedom}</Chip>
        </div>
        <Select
          selectedKey={readerProfileId}
          onSelectionChange={(key) => setReaderProfileId(typeof key === "string" ? key : "")}
        >
          <Label>入戏身份</Label>
          <Select.Trigger>
            <Select.Value />
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover>
            <ListBox>
              <ListBox.Item id="" textValue="默认角色：陆清河">
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
        <Button isDisabled={loading} type="button" onPress={startStory}>
          {loading ? "进入中..." : "进入故事"}
        </Button>
      </CardContent>
    </Card>
  );
}
