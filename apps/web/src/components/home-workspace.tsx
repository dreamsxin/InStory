"use client";

import { Avatar, Button, Card, Chip, Input, Label, ListBox, Select, TextArea, TextField } from "@heroui/react";
import { useActionState, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type {
  CharacterProfile,
  ReaderProfile,
  ReaderSessionListItem,
  ShelfStory,
  StoryAnchor,
  StoryDetail,
  StoryReadingInsight,
  StorySummary,
  TurnQuota
} from "@instory/shared";
import { BrandMark } from "@/components/brand-mark";
import { ReadingThemeSelect } from "@/components/reading-theme-select";
import { DEFAULT_READING_THEME, parseReadingTheme } from "@/lib/reading-themes";
import { QuotaExhaustedNote, StoryLauncher } from "@/components/story-launcher";

import { createSession, formatQuotaReset } from "@/lib/api";

import {
  createReaderProfileAction,
  createStoryAction,
  deleteReaderProfileAction,
  deleteSessionAction,
  deleteStoryAction,
  updateReaderProfileAction,
  updateStoryAction,
  updateStoryAnchorsAction,
  updateStoryCharacterAction
} from "@/app/actions";
import { IDLE_FORM, kept, submitted, type FormResult } from "@/lib/form-result";

type HomeTab = "stories" | "continue" | "create";
type CreateTab = "profiles" | "stories";

const navItems: Array<{ id: HomeTab; label: string; hint: string }> = [
  { id: "stories", label: "故事", hint: "Worlds" },
  { id: "continue", label: "继续", hint: "Reading" },
  { id: "create", label: "创作", hint: "Create" }
];

const TRIAL_DEFAULT_ROLE_KEY = "__trial_default__";

export function HomeWorkspace({
  accountBar,
  myStoryDetails,
  profiles,
  quota,
  sessions,
  shelfInsights,
  stories,
  storyInsights
}: {
  /** Rendered on the server and placed in the top bar, so it stays put while the
   *  content scrolls instead of adding height above the shell. */
  accountBar?: ReactNode;
  myStoryDetails: StoryDetail[];
  profiles: ReaderProfile[];
  /** Today's budget for this reader, so the card can stop quoting the allowance. */
  quota: TurnQuota;
  sessions: ReaderSessionListItem[];

  /** Reader counts for the public shelf, so a story can show it has been read. */
  shelfInsights: StoryReadingInsight[];
  stories: ShelfStory[];
  storyInsights: StoryReadingInsight[];
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
        <div className="app-topbar-end">
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
          {accountBar}
        </div>
      </div>


      {/* Hidden on phones once someone is reading - the tab bar and the shelf say
          enough by then. A reader with no progress yet keeps it, because otherwise
          the narrow layout explains nothing about what this place is. */}
      <Card className={`app-hero${sessions.length === 0 ? " is-first-run" : ""}`}>
        <div>
          <span className="eyebrow">AI 互动小说</span>
          <h2>翻开下一章，主角就是你。</h2>
          <p>
            读一段故事，随时以角色身份介入：说一句话、做一个动作，AI 接着往下写。也可以自己搭一个世界，
            让别人进来演。<QuotaSentence quota={quota} />
          </p>
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
          {/* The reader's own number, not the product's promise: 20 次/天 told someone
              with two left nothing, and they found out from an error mid-passage. */}
          <div className="hero-quota">
            <strong>{quota.remainingTurnsToday}</strong>
            <span>今日剩余</span>
          </div>
        </div>

      </Card>

      <section className="mobile-tab-panel">
        {activeTab === "stories" ? (
          <StoriesView
            insights={shelfInsights}
            profiles={profiles}
            quota={quota}
            sessions={sessions}
            stories={stories}
            onCreateStory={() => setActiveTab("create")}
          />
        ) : null}
        {activeTab === "continue" ? <ContinueView quota={quota} sessions={sessions} /> : null}

        {activeTab === "create" ? (
          <CreateView
            myStoryDetails={myStoryDetails}
            profiles={profiles}
            sessions={sessions}
            storyInsights={storyInsights}
          />
        ) : null}
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

/**
 * The shelf is ordered by what a reader would ask for, not by story id. "最近有人读"
 * is the default because a shelf sorted alphabetically silently buries everything
 * after the first screen - and the reader counts were already being computed and
 * shown on the cards without ever being used to order them.
 */
type ShelfSort = "recent" | "readers" | "title";

const SHELF_SORTS: Array<{ id: ShelfSort; label: string }> = [
  { id: "recent", label: "最近有人读" },
  { id: "readers", label: "读者最多" },
  { id: "title", label: "按标题" }
];

/** Sentinel for "no genre filter"; a real genre is free text and could be anything. */
const ALL_GENRES = "__all__";

function StoriesView({
  insights,
  onCreateStory,
  profiles,
  quota,
  sessions,
  stories
}: {
  insights: StoryReadingInsight[];
  onCreateStory: () => void;
  profiles: ReaderProfile[];
  quota: TurnQuota;
  sessions: ReaderSessionListItem[];
  stories: ShelfStory[];
}) {

  const [query, setQuery] = useState("");
  const [genre, setGenre] = useState<string>(ALL_GENRES);
  const [sort, setSort] = useState<ShelfSort>("recent");
  const sessionsByStoryId = new Map(sessions.map((session) => [session.storyId, session]));
  const insightsByStoryId = new Map(insights.map((insight) => [insight.storyId, insight]));

  const genres = [...new Set(stories.map((story) => story.genre))].sort((left, right) =>
    left.localeCompare(right, "zh-CN")
  );
  const keyword = query.trim().toLowerCase();
  const visible = [...stories]
    .filter((story) => genre === ALL_GENRES || story.genre === genre)
    .filter(
      (story) =>
        !keyword || `${story.title} ${story.tagline} ${story.genre}`.toLowerCase().includes(keyword)
    )
    .sort((left, right) => compareForShelf(left, right, sort, insightsByStoryId));
  const filtering = keyword.length > 0 || genre !== ALL_GENRES;

  return (
    <div className="app-section">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Worlds</span>
          <h2 className="section-title">探索故事</h2>
        </div>
        <Chip size="sm" variant="soft">
          {stories.length === 0
            ? "暂无公开故事"
            : filtering
              ? `筛出 ${visible.length} / 共 ${stories.length}`
              : "所有可进入的故事"}
        </Chip>
      </div>
      {stories.length ? (
        <>
          <div className="shelf-filters">
            <TextField aria-label="搜索故事" value={query} onChange={setQuery}>
              <Label>搜索</Label>
              <Input maxLength={80} placeholder="标题、钩子或类型" type="search" />
            </TextField>
            <Select
              selectedKey={genre}
              onSelectionChange={(key) => setGenre(typeof key === "string" ? key : ALL_GENRES)}
            >
              <Label>类型</Label>
              <Select.Trigger>
                <Select.Value />
                <Select.Indicator />
              </Select.Trigger>
              <Select.Popover>
                <ListBox>
                  <ListBox.Item id={ALL_GENRES} textValue="全部类型">
                    全部类型
                    <ListBox.ItemIndicator />
                  </ListBox.Item>
                  {genres.map((name) => (
                    <ListBox.Item id={name} key={name} textValue={name}>
                      {name}
                      <ListBox.ItemIndicator />
                    </ListBox.Item>
                  ))}
                </ListBox>
              </Select.Popover>
            </Select>
            <Select
              selectedKey={sort}
              onSelectionChange={(key) => setSort(parseShelfSort(key))}
            >
              <Label>排序</Label>
              <Select.Trigger>
                <Select.Value />
                <Select.Indicator />
              </Select.Trigger>
              <Select.Popover>
                <ListBox>
                  {SHELF_SORTS.map((option) => (
                    <ListBox.Item id={option.id} key={option.id} textValue={option.label}>
                      {option.label}
                      <ListBox.ItemIndicator />
                    </ListBox.Item>
                  ))}
                </ListBox>
              </Select.Popover>
            </Select>
          </div>
          {visible.length ? (
            <div className="story-grid">
              {visible.map((story) => (
                <StoryLauncher
                  existingSession={sessionsByStoryId.get(story.id)}
                  insight={insightsByStoryId.get(story.id)}
                  key={story.id}
                  profiles={profiles}
                  quota={quota}
                  story={story}
                />

              ))}
            </div>
          ) : (
            /* Deliberately not the "nothing is public yet" panel: telling someone to go
               create a story when they merely mistyped a search would be a lie. */
            <Card className="empty-state-panel">
              <Card.Content>
                <h2>没有符合条件的故事</h2>
                <p className="muted">换个关键词，或把类型放回「全部类型」。</p>
                <Button
                  type="button"
                  variant="outline"
                  onPress={() => {
                    setQuery("");
                    setGenre(ALL_GENRES);
                  }}
                >
                  清空筛选
                </Button>
              </Card.Content>
            </Card>
          )}
        </>
      ) : (
        /* A fresh deployment can genuinely have nothing public: the shelf used to
           render a heading over blank space, which reads like a failure. */
        <Card className="empty-state-panel">
          <Card.Content>
            <h2>这里还没有公开的故事</h2>
            <p className="muted">
              别人公开的作品会出现在这里。现在最快的办法是自己搭一个——填完世界前提和起点就能试玩，
              设为公开后其他读者才看得到。
            </p>
            <Button type="button" onPress={onCreateStory}>
              去创作
            </Button>
          </Card.Content>
        </Card>
      )}
    </div>
  );
}

function parseShelfSort(key: unknown): ShelfSort {
  return SHELF_SORTS.some((option) => option.id === key) ? (key as ShelfSort) : "recent";
}

/**
 * Never-read stories sort last rather than first: a missing lastReadAt means "nobody
 * has been here", which is the opposite of recent. Ties fall back to the title so the
 * order is stable instead of depending on how the rows came out of the database.
 */
function compareForShelf(
  left: StorySummary,
  right: StorySummary,
  sort: ShelfSort,
  insights: Map<string, StoryReadingInsight>
): number {
  const byTitle = left.title.localeCompare(right.title, "zh-CN");
  if (sort === "title") {
    return byTitle;
  }

  const leftInsight = insights.get(left.id);
  const rightInsight = insights.get(right.id);

  if (sort === "readers") {
    return (rightInsight?.readers ?? 0) - (leftInsight?.readers ?? 0) || byTitle;
  }

  const leftRead = leftInsight?.lastReadAt ? Date.parse(leftInsight.lastReadAt) : 0;
  const rightRead = rightInsight?.lastReadAt ? Date.parse(rightInsight.lastReadAt) : 0;
  return rightRead - leftRead || byTitle;
}


function ContinueView({ quota, sessions }: { quota: TurnQuota; sessions: ReaderSessionListItem[] }) {

  return (
    <div className="app-section">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Continue</span>
          <h2 className="section-title">继续阅读</h2>
        </div>
        <Chip size="sm" variant="soft">{sessions.length} 个阅读进度</Chip>
      </div>
      {sessions.length ? (
        <div className="story-grid">
          {sessions.map((session) => (
            <ContinueStoryCard key={session.id} quota={quota} session={session} />

          ))}
        </div>
      ) : (
        <Card className="empty-state-panel">
          <Card.Content>
            <h2>还没有阅读进度</h2>
            <p className="muted">从“故事”选择一个世界进入后，会在这里显示最近进度。</p>
          </Card.Content>
        </Card>
      )}
    </div>
  );
}

function ContinueStoryCard({ quota, session }: { quota: TurnQuota; session: ReaderSessionListItem }) {

  const story = session.story;

  // The story is gone, so the only honest card says so. It used to disappear from
  // the shelf without a word, which read as lost reading rather than a deleted story.
  if (!story) {
    return (
      <Card className="story-card story-card-gone">
        <div className="story-cover" aria-hidden="true">
          <div className="story-cover-fallback">×</div>
        </div>
        <Card.Header className="story-card-header">
          <h2>{session.storyTitle}</h2>
          <p className="muted">作者已删除这个故事，这段阅读无法继续。</p>
        </Card.Header>
        <Card.Content className="story-card-content">
          <div className="tag-row compact">
            <Chip size="sm" variant="soft">身份：{session.readerRoleName}</Chip>
            <Chip size="sm" variant="soft">读到 {session.turnCount} 回合</Chip>
            <Chip size="sm" variant="soft">{formatUpdatedAt(session.updatedAt)}</Chip>
          </div>
          <p className="continue-summary">{session.latestSummary}</p>
          <div className="continue-actions">
            <form action={deleteSessionAction}>

              <input name="sessionId" type="hidden" value={session.id} />
              <Button className="danger-button" size="sm" type="submit" variant="outline">
                移除这张卡片
              </Button>
            </form>
          </div>
        </Card.Content>
      </Card>
    );
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
        <div className="tag-row compact">
          <Chip size="sm" variant="soft">身份：{session.readerRoleName}</Chip>
          <Chip size="sm" variant="soft">{session.turnCount} 回合</Chip>
          <Chip size="sm" variant="soft">{formatUpdatedAt(session.updatedAt)}</Chip>
          {/* An author's own trial sat here looking exactly like reading, while the
              story's reader numbers already excluded it. Marked, not hidden: the
              generations were real and came out of the same daily budget. */}
          {session.isAuthorTrial ? (
            <Chip className="trial-chip" size="sm" title="你自己的故事，这段是试玩；试玩同样计入今日配额" variant="soft">
              试玩
            </Chip>
          ) : null}
        </div>
        <p className="continue-summary">{session.latestSummary}</p>
        <QuotaExhaustedNote continuing quota={quota} />
        <div className="continue-actions">
          <a className="button-link" href={`/story/${session.id}`}>继续阅读</a>

          {/* Sessions only ever accumulated - every trial run of a story you are
              writing leaves one behind - and nothing could remove them. */}
          <form
            action={deleteSessionAction}
            onSubmit={(event) => {
              if (!window.confirm(`确认删除《${story.title}》的这段进度？${session.turnCount} 回合与存档都会被删除，无法撤销。`)) {
                event.preventDefault();
              }
            }}
          >
            <input name="sessionId" type="hidden" value={session.id} />
            <Button className="danger-button" size="sm" type="submit" variant="outline">
              删除进度
            </Button>
          </form>
        </div>
      </Card.Content>
    </Card>
  );
}

function CreateView({
  myStoryDetails,
  profiles,
  sessions,
  storyInsights
}: {
  myStoryDetails: StoryDetail[];
  profiles: ReaderProfile[];
  sessions: ReaderSessionListItem[];
  storyInsights: StoryReadingInsight[];
}) {
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
      <div className="creator-tabs">
        <button
          className={createTab === "profiles" ? "creator-tab active" : "creator-tab"}
          type="button"
          onClick={() => setCreateTab("profiles")}
        >
          角色库
        </button>
        <button
          className={createTab === "stories" ? "creator-tab active" : "creator-tab"}
          type="button"
          onClick={() => setCreateTab("stories")}
        >
          故事工作台
        </button>
      </div>
      {createTab === "profiles" ? (
        <CreatorProfilesPanel profiles={profiles} />
      ) : (
        <CreatorStoriesPanel
          myStoryDetails={myStoryDetails}
          profiles={profiles}
          sessions={sessions}
          storyInsights={storyInsights}
        />
      )}
    </div>
  );
}

function CreatorProfilesPanel({ profiles }: { profiles: ReaderProfile[] }) {
  return (
    <div className="creator-layer">
      <Card className="profile-panel">
        <Card.Header>
          <div>
            <span className="eyebrow">My Roles</span>
            <h2>我的角色</h2>
          </div>
        </Card.Header>
        <Card.Content>
          {profiles.length ? (
            <div className="profile-list">
              {profiles.map((profile) => (
                <details className="management-details" key={profile.id}>
                  <summary className="profile-card large management-summary">
                    <AvatarSeed name={profile.name} src={profile.avatarUrl} />
                    <div>
                      <strong>{profile.name}</strong>
                      <p>{profile.description}</p>
                      <div className="tag-row compact">
                        <Chip color="accent" size="sm" variant="soft">{profile.gender ?? "未设定性别"}</Chip>
                      </div>

                    </div>
                  </summary>
                  <ProfileEditForm profile={profile} />
                </details>
              ))}
            </div>
          ) : (
            <p className="muted">还没有角色。先创建一个入戏身份。</p>
          )}
        </Card.Content>
      </Card>
      <CreateProfilePanel />
    </div>
  );
}

/**
 * The daily budget as this reader's own number. The card used to state the allowance
 * ("每天 20 次推进，够读完一个晚上"), which is true of the product and silent about the
 * person reading it: someone with two turns left was told the same thing as someone
 * who had not started, and found out the difference from an error halfway through a
 * passage. The reset instant is formatted in the browser's timezone from an effect,
 * the same way the reader's toolbar does it - the quota day is a UTC day, so the
 * server's "tomorrow" is not the reader's.
 */
function QuotaSentence({ quota }: { quota: TurnQuota }) {
  const [resetLabel, setResetLabel] = useState<string | null>(null);

  useEffect(() => {
    setResetLabel(formatQuotaReset(quota.resetsAt));
  }, [quota.resetsAt]);

  if (quota.remainingTurnsToday > 0) {
    return (
      <span className="hero-quota-line">
        每天 {quota.dailyLimit} 次推进，你今天还剩 {quota.remainingTurnsToday} 次。
      </span>
    );
  }

  return (
    <span className="hero-quota-line">
      今天的 {quota.dailyLimit} 次推进已经用完{resetLabel ? `，${resetLabel} 后恢复` : ""}。
    </span>
  );
}

/**
 * Whether the beats the author planned are actually being reached. An author could
 * write 必经 anchors and never learn if a reader got to one: the anchors went into the
 * prompt and nothing came back. The passage now names the beat it advanced, and this
 * counts the readers per beat - a beat nobody has reached says so, which is the whole
 * point of asking.
 *
 * Only 必经 and 结局 anchors are listed: those are the ones the shelf counts as the
 * main line, and 可选 / 禁止 anchors are not promises about the path.
 *
 * The number is what the model reported, not ground truth - a passage that advanced a
 * beat without saying so is missing from it. Said plainly here so the count is not
 * read as more than it is.
 */
function AnchorReachLine({ anchors, insight }: { anchors: StoryAnchor[]; insight?: StoryReadingInsight }) {
  const mainLine = anchors.filter((anchor) => anchor.type === "required" || anchor.type === "ending");
  if (mainLine.length === 0) {
    return null;
  }

  const readersByAnchorId = new Map((insight?.anchorReach ?? []).map((row) => [row.anchorId, row.readers]));

  return (
    <span className="story-anchor-reach muted" title="按模型标注统计：没标注的段落不计入">
      {mainLine
        .map((anchor) => {
          const readers = readersByAnchorId.get(anchor.id) ?? 0;
          return `${anchor.title}：${readers === 0 ? "还没有人到过" : `${readers} 人到过`}`;
        })
        .join(" · ")}
    </span>
  );
}

/**
 * What the story has done with readers, on the row the author already looks at.


 * A story nobody has opened says so plainly rather than showing four zeros: the
 * author's own trials are excluded upstream, so zero really means zero.
 */
function ReadingInsightLine({ insight }: { insight?: StoryReadingInsight }) {
  if (!insight || insight.sessions === 0) {
    return <span className="story-insight muted">还没有人读过</span>;
  }

  return (
    <span className="story-insight">
      {insight.readers} 位读者 · {insight.sessions} 段进度 · 共 {insight.turns} 回合 · 最深{" "}
      {insight.deepestTurns} 回合
      {insight.lastReadAt ? ` · 最近 ${formatReadDate(insight.lastReadAt)}` : ""}
    </span>
  );
}

/** Date only: the hour a stranger read at is more precision than an author needs. */
function formatReadDate(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : `${parsed.getMonth() + 1} 月 ${parsed.getDate()} 日`;
}

function CreatorStoriesPanel({
  myStoryDetails,
  profiles,
  sessions,
  storyInsights
}: {
  myStoryDetails: StoryDetail[];
  profiles: ReaderProfile[];
  sessions: ReaderSessionListItem[];
  storyInsights: StoryReadingInsight[];
}) {
  const sessionsByStoryId = new Map(sessions.map((session) => [session.storyId, session]));
  const insightsByStoryId = new Map(storyInsights.map((insight) => [insight.storyId, insight]));

  return (
    <div className="creator-layer">
      <Card className="profile-panel">
        <Card.Header>
          <div>
            <span className="eyebrow">My Stories</span>
            <h2>我的故事</h2>
          </div>
        </Card.Header>
        <Card.Content>
          {myStoryDetails.length ? (
            <div className="story-management-list">
              {myStoryDetails.map((detail) => (
                <details className="management-details" key={detail.story.id}>
                  <summary className="story-management-item">
                    <div>
                      <strong>{detail.story.title}</strong>
                      <p>{detail.story.tagline}</p>
                      <ReadingInsightLine insight={insightsByStoryId.get(detail.story.id)} />
                      <AnchorReachLine anchors={detail.anchors} insight={insightsByStoryId.get(detail.story.id)} />

                    </div>
                    <div className="story-management-chips">
                      <Chip size="sm" variant="soft">{detail.story.genre}</Chip>
                      <Chip size="sm" variant="soft">{visibilityLabel(detail.story.visibility)}</Chip>
                    </div>
                  </summary>
                  <StoryEditForm
                    detail={detail}
                    existingSession={sessionsByStoryId.get(detail.story.id)}
                    profiles={profiles}
                  />
                </details>
              ))}
            </div>
          ) : (
            <p className="muted">还没有自己创建的故事。创建后会出现在这里。</p>
          )}
        </Card.Content>
      </Card>
      <CreateStoryPanel profiles={profiles} />
    </div>
  );
}

function ProfileEditForm({ profile }: { profile: ReaderProfile }) {
  const [result, action, pending] = useActionState(updateReaderProfileAction, IDLE_FORM);

  return (
    <div className="management-edit">
      <form className="profile-form embedded" action={action}>
        <input name="profileId" type="hidden" value={profile.id} />
        <div className="form-grid">
          <TextField defaultValue={kept(result, "name", profile.name)} isRequired name="name">
            <Label>名称</Label>
            <Input maxLength={40} />
          </TextField>
          <TextField defaultValue={kept(result, "gender", profile.gender ?? "")} name="gender">
            <Label>性别</Label>
            <Input maxLength={40} />
          </TextField>
        </div>
        <TextField defaultValue={kept(result, "personality", profile.personality)} isRequired name="personality">
          <Label>性格</Label>
          <TextArea maxLength={1200} rows={3} />
        </TextField>
        <TextField defaultValue={kept(result, "avatarUrl", profile.avatarUrl ?? "")} name="avatarUrl" type="url">
          <Label>头像 URL</Label>
          <Input />
        </TextField>
        <TextField defaultValue={kept(result, "description", profile.description)} isRequired name="description">

          <Label>身份背景</Label>
          <TextArea maxLength={2000} rows={3} />
        </TextField>
        <div className="management-actions">
          <Button isDisabled={pending} type="submit">
            {pending ? "保存中…" : "保存角色"}
          </Button>
          <FormFeedback result={result} />
        </div>
      </form>
      <form
        action={deleteReaderProfileAction}
        onSubmit={(event) => {
          if (!window.confirm(`确认删除角色「${profile.name}」？已创建故事中的演员快照不会被删除。`)) {
            event.preventDefault();
          }
        }}
      >
        <input name="profileId" type="hidden" value={profile.id} />
        <Button className="danger-button" type="submit" variant="outline">删除角色</Button>
      </form>
    </div>
  );
}

function StoryEditForm({
  detail,
  existingSession,
  profiles
}: {
  detail: StoryDetail;
  existingSession?: ReaderSessionListItem;
  profiles: ReaderProfile[];
}) {
  const openingLocation = detail.world.locations[0];
  const [result, action, pending] = useActionState(updateStoryAction, IDLE_FORM);

  return (
    <div className="management-edit">
      <StoryTrialLauncher existingSession={existingSession} profiles={profiles} story={detail.story} />
      <form className="profile-form embedded" action={action}>
        <input name="storyId" type="hidden" value={detail.story.id} />
        <section className="form-section">
          <div>
            <span className="eyebrow">展示信息</span>
            <h3>故事卡片</h3>
          </div>
          <div className="form-grid">
            <TextField defaultValue={kept(result, "title", detail.story.title)} isRequired name="title">
              <Label>标题</Label>
              <Input maxLength={80} />
            </TextField>
            <TextField defaultValue={kept(result, "genre", detail.story.genre)} isRequired name="genre">
              <Label>类型</Label>
              <Input maxLength={40} />
            </TextField>
          </div>
          <TextField defaultValue={kept(result, "tagline", detail.story.tagline)} isRequired name="tagline">
            <Label>一句话钩子</Label>
            <Input maxLength={160} />
          </TextField>
          <TextField defaultValue={kept(result, "coverUrl", detail.story.coverUrl ?? "")} name="coverUrl" type="url">
            <Label>封面图 URL</Label>
            <Input />
          </TextField>
          <Select defaultSelectedKey={kept(result, "visibility", detail.story.visibility)} name="visibility">
            <Label>可见性</Label>
            <Select.Trigger>
              <Select.Value />
              <Select.Indicator />
            </Select.Trigger>
            <Select.Popover>
              <ListBox>
                <ListBox.Item id="private" textValue="仅自己可见">仅自己可见<ListBox.ItemIndicator /></ListBox.Item>
                <ListBox.Item id="public" textValue="公开到故事探索">公开到故事探索<ListBox.ItemIndicator /></ListBox.Item>
              </ListBox>
            </Select.Popover>
          </Select>
        </section>

        <section className="form-section">
          <div>
            <span className="eyebrow">世界入口</span>
            <h3>开场设定</h3>
          </div>
          <TextField defaultValue={kept(result, "premise", detail.world.premise)} isRequired name="premise">
            <Label>世界前提</Label>
            <TextArea maxLength={4000} rows={4} />
          </TextField>
          <div className="form-grid">
            <TextField
              defaultValue={kept(result, "openingLocationName", openingLocation?.name ?? "")}
              isRequired
              name="openingLocationName"
            >
              <Label>起点地点</Label>
              <Input maxLength={80} />
            </TextField>
            <TextField
              defaultValue={kept(result, "openingLocationDescription", openingLocation?.description ?? "")}
              isRequired
              name="openingLocationDescription"
            >
              <Label>起点场景</Label>
              <TextArea maxLength={1000} rows={3} />
            </TextField>
          </div>
          <TextField defaultValue={kept(result, "worldRules", detail.world.rules.join("\n"))} name="worldRules">
            <Label>世界规则</Label>
            <TextArea maxLength={4000} rows={3} />
          </TextField>
        </section>

        <section className="form-section">
          <div>
            <span className="eyebrow">体验配置</span>
            <h3>AI 与阅读节奏</h3>
          </div>
          <div className="story-setting-grid">
            <Select defaultSelectedKey={kept(result, "experienceMode", detail.story.experienceMode)} name="experienceMode">
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
            <Select
              defaultSelectedKey={kept(result, "defaultSegmentLength", detail.story.defaultSegmentLength)}
              name="defaultSegmentLength"
            >
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
            <Select defaultSelectedKey={kept(result, "aiFreedom", detail.story.aiFreedom)} name="aiFreedom">
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
            <ReadingThemeSelect selected={parseReadingTheme(kept(result, "readingTheme", detail.story.readingTheme))} />
          </div>
        </section>
        <div className="management-actions">
          <Button isDisabled={pending} type="submit">
            {pending ? "保存中…" : "保存故事"}
          </Button>
          <FormFeedback result={result} />
        </div>
      </form>
      <section className="anchors-editor">
        <div>
          <span className="eyebrow">Anchors</span>
          <h3>剧情锚点</h3>
          <p className="muted">
            这是你对 AI 唯一的硬约束：必须发生的、禁止提前发生的、可以用来收尾的。写下来之后每一段生成都要照着走。
          </p>
        </div>
        <AnchorsEditForm detail={detail} />
      </section>
      {detail.characters.length ? (
        <section className="cast-editor">
          <div>
            <span className="eyebrow">Cast</span>
            <h3>故事演员</h3>
            <p className="muted">
              这些设定只属于这个故事。同一个角色可以在别的故事里是完全不同的人，改这里不会动你的角色库。
            </p>
          </div>
          {detail.characters.map((character) => (
            <CharacterEditForm character={character} key={character.id} />
          ))}
        </section>
      ) : null}
      <form
        action={deleteStoryAction}
        onSubmit={(event) => {
          if (!window.confirm(`确认删除《${detail.story.title}》？删除后无法从列表恢复。`)) {
            event.preventDefault();
          }
        }}
      >
        <input name="storyId" type="hidden" value={detail.story.id} />
        <Button className="danger-button" type="submit" variant="outline">删除故事</Button>
      </form>
    </div>
  );
}

/**
 * The plot anchors of one story: what must happen, what must not, and how it can
 * end. The rows live in client state rather than as repeated form fields, so
 * adding and removing one cannot shift a description onto the wrong anchor, and a
 * failed save leaves the table exactly as the author left it.
 */
function AnchorsEditForm({ detail }: { detail: StoryDetail }) {
  const [result, action, pending] = useActionState(updateStoryAnchorsAction, IDLE_FORM);
  const [rows, setRows] = useState<AnchorDraft[]>(() =>
    detail.anchors.map((anchor, index) => ({
      key: `${anchor.id}_${index}`,
      title: anchor.title,
      type: anchor.type,
      description: anchor.description
    }))
  );
  const [nextKey, setNextKey] = useState(0);

  function update(key: string, patch: Partial<AnchorDraft>) {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  return (
    <form className="profile-form embedded anchors-form" action={action}>
      <input name="storyId" type="hidden" value={detail.story.id} />
      <input
        name="anchors"
        type="hidden"
        value={JSON.stringify(
          rows.map((row) => ({ title: row.title, type: row.type, description: row.description }))
        )}
      />
      {rows.length ? (
        rows.map((row, index) => (
          <div className="anchor-row" key={row.key}>
            <div className="form-grid">
              <TextField value={row.title} onChange={(title) => update(row.key, { title })}>
                <Label>锚点 {index + 1}</Label>
                <Input maxLength={80} placeholder="尸体被发现" />
              </TextField>
              <Select
                selectedKey={row.type}
                onSelectionChange={(key) =>
                  update(row.key, { type: parseAnchorType(key) })
                }
              >
                <Label>约束方式</Label>
                <Select.Trigger>
                  <Select.Value />
                  <Select.Indicator />
                </Select.Trigger>
                <Select.Popover>
                  <ListBox>
                    <ListBox.Item id="required" textValue="必须发生">必须发生<ListBox.ItemIndicator /></ListBox.Item>
                    <ListBox.Item id="optional" textValue="可以发生">可以发生<ListBox.ItemIndicator /></ListBox.Item>
                    <ListBox.Item id="forbidden" textValue="禁止提前发生">禁止提前发生<ListBox.ItemIndicator /></ListBox.Item>
                    <ListBox.Item id="ending" textValue="可作为结局">可作为结局<ListBox.ItemIndicator /></ListBox.Item>
                  </ListBox>
                </Select.Popover>
              </Select>
            </div>
            <TextField value={row.description} onChange={(description) => update(row.key, { description })}>
              <Label>说明</Label>
              <TextArea maxLength={2000} placeholder="写清这件事的条件和后果，AI 会按它推进或回避。" rows={2} />
            </TextField>
            <Button
              className="danger-button"
              size="sm"
              type="button"
              variant="outline"
              onPress={() => setRows((current) => current.filter((item) => item.key !== row.key))}
            >
              删除这条
            </Button>
          </div>
        ))
      ) : (
        <p className="muted">还没有锚点。AI 只受世界规则约束，剧情会往哪走不好说。</p>
      )}
      <div className="management-actions">
        <Button
          size="sm"
          type="button"
          variant="outline"
          onPress={() => {
            setRows((current) => [
              ...current,
              { key: `draft_${nextKey}`, title: "", type: "required", description: "" }
            ]);
            setNextKey((key) => key + 1);
          }}
        >
          添加锚点
        </Button>
        <Button isDisabled={pending} type="submit">
          {pending ? "保存中…" : "保存锚点"}
        </Button>
        <FormFeedback result={result} />
      </div>
    </form>
  );
}

interface AnchorDraft {
  key: string;
  title: string;
  type: StoryAnchor["type"];
  description: string;
}

function parseAnchorType(key: unknown): StoryAnchor["type"] {
  return key === "optional" || key === "forbidden" || key === "ending" ? key : "required";
}

function CharacterEditForm({ character }: { character: CharacterProfile }) {
  const [result, action, pending] = useActionState(updateStoryCharacterAction, IDLE_FORM);

  return (
    <form className="profile-form embedded cast-form" action={action}>
      <input name="storyId" type="hidden" value={character.storyId} />
      <input name="characterId" type="hidden" value={character.id} />
      <input name="characterName" type="hidden" value={character.name} />
      <strong className="cast-name">{character.name}</strong>
      <TextField defaultValue={kept(result, "role", character.role)} isRequired name="role">
        <Label>故事身份</Label>
        <TextArea maxLength={2000} rows={2} />
      </TextField>
      <div className="form-grid">
        <TextField
          defaultValue={kept(result, "relationToReader", character.relationToReader)}
          name="relationToReader"
        >
          <Label>与读者的关系</Label>
          <TextArea maxLength={2000} rows={2} />
        </TextField>
        <TextField defaultValue={kept(result, "secret", character.secret)} name="secret">
          <Label>秘密（读者看不到，AI 只能暗示）</Label>
          <TextArea maxLength={2000} rows={2} />
        </TextField>
      </div>
      <div className="form-grid">
        <TextField defaultValue={kept(result, "goals", character.goals.join("\n"))} name="goals">
          <Label>当前目标（每行一条）</Label>
          <TextArea maxLength={2000} rows={3} />
        </TextField>
        <TextField defaultValue={kept(result, "personality", character.personality.join("\n"))} name="personality">
          <Label>性格（每行一条）</Label>
          <TextArea maxLength={2000} rows={3} />
        </TextField>
      </div>
      <TextField defaultValue={kept(result, "constraints", character.constraints.join("\n"))} name="constraints">
        <Label>不能做的事（每行一条）</Label>
        <TextArea maxLength={2000} rows={3} />
      </TextField>
      <div className="management-actions">
        <Button isDisabled={pending} type="submit">
          {pending ? "保存中…" : "保存演员"}
        </Button>
        <FormFeedback result={result} />
      </div>
    </form>
  );
}

function StoryTrialLauncher({
  existingSession,
  profiles,
  story
}: {
  existingSession?: ReaderSessionListItem;
  profiles: ReaderProfile[];
  story: StorySummary;
}) {
  const router = useRouter();
  const [readerProfileId, setReaderProfileId] = useState(profiles[0]?.id ?? TRIAL_DEFAULT_ROLE_KEY);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function startTrial() {
    setLoading(true);
    setError(null);

    try {
      const response = await createSession(story.id, readerProfileId === TRIAL_DEFAULT_ROLE_KEY ? null : readerProfileId);
      router.push(`/story/${response.session.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "试玩失败");
      setLoading(false);
    }
  }

  return (
    <div className="trial-launcher">
      <div>
        <span className="eyebrow">Preview</span>
        <h3>试玩这个故事</h3>
        <p className="muted">
          {existingSession
            ? "上次试玩还在，可以接着往下读，也可以从开场重新检查一遍。"
            : "以一个入戏身份进入开场，检查世界设定、角色上下文和阅读体验。"}
        </p>
      </div>
      <div className={existingSession ? "trial-launcher-controls has-trial" : "trial-launcher-controls"}>
        <Select
          className="instory-select"
          selectedKey={readerProfileId}
          onSelectionChange={(key) => setReaderProfileId(typeof key === "string" ? key : TRIAL_DEFAULT_ROLE_KEY)}
        >
          <Label>试玩身份</Label>
          <Select.Trigger>
            <Select.Value />
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover>
            <ListBox>
              <ListBox.Item id={TRIAL_DEFAULT_ROLE_KEY} textValue="默认角色（由故事指定）">
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
        {existingSession ? (
          // Before this every 试玩 built another session, so checking the opening
          // twice left two identical progress cards and no way to tell them apart.
          <>
            <Button isDisabled={loading} onPress={() => router.push(`/story/${existingSession.id}`)}>
              回到上次试玩（{existingSession.turnCount} 回合）
            </Button>
            <Button isDisabled={loading} variant="outline" onPress={startTrial}>
              {loading ? "进入中..." : "从开场重新试玩"}
            </Button>
          </>
        ) : (
          <Button isDisabled={loading} onPress={startTrial}>
            {loading ? "进入中..." : "试玩故事"}
          </Button>
        )}
      </div>
      {error ? <p className="error">{error}</p> : null}
    </div>
  );
}


function CreateStoryPanel({ profiles }: { profiles: ReaderProfile[] }) {
  const [result, action, pending] = useActionState(createStoryAction, IDLE_FORM);

  return (
    <Card className="profile-panel create-story-panel">
      <Card.Header>
        <div>
          <span className="eyebrow">Create Story</span>
          <h2>创建故事世界</h2>
        </div>
      </Card.Header>
      <Card.Content>
        <form className="profile-form embedded" action={action}>
          <section className="form-section">
            <div>
              <span className="eyebrow">Step 1</span>
              <h3>展示信息</h3>
            </div>
            <div className="form-grid">
              {/* The rules live in the label because they are only discoverable
                  there: breaking them used to surface as a bare「创建故事失败」after
                  submitting. */}
              <TextField defaultValue={submitted(result, "id")} isRequired name="id">
                <Label>故事 ID（小写字母、数字、连字符，至少 3 位）</Label>
                <Input maxLength={80} placeholder="moon-market" />
              </TextField>
              <TextField defaultValue={submitted(result, "title")} isRequired name="title">
                <Label>标题</Label>
                <Input maxLength={80} placeholder="月下市集" />
              </TextField>
            </div>
            <div className="form-grid">
              <TextField defaultValue={submitted(result, "genre")} isRequired name="genre">
                <Label>类型</Label>
                <Input maxLength={40} placeholder="奇幻悬疑" />
              </TextField>
              <TextField defaultValue={submitted(result, "tagline")} isRequired name="tagline">
                <Label>一句话钩子</Label>
                <Input maxLength={160} placeholder="你在午夜市集里寻找被偷走的名字。" />
              </TextField>
            </div>
            <TextField defaultValue={submitted(result, "coverUrl")} name="coverUrl" type="url">
              <Label>封面图 URL</Label>
              <Input placeholder="用于故事卡片展示，后续可接上传或 AI 生图" />
            </TextField>
            <Select defaultSelectedKey="private" name="visibility">
              <Label>可见性</Label>
              <Select.Trigger>
                <Select.Value />
                <Select.Indicator />
              </Select.Trigger>
              <Select.Popover>
                <ListBox>
                  <ListBox.Item id="private" textValue="仅自己可见">仅自己可见<ListBox.ItemIndicator /></ListBox.Item>
                  <ListBox.Item id="public" textValue="公开到故事探索">公开到故事探索<ListBox.ItemIndicator /></ListBox.Item>
                </ListBox>
              </Select.Popover>
            </Select>
          </section>

          <section className="form-section">
            <div>
              <span className="eyebrow">Step 2</span>
              <h3>世界入口</h3>
            </div>
            <TextField defaultValue={submitted(result, "premise")} isRequired name="premise">
              <Label>世界前提</Label>
              <TextArea maxLength={4000} placeholder="这个世界如何运转，读者会被卷入什么冲突。" rows={4} />
            </TextField>
            <div className="form-grid">
              <TextField
                defaultValue={submitted(result, "openingLocationName")}
                isRequired
                name="openingLocationName"
              >
                <Label>起点地点</Label>
                <Input maxLength={80} placeholder="市集入口" />
              </TextField>
              <TextField
                defaultValue={submitted(result, "openingLocationDescription")}
                isRequired
                name="openingLocationDescription"
              >
                <Label>起点场景</Label>
                <TextArea maxLength={1000} placeholder="读者进入故事后看到的第一幕。" rows={3} />
              </TextField>
            </div>
            <TextField defaultValue={submitted(result, "worldRules")} name="worldRules">
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
              <ReadingThemeSelect selected={DEFAULT_READING_THEME} />
            </div>
          </section>
          <Button isDisabled={pending} type="submit">
            {pending ? "创建中…" : "创建故事"}
          </Button>
          <FormFeedback result={result} />
        </form>
      </Card.Content>
    </Card>
  );
}

function CreateProfilePanel() {
  const [result, action, pending] = useActionState(createReaderProfileAction, IDLE_FORM);

  return (
    <Card className="profile-panel create-profile-panel">
      <Card.Header>
        <div>
          <span className="eyebrow">Create Profile</span>
          <h2>创建入戏角色</h2>
        </div>
      </Card.Header>
      <Card.Content>
        <form className="profile-form embedded" action={action}>
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
            <TextArea maxLength={2000} placeholder="一句话交代来历、动机和最在意的事，例如：退役军医，为寻回失踪的妹妹而来。" rows={3} />
          </TextField>
          <Button isDisabled={pending} type="submit">
            {pending ? "创建中…" : "创建入戏角色"}
          </Button>
          <FormFeedback result={result} />
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

function visibilityLabel(visibility: "private" | "public") {
  return visibility === "public" ? "公开" : "仅自己可见";
}

/**
 * One line of "it worked" or "it did not", next to the button that caused it.
 * Before this the only signal was the page quietly revalidating, and a failure
 * threw the reader onto the framework's error page along with their input.
 */
function FormFeedback({ result }: { result: FormResult }) {
  if (result.status === "idle") {
    return null;
  }

  return (
    <p
      className={`form-feedback ${result.status === "ok" ? "is-ok" : "is-error"}`}
      role={result.status === "ok" ? "status" : "alert"}
    >
      {result.message}
    </p>
  );
}

function formatUpdatedAt(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function experienceModeLabel(mode: StorySummary["experienceMode"]) {
  return mode === "scripted" ? "剧本入戏" : mode === "improvised" ? "即兴入戏" : "共演入戏";
}

function segmentLengthLabel(length: StorySummary["defaultSegmentLength"]) {
  return length === "short" ? "短段" : length === "long" ? "长小节" : "标准小节";
}

