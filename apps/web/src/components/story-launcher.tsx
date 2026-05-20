"use client";

import { useRouter } from "next/navigation";
import type { StorySummary } from "@instory/shared";
import { createSession } from "@/lib/api";
import { useState } from "react";

export function StoryLauncher({ story }: { story: StorySummary }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function startStory() {
    setLoading(true);
    setError(null);

    try {
      const response = await createSession(story.id);
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
      {error ? <p className="error">{error}</p> : null}
      <button type="button" onClick={startStory} disabled={loading}>
        {loading ? "进入中..." : "进入故事"}
      </button>
    </article>
  );
}
