import { StoryLauncher } from "@/components/story-launcher";
import { BrandMark } from "@/components/brand-mark";
import { listStories } from "@/lib/api";

export default async function HomePage() {
  const stories = await listStories();

  return (
    <main className="reader">
      <div className="topbar">
        <div className="brand-row">
          <BrandMark size={44} />
          <div className="brand">
            <h1>入戏 InStory</h1>
            <p className="muted">AI 驱动互动小说平台</p>
          </div>
        </div>
      </div>

      <section className="story-grid">
        {stories.map((story) => (
          <StoryLauncher key={story.id} story={story} />
        ))}
      </section>
    </main>
  );
}
