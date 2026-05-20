"use client";

import { Avatar, Button, Card, Chip, Input, Label, ListBox, Select, TextArea, TextField } from "@heroui/react";
import { useState } from "react";
import type { ReaderProfile, StorySummary } from "@instory/shared";
import { BrandMark } from "@/components/brand-mark";
import { StoryLauncher } from "@/components/story-launcher";
import { createReaderProfileAction, createStoryAction } from "@/app/actions";

type HomeTab = "stories" | "profiles" | "continue" | "create";
type CreateTab = "profiles" | "stories";

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
            <p className="muted">读故事，也创造故事</p>
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
        </nav>
      </div>

      <Card className="app-hero">
        <div>
          <span className="eyebrow">MVP Workspace</span>
          <h2>选择一个身份，进入一个故事世界。</h2>
          <p>创建入戏角色用于扮演自己；创建故事世界用于吸引读者进入你的设定。</p>
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
      </Card>

      <section className="mobile-tab-panel">
        {activeTab === "stories" ? <StoriesView profiles={profiles} stories={stories} /> : null}
        {activeTab === "profiles" ? <ProfilesView profiles={profiles} /> : null}
        {activeTab === "continue" ? <ContinueView profiles={profiles} stories={stories} /> : null}
        {activeTab === "create" ? <CreateView profiles={profiles} /> : null}
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
        <Chip size="sm" variant="soft">进入前选择入戏身份</Chip>
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
      <Card className="profile-panel">
        <Card.Header className="section-heading">
          <div>
            <span className="eyebrow">Profiles</span>
            <h2>我的角色</h2>
          </div>
        </Card.Header>
        <Card.Content>
          {profiles.length ? (
            <div className="profile-list">
              {profiles.map((profile) => (
                <article className="profile-card large" key={profile.id}>
                  <AvatarSeed name={profile.name} src={profile.avatarUrl} />
                  <div>
                    <strong>{profile.name}</strong>
                    <p>{profile.personality}</p>
                    <Chip color="accent" size="sm" variant="soft">{profile.gender ?? "未设定性别"}</Chip>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <p className="muted">还没有角色。切到“创作”创建一个入戏身份。</p>
          )}
        </Card.Content>
      </Card>

      <CreateProfilePanel />
    </div>
  );
}

function ContinueView({ profiles, stories }: { profiles: ReaderProfile[]; stories: StorySummary[] }) {
  return (
    <Card className="app-section empty-state-panel">
      <Card.Content>
        <span className="eyebrow">Continue</span>
        <h2>继续阅读</h2>
        <p className="muted">会话列表会在后续接入。现在可以从故事世界选择 {profiles.length ? "已有角色" : "默认角色"} 进入。</p>
        <div className="quick-card-row">
          <Chip variant="soft">{stories.length} 个故事世界</Chip>
          <Chip variant="soft">{profiles.length} 个我的角色</Chip>
        </div>
      </Card.Content>
    </Card>
  );
}

function CreateView({ profiles }: { profiles: ReaderProfile[] }) {
  const [createTab, setCreateTab] = useState<CreateTab>("stories");

  return (
    <div className="app-section creator-console">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Creator Console</span>
          <h2 className="section-title">创作控制台</h2>
        </div>
        <Chip size="sm" variant="soft">角色库与故事分层管理</Chip>
      </div>
      <div className="creator-tabs" role="tablist" aria-label="创作控制台">
        <button
          aria-selected={createTab === "profiles"}
          className={createTab === "profiles" ? "creator-tab active" : "creator-tab"}
          role="tab"
          type="button"
          onClick={() => setCreateTab("profiles")}
        >
          角色库
        </button>
        <button
          aria-selected={createTab === "stories"}
          className={createTab === "stories" ? "creator-tab active" : "creator-tab"}
          role="tab"
          type="button"
          onClick={() => setCreateTab("stories")}
        >
          故事工作台
        </button>
      </div>
      {createTab === "profiles" ? <CreateProfilePanel /> : <CreateStoryPanel profiles={profiles} />}
    </div>
  );
}

function CreateStoryPanel({ profiles }: { profiles: ReaderProfile[] }) {
  return (
    <Card className="profile-panel create-story-panel">
      <Card.Header>
        <div>
          <span className="eyebrow">Create Story</span>
          <h2>创建故事世界</h2>
        </div>
      </Card.Header>
      <Card.Content>
        <form className="profile-form embedded" action={createStoryAction}>
          <section className="form-section">
            <div>
              <span className="eyebrow">Step 1</span>
              <h3>展示信息</h3>
            </div>
            <div className="form-grid">
              <TextField isRequired name="id">
                <Label>故事 ID</Label>
                <Input maxLength={80} placeholder="moon-market" />
              </TextField>
              <TextField isRequired name="title">
                <Label>标题</Label>
                <Input maxLength={80} placeholder="月下市集" />
              </TextField>
            </div>
            <div className="form-grid">
              <TextField isRequired name="genre">
                <Label>类型</Label>
                <Input maxLength={40} placeholder="奇幻悬疑" />
              </TextField>
              <TextField isRequired name="tagline">
                <Label>一句话钩子</Label>
                <Input maxLength={160} placeholder="你在午夜市集里寻找被偷走的名字。" />
              </TextField>
            </div>
            <TextField name="coverUrl" type="url">
              <Label>封面图 URL</Label>
              <Input placeholder="用于故事卡片展示，后续可接上传或 AI 生图" />
            </TextField>
          </section>

          <section className="form-section">
            <div>
              <span className="eyebrow">Step 2</span>
              <h3>世界入口</h3>
            </div>
            <TextField isRequired name="premise">
              <Label>世界前提</Label>
              <TextArea maxLength={4000} placeholder="这个世界如何运转，读者会被卷入什么冲突。" rows={4} />
            </TextField>
            <div className="form-grid">
              <TextField isRequired name="openingLocationName">
                <Label>起点地点</Label>
                <Input maxLength={80} placeholder="市集入口" />
              </TextField>
              <TextField isRequired name="openingLocationDescription">
                <Label>起点场景</Label>
                <TextArea maxLength={1000} placeholder="读者进入故事后看到的第一幕。" rows={3} />
              </TextField>
            </div>
            <TextField name="worldRules">
              <Label>世界规则</Label>
              <TextArea maxLength={4000} placeholder={"每行一条规则\n例如：不能直接说出真名。"} rows={3} />
            </TextField>
          </section>

          <section className="form-section">
            <div>
              <span className="eyebrow">Step 3</span>
              <h3>故事演员</h3>
              <p className="muted">选择已创建的入戏角色作为故事里的角色。读者输入行动或对话后，AI 会模拟这些角色回应或做出反应。</p>
            </div>
            {profiles.length ? (
              <div className="cast-picker">
                {profiles.map((profile) => (
                  <label className="cast-option" key={profile.id}>
                    <input name="castProfileIds" type="checkbox" value={profile.id} />
                    <AvatarSeed name={profile.name} src={profile.avatarUrl} />
                    <span>
                      <strong>{profile.name}</strong>
                      <small>{profile.personality}</small>
                    </span>
                  </label>
                ))}
              </div>
            ) : (
              <p className="muted">还没有可选演员。先到“角色库”创建角色，再回到故事工作台选择。</p>
            )}
          </section>

          <section className="form-section">
            <div>
              <span className="eyebrow">Step 4</span>
              <h3>AI 体验</h3>
            </div>
            <div className="story-setting-grid">
              <Select defaultSelectedKey="coauthored" name="experienceMode">
                <Label>入戏体验</Label>
                <Select.Trigger>
                  <Select.Value />
                  <Select.Indicator />
                </Select.Trigger>
                <Select.Popover>
                  <ListBox>
                    <ListBox.Item id="scripted" textValue="剧本入戏">剧本入戏<ListBox.ItemIndicator /></ListBox.Item>
                    <ListBox.Item id="coauthored" textValue="共演入戏">共演入戏<ListBox.ItemIndicator /></ListBox.Item>
                    <ListBox.Item id="improvised" textValue="即兴入戏">即兴入戏<ListBox.ItemIndicator /></ListBox.Item>
                  </ListBox>
                </Select.Popover>
              </Select>
              <Select defaultSelectedKey="standard" name="defaultSegmentLength">
                <Label>生成长度</Label>
                <Select.Trigger>
                  <Select.Value />
                  <Select.Indicator />
                </Select.Trigger>
                <Select.Popover>
                  <ListBox>
                    <ListBox.Item id="short" textValue="短段">短段<ListBox.ItemIndicator /></ListBox.Item>
                    <ListBox.Item id="standard" textValue="标准小节">标准小节<ListBox.ItemIndicator /></ListBox.Item>
                    <ListBox.Item id="long" textValue="长小节">长小节<ListBox.ItemIndicator /></ListBox.Item>
                  </ListBox>
                </Select.Popover>
              </Select>
              <Select defaultSelectedKey="medium" name="aiFreedom">
                <Label>AI 自由度</Label>
                <Select.Trigger>
                  <Select.Value />
                  <Select.Indicator />
                </Select.Trigger>
                <Select.Popover>
                  <ListBox>
                    <ListBox.Item id="low" textValue="低">低<ListBox.ItemIndicator /></ListBox.Item>
                    <ListBox.Item id="medium" textValue="中">中<ListBox.ItemIndicator /></ListBox.Item>
                    <ListBox.Item id="high" textValue="高">高<ListBox.ItemIndicator /></ListBox.Item>
                  </ListBox>
                </Select.Popover>
              </Select>
            </div>
          </section>
          <Button type="submit">创建故事</Button>
        </form>
      </Card.Content>
    </Card>
  );
}

function CreateProfilePanel() {
  return (
    <Card className="profile-panel create-profile-panel">
      <Card.Header>
        <div>
          <span className="eyebrow">Create Profile</span>
          <h2>创建入戏角色</h2>
        </div>
      </Card.Header>
      <Card.Content>
        <form className="profile-form embedded" action={createReaderProfileAction}>
          <TextField isRequired name="name">
            <Label>名称</Label>
            <Input maxLength={40} placeholder="林向晚" />
          </TextField>
          <TextField name="gender">
            <Label>性别</Label>
            <Input maxLength={40} placeholder="可选" />
          </TextField>
          <TextField isRequired name="personality">
            <Label>性格</Label>
            <TextArea maxLength={1200} placeholder="冷静、敏感，习惯先观察再行动。" rows={3} />
          </TextField>
          <TextField name="avatarUrl" type="url">
            <Label>头像 URL</Label>
            <Input placeholder="后续可接 AI 生成形象" />
          </TextField>
          <TextField isRequired name="description">
            <Label>身份背景</Label>
            <TextArea maxLength={2000} placeholder="现代法医，被卷入雨夜旧宅谜案。" rows={3} />
          </TextField>
          <Button type="submit">创建入戏角色</Button>
        </form>
      </Card.Content>
    </Card>
  );
}

function AvatarSeed({ name, src }: { name: string; src: string | null }) {
  if (src) {
    return (
      <Avatar className="profile-avatar">
        <Avatar.Image alt="" src={src} />
        <Avatar.Fallback>{name.slice(0, 1)}</Avatar.Fallback>
      </Avatar>
    );
  }

  return (
    <Avatar className="profile-avatar">
      <Avatar.Fallback>{name.slice(0, 1)}</Avatar.Fallback>
    </Avatar>
  );
}
