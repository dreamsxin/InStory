import type { CharacterProfile, CreateStoryRequest, StoryAnchor } from "@instory/shared";
import type { ReaderProfileStore } from "../db/reader-profile-store.js";
import type { UserRole, UserStore } from "../db/user-store.js";
import type { StoryCatalog } from "./story-catalog.js";

/**
 * The demo accounts a fresh install starts with, so the first person to open the app
 * can sign in as each kind of user instead of registering three accounts and hunting
 * for a way to hand out the admin role.
 *
 * Deliberately at instory.local: a reserved TLD can never belong to a real person, so
 * these can never collide with, or shadow, a genuine address.
 */
export const DEMO_ACCOUNTS: Array<{ email: string; displayName: string; role: UserRole }> = [
  { email: "admin@instory.local", displayName: "示例管理员", role: "admin" },
  { email: "author@instory.local", displayName: "示例作者", role: "reader" },
  { email: "reader@instory.local", displayName: "示例读者", role: "reader" }
];

/** Documented in README and .env.example; override with DEMO_PASSWORD. */
export const DEMO_PASSWORD_FALLBACK = "instory-demo-2026";

interface DemoStory {
  request: CreateStoryRequest;
  characters: Array<Omit<CharacterProfile, "storyId">>;
  anchors: Array<Omit<StoryAnchor, "id" | "storyId">>;
}

export interface DemoBootstrapResult {
  /** Empty when the accounts were already there, so a restart is a no-op. */
  createdAccounts: string[];
  createdStories: string[];
}

/**
 * Two stories the 示例作者 account owns, on top of the platform's own 雨夜旧宅. They
 * exist so a fresh install has a shelf worth looking at: different genres and framing
 * for the filters, and one with planned beats against one without, which are the two
 * shapes the length line on a card has to handle.
 */
const DEMO_STORIES: DemoStory[] = [
  {
    request: {
      id: "moon-market",
      title: "月下市集",
      tagline: "午夜的市集只收记忆，你要赎回自己的名字。",
      genre: "奇幻悬疑",
      coverUrl: null,
      readingTheme: "eastern-ink",
      premise:
        "午夜之后，城市背面会浮出一座只对失去名字的人开放的市集。每一次交易都要付出一段记忆，而你的名字已经被人先一步卖掉了一半。",
      openingLocationName: "市集入口",
      openingLocationDescription: "湿漉漉的石阶向下延伸，灯笼照出一排没有影子的摊位。",
      worldRules: [
        "任何人不能在市集里直接说出自己的真名。",
        "每一次交易都要付出一段具体的记忆，摊主会当场取走。",
        "天亮之前离开市集，当晚的交易全部作废。"
      ],
      visibility: "public",
      aiFreedom: "medium",
      experienceMode: "coauthored",
      defaultSegmentLength: "standard"
    },
    characters: [
      {
        id: "moon-market-linxiangwan",
        name: "林向晚",
        role: "在市集里替人验货的旧识",
        relationToReader: "把你当成唯一还能说真话的人",
        secret: "她自己的名字已经卖掉了一半",
        personality: ["冷静", "敏锐"],
        goals: ["找回自己名字的另一半", "弄清是谁在收购名字"],
        constraints: ["不会替你付出记忆", "不会在摊主面前承认认识你"]
      },
      {
        id: "moon-market-shopkeeper",
        name: "戴斗笠的摊主",
        role: "收购名字的中间人",
        relationToReader: "把你当成一笔尚未谈成的交易",
        secret: "他手上就有你名字的另一半",
        personality: ["和气", "算计"],
        goals: ["用最小的代价买到完整的名字"],
        constraints: ["不会主动提起你名字的下家", "不会在天亮前离开摊位"]
      }
    ],
    anchors: [
      { title: "发现名字被交易过", type: "required", description: "读者必须意识到自己的名字已经被卖掉一半。" },
      { title: "找到收购名字的人", type: "required", description: "读者应通过交易、观察或冒险找到中间人。" },
      { title: "带着完整的名字离开市集", type: "ending", description: "读者赎回名字并在天亮前离开，故事可以收束。" }
    ]
  },
  {
    request: {
      id: "void-postman",
      title: "虚空邮差",
      tagline: "你送的最后一封信，收件人已经死了三年。",
      genre: "太空歌剧",
      coverUrl: null,
      readingTheme: "cyber-frontier",
      premise:
        "跃迁航路上的信件要靠人押送。你是这条航线上最后一名邮差，行囊里那封信的收件人，三年前就已经在官方记录里死亡。",
      openingLocationName: "中继站的信舱",
      openingLocationDescription: "货架上只剩一个信袋，舱壁的循环风带着铁锈味。",
      worldRules: [
        "跃迁途中不能打开任何一封别人的信。",
        "官方记录一旦写下死亡就不会更正。"
      ],
      visibility: "public",
      aiFreedom: "high",
      experienceMode: "improvised",
      defaultSegmentLength: "short"
    },
    characters: [
      {
        id: "void-postman-dispatcher",
        name: "调度员 K",
        role: "中继站唯一还在值班的调度员",
        relationToReader: "既是你的上级，也是你唯一的说话对象",
        secret: "这封信是他压下来的",
        personality: ["疲惫", "守规矩"],
        goals: ["让这条航线安静地关闭"],
        constraints: ["不会承认自己看过信的内容"]
      }
    ],
    // No anchors on purpose: an improvised story is the case where the shelf must say
    // the length is open instead of inventing a number.
    anchors: []
  }
];

/**
 * Fills a fresh install with the three kinds of account and something to read.
 *
 * Idempotent per item, not in one shot: an address that already exists is reused and
 * never rewritten (resetting a registered account's password or role on every boot
 * would be a back door), and a story id already in use is left alone. So a restart
 * adds nothing, and a half-set install gets only its missing half.
 *
 * Stories are created through the ordinary owner-scoped path, so nothing here needs a
 * privilege the app does not already have.
 *
 * The caller decides whether to run this at all - see main.ts. Creating accounts whose
 * password is written in the README is a deliberate convenience for a local install
 * and a hazard anywhere else.
 */
export function bootstrapDemoData(options: {
  userStore: UserStore;
  storyCatalog: StoryCatalog;
  readerProfileStore: ReaderProfileStore;
  password: string;
}): DemoBootstrapResult {
  const result: DemoBootstrapResult = { createdAccounts: [], createdStories: [] };
  const ids = new Map<string, string>();

  for (const account of DEMO_ACCOUNTS) {
    const existing = options.userStore.findByEmail(account.email);
    if (existing) {
      // Left exactly as it is: an address that is already registered belongs to
      // whoever registered it, and resetting its password or role on every boot
      // would be a back door, not a convenience.
      ids.set(account.email, existing.id);
      continue;
    }

    const user = options.userStore.create({
      email: account.email,
      displayName: account.displayName,
      password: options.password,
      role: account.role
    });
    ids.set(account.email, user.id);
    result.createdAccounts.push(account.email);
  }

  const authorId = ids.get("author@instory.local");
  const readerId = ids.get("reader@instory.local");

  if (authorId) {
    for (const story of DEMO_STORIES) {
      // An id the operator already used wins: their story is real content, this is
      // scaffolding.
      if (options.storyCatalog.findStory(story.request.id)) {
        continue;
      }

      options.storyCatalog.createStory(
        story.request,
        story.characters.map((character) => ({ ...character, storyId: story.request.id })),
        authorId
      );

      if (story.anchors.length > 0) {
        options.storyCatalog.replaceOwnedAnchors(story.request.id, authorId, { anchors: story.anchors });
      }

      result.createdStories.push(story.request.id);
    }
  }

  // Only when the reader has none: without a profile the 入戏身份 select on every card
  // offers just 默认角色, and adding another one on every restart would be its own bug.
  if (readerId && options.readerProfileStore.listByOwner(readerId).length === 0) {
    options.readerProfileStore.create({
      ownerId: readerId,
      name: "江照",
      gender: "女",
      personality: "好奇，胆子比自己以为的大",
      description: "一个刚学会在别人的故事里说话的读者。",
      visibility: "private"
    });
  }

  return result;
}



