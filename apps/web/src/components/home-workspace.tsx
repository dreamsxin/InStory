"use client";

import Link from "next/link";
import { useState } from "react";
import type { ReaderProfile, StorySummary } from "@instory/shared";
import { BrandMark } from "@/components/brand-mark";
import { StoryLauncher } from "@/components/story-launcher";
import { createReaderProfileAction } from "@/app/actions";

type HomeTab = "stories" | "profiles" | "continue" | "create";

const navItems: Array<{ id: HomeTab; label: string; hint: string }> = [
  { id: "stories", label: "故事", hint: "Worlds" },
  { id: "profiles", label: "角色", hint: "Profiles" },
  { id: "continue", label: "继续", hint: "Reading" },
  { id: "create", label: "创作", hint: "Create" }
];

export function HomeWorkspace({
  profiles,
  stories
}: {
  profiles: ReaderProfile[];
  stories: StorySummary[];
}) {
  const [activeTab, setActiveTab] = useState<HomeTab>("stories");

  return (
    <main className="app-shell mobile-tab-shell">
      <div className="topbar app-topbar">
        <div className="brand-row">
          <BrandMark size={44} />
          <div className="brand">
            <h1>入戏 InStory</h1>
            <p className="muted">连续阅读，随时入戏</p>
          </div>
        </div>
        <div className="mobile-app-meta">
          <span>{navItems.find((item) => item.id === activeTab)?.hint}</span>
          <strong>{navItems.find((item) => item.id === activeTab)?.label}</strong>
        </div>
        <nav className="app-nav desktop-nav" aria-label="InStory navigation">
          {navItems.map((item) => (
            <button
              aria-current={activeTab === item.id ? "page" : undefined}
              className="nav-pill"
              key={item.id}
              type="button"
              onClick={() => setActiveTab(item.id)}
            >
              {item.label}
            </button>
          ))}
          <Link className="nav-pill" href="/admin">控制台</Link>
        </nav>
      </div>

      <section className="app-hero">
        <div>
          <span className="eyebrow">MVP Workspace</span>
          <h2>选择一个身份，进入一个故事世界。</h2>
          <p>先阅读，再在关键一幕点击入戏。你的角色设定会成为 AI 生成互动时的上下文。</p>
        </div>
        <div className="hero-stat-grid" aria-label="InStory stats">
          <div>
            <strong>{stories.length}</strong>
            <span>故事世界</span>
          </div>
          <div>
            <strong>{profiles.length}</strong>
            <span>我的角色</span>
          </div>
        </div>
      </section>

      <section className="mobile-tab-panel">
        {activeTab === "stories" ? <StoriesView profiles={profiles} stories={stories} /> : null}
        {activeTab === "profiles" ? <ProfilesView profiles={profiles} /> : null}
        {activeTab === "continue" ? <ContinueView profiles={profiles} stories={stories} /> : null}
        {activeTab === "create" ? <CreateView /> : null}
      </section>

      <nav className="bottom-tabbar" aria-label="Mobile navigation">
        {navItems.map((item) => (
          <button
            aria-current={activeTab === item.id ? "page" : undefined}
            key={item.id}
            type="button"
            onClick={() => setActiveTab(item.id)}
          >
            <span>{item.label}</span>
            <small>{item.hint}</small>
          </button>
        ))}
      </nav>
    </main>
  );
}

function StoriesView({ profiles, stories }: { profiles: ReaderProfile[]; stories: StorySummary[] }) {
  return (
    <div className="app-section">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Worlds</span>
          <h2 className="section-title">故事世界</h2>
        </div>
        <span className="muted">进入前选择入戏身份</span>
      </div>
      <div className="story-grid">
        {stories.map((story) => (
          <StoryLauncher key={story.id} profiles={profiles} story={story} />
        ))}
      </div>
    </div>
  );
}

function ProfilesView({ profiles }: { profiles: ReaderProfile[] }) {
  return (
    <div className="app-section two-column-section">
      <section className="profile-panel">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Profiles</span>
            <h2>我的角色</h2>
          </div>
        </div>
        {profiles.length ? (
          <div className="profile-list">
            {profiles.map((profile) => (
              <article className="profile-card large" key={profile.id}>
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
          <p className="muted">还没有角色。切到“创作”创建一个入戏身份。</p>
        )}
      </section>

      <CreateProfilePanel />
    </div>
  );
}

function ContinueView({ profiles, stories }: { profiles: ReaderProfile[]; stories: StorySummary[] }) {
  return (
    <div className="app-section empty-state-panel">
      <span className="eyebrow">Continue</span>
      <h2>继续阅读</h2>
      <p className="muted">会话列表会在后续接入。现在可以从故事世界选择 {profiles.length ? "已有角色" : "默认角色"} 进入。</p>
      <div className="quick-card-row">
        <span>{stories.length} 个故事世界</span>
        <span>{profiles.length} 个我的角色</span>
      </div>
    </div>
  );
}

function CreateView() {
  return (
    <div className="app-section two-column-section">
      <CreateProfilePanel />
      <section className="profile-panel">
        <span className="eyebrow">Creator</span>
        <h2>故事世界创作</h2>
        <p className="muted">MVP 阶段先在控制台编辑故事基础配置。世界、角色和锚点编辑会在后续进入客户端创作模块。</p>
        <Link className="secondary center-action" href="/admin">打开控制台</Link>
      </section>
    </div>
  );
}

function CreateProfilePanel() {
  return (
    <section className="profile-panel create-profile-panel">
      <span className="eyebrow">Create Profile</span>
      <h2>创建角色</h2>
      <form className="profile-form embedded" action={createReaderProfileAction}>
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
    </section>
  );
}

function AvatarSeed({ name, src }: { name: string; src: string | null }) {
  if (src) {
    return <img alt="" className="profile-avatar" src={src} />;
  }

  return <div className="profile-avatar">{name.slice(0, 1)}</div>;
}
