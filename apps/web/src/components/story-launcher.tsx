"use client";

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
    <article className="story-card">
      <div>
        <h2>{story.title}</h2>
        <p className="muted">{story.tagline}</p>
      </div>
      <div className="tag-row">
        <span className="tag">{story.genre}</span>
        <span className="tag">AI 自由度 {story.aiFreedom}</span>
      </div>
      <label className="story-role-select">
        <span>入戏身份</span>
        <select value={readerProfileId} onChange={(event) => setReaderProfileId(event.target.value)}>
          <option value="">默认角色：陆清河</option>
          {profiles.map((profile) => (
            <option key={profile.id} value={profile.id}>
              {profile.name}
            </option>
          ))}
        </select>
      </label>
      {error ? <p className="error">{error}</p> : null}
      <button type="button" onClick={startStory} disabled={loading}>
        {loading ? "进入中..." : "进入故事"}
      </button>
    </article>
  );
}
