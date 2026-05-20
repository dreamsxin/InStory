import { StoryLauncher } from "@/components/story-launcher";
import { BrandMark } from "@/components/brand-mark";
import { listReaderProfiles, listStories } from "@/lib/api";
import { createReaderProfileAction } from "./actions";

export default async function HomePage() {
  const [stories, profiles] = await Promise.all([listStories(), listReaderProfiles()]);

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

      <section className="home-layout">
        <div>
          <h2 className="section-title">故事世界</h2>
          <div className="story-grid">
            {stories.map((story) => (
              <StoryLauncher key={story.id} profiles={profiles} story={story} />
            ))}
          </div>
        </div>

        <aside className="profile-panel">
          <h2>我的角色</h2>
          {profiles.length ? (
            <div className="profile-list">
              {profiles.map((profile) => (
                <article className="profile-card" key={profile.id}>
                  <AvatarSeed name={profile.name} src={profile.avatarUrl} />
                  <div>
                    <strong>{profile.name}</strong>
                    <p>{profile.personality}</p>
                    <span>{profile.gender ?? "未设定性别"}</span>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <p className="muted">先创建一个自己的入戏身份，再进入故事。</p>
          )}

          <form className="profile-form" action={createReaderProfileAction}>
            <label>
              <span>名称</span>
              <input name="name" required maxLength={40} placeholder="林向晚" />
            </label>
            <label>
              <span>性别</span>
              <input name="gender" maxLength={40} placeholder="可选" />
            </label>
            <label>
              <span>性格</span>
              <textarea name="personality" required maxLength={1200} placeholder="冷静、敏感，习惯先观察再行动。" />
            </label>
            <label>
              <span>头像 URL</span>
              <input name="avatarUrl" type="url" placeholder="后续可接 AI 生成形象" />
            </label>
            <label>
              <span>身份背景</span>
              <textarea name="description" required maxLength={2000} placeholder="现代法医，被卷入雨夜旧宅谜案。" />
            </label>
            <button className="primary" type="submit">创建角色</button>
          </form>
        </aside>
      </section>
    </main>
  );
}

function AvatarSeed({ name, src }: { name: string; src: string | null }) {
  if (src) {
    return <img alt="" className="profile-avatar" src={src} />;
  }

  return <div className="profile-avatar">{name.slice(0, 1)}</div>;
}
