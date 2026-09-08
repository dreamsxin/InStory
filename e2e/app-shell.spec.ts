import { expect, test } from "@playwright/test";
import { E2E_API_BASE as API_BASE } from "../playwright.config.js";
const PASSWORD = "e2e-password-123";
/** Matches playwright.config.ts, and is the console's bootstrap credential. */
const ADMIN_TOKEN = "e2e-admin-token-0123456789abcdef0123456789abcdef";

/** Registers through the API, hands the browser the cookie, and returns the account. */
async function signIn(
  page: import("@playwright/test").Page,
  request: import("@playwright/test").APIRequestContext,
  email: string
): Promise<{ token: string; userId: string }> {
  const response = await request.post(`${API_BASE}/api/auth/register`, {
    data: { email, displayName: "E2E 外壳", password: PASSWORD }
  });
  expect(response.status()).toBe(201);
  const { token, user } = (await response.json()) as { token: string; user: { id: string } };

  await page.context().addCookies([
    { name: "instory_session", value: token, domain: "127.0.0.1", path: "/", httpOnly: true, sameSite: "Lax" }
  ]);

  return { token, userId: user.id };
}

/** True when the page itself scrolls, which is what an app-like shell must avoid. */
async function documentScrolls(page: import("@playwright/test").Page): Promise<boolean> {
  return page.evaluate(() => {
    const root = document.documentElement;
    // A pixel of slack: sub-pixel layout rounding shows up as a 0.5px overflow.
    return root.scrollHeight > root.clientHeight + 1 || document.body.scrollHeight > root.clientHeight + 1;
  });
}

async function overflowY(page: import("@playwright/test").Page, selector: string): Promise<string> {
  return page.locator(selector).evaluate((element) => getComputedStyle(element).overflowY);
}

test.describe("app-like shell", () => {
  test("the reader scrolls its transcript, not the page", async ({ page, request }) => {
    const { token } = await signIn(page, request, "e2e-shell-reader@example.com");

    const created = await request.post(`${API_BASE}/api/stories/rain-mansion/sessions`, {
      headers: { authorization: `Bearer ${token}` },
      data: { entryMode: "existing_character", characterId: "lu_qinghe" }
    });
    expect(created.status()).toBe(200);
    const sessionId = ((await created.json()) as { session: { id: string } }).session.id;

    await page.goto(`/story/${sessionId}`);
    await expect(page.locator(".turn").first()).toBeVisible();

    expect(await documentScrolls(page)).toBe(false);
    expect(await overflowY(page, ".reader-scroll")).toBe("auto");

    // The seeded story is 悬疑, so it reads inside the gothic frame. The frame has
    // to sit on the scroll window itself, otherwise it would only be visible at
    // the very top and bottom of the whole transcript.
    await expect(page.locator(".reader-shell")).toHaveAttribute("data-reading-theme", "gothic-mystery");
    const frame = await page.locator(".reader-scroll").evaluate((element) => {
      const style = getComputedStyle(element);
      return { width: style.borderTopWidth, source: style.borderImageSource };
    });
    expect(Number.parseFloat(frame.width)).toBeGreaterThan(0);
    expect(frame.source).toContain("data:image/svg+xml");

    // HeroUI paints its own button labels near-black, which the dark themes have to
    // override or the controls on the page turn into blank pills.
    const labelLuminance = await page
      .locator(".reading-intervention-bar .button--outline")
      .evaluate((element) => {
        const channels = (getComputedStyle(element).color.match(/[\d.]+/g) ?? ["0", "0", "0"])
          .slice(0, 3)
          .map((value) => Number.parseFloat(value) / 255)
          .map((value) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
        return 0.2126 * (channels[0] ?? 0) + 0.7152 * (channels[1] ?? 0) + 0.0722 * (channels[2] ?? 0);
      });
    expect(labelLuminance).toBeGreaterThan(0.5);
  });

  test("the home screen scrolls its tab panel, not the page", async ({ page, request }) => {
    await signIn(page, request, "e2e-shell-home@example.com");

    await page.goto("/");
    await expect(page.locator(".app-topbar")).toBeVisible();

    expect(await documentScrolls(page)).toBe(false);
    expect(await overflowY(page, ".mobile-tab-panel")).toBe("auto");

    // The account controls belong to the chrome, so they must stay on screen.
    await expect(page.locator(".app-topbar .account-bar")).toBeVisible();

    // A reader with no progress is told what this place is; the card used to say
    // "MVP Workspace" and nothing about reading. It is also the first-run variant,
    // which is what keeps it on screen at phone widths.
    const intro = page.locator(".app-hero");
    await expect(intro).toContainText("主角就是你");
    await expect(intro).toHaveClass(/is-first-run/);


    // One card per story, sized like a card. A lone story used to fill the whole
    // grid row (auto-fit collapses empty tracks), so its 16/9 cover alone made a
    // ~900px slab; rows also have to size to content, not to the panel height.
    await expect(page.locator(".story-card")).toHaveCount(1);
    // The card now says how long the story is, from the two facts that can be known:
    // the seed's 3 必经 anchors and the 1200 words its 长小节 asks for. Before this a
    // reader could not tell an evening's read from three minutes.
    await expect(page.locator(".story-expectation")).toHaveText("主线 3 个节点 · 每段约 1200 字 · 约 9 分钟起");
    expect(await page.locator(".story-grid").evaluate((el) => getComputedStyle(el).alignContent)).toBe("start");

    const card = (await page.locator(".story-card").first().boundingBox()) ?? { height: 0, width: 0 };
    const grid = (await page.locator(".story-grid").boundingBox()) ?? { height: 0, width: 0 };
    expect(card.width).toBeGreaterThan(0);
    // Empty tracks are kept, so the single card occupies one column, not the row.
    expect(card.width).toBeLessThan(grid.width / 2);
    // And it is not stretched: the row is exactly as tall as the card.
    expect(grid.height).toBeCloseTo(card.height, 0);

  });

  test("the shelf can be searched, filtered and sorted", async ({ page, request }) => {
    const { token } = await signIn(page, request, "e2e-shelf-filter@example.com");

    // Two public stories of different genres, so filtering has something to do. The
    // seeded 雨夜旧宅 is the third. They are removed at the end: later specs assert on
    // the shelf, and this suite shares one database on purpose.
    const created: string[] = [];
    for (const story of [
      { id: `e2e-shelf-tea-${Date.now()}`, title: "茶馆密约", genre: "民国谍战" },
      { id: `e2e-shelf-void-${Date.now()}`, title: "虚空邮差", genre: "太空歌剧" }
    ]) {
      const response = await request.post(`${API_BASE}/api/stories`, {
        headers: { authorization: `Bearer ${token}` },
        data: {
          id: story.id,
          title: story.title,
          tagline: `${story.title}的一句钩子`,
          genre: story.genre,
          coverUrl: null,
          visibility: "public",
          readingTheme: "classic",
          experienceMode: "coauthored",
          defaultSegmentLength: "standard",
          premise: "一段用于筛选测试的世界前提。",
          openingLocationName: "起点",
          openingLocationDescription: "第一幕的场景描写。",
          worldRules: []
        }
      });
      expect(response.status()).toBe(201);
      created.push(story.id);
    }


    await page.goto("/");
    await expect(page.locator(".story-card")).toHaveCount(3);

    // Search covers title, tagline and genre - a reader looking for a story types
    // whichever of the three they remember.
    await page.getByLabel("搜索").fill("邮差");
    await expect(page.locator(".story-card")).toHaveCount(1);
    await expect(page.locator(".story-card")).toContainText("虚空邮差");
    // These two were created without anchors, so the card says the length is open
    // rather than inventing a number for a story nobody has planned beats for.
    await expect(page.locator(".story-expectation")).toContainText("没有预设主线节点");

    // No match is not the same as "nothing is public": the shelf used to have only
    // the latter panel, which would tell someone who mistyped to go create a story.
    await page.getByLabel("搜索").fill("没有这个故事");
    await expect(page.locator(".story-card")).toHaveCount(0);
    const noMatch = page.locator(".empty-state-panel");
    await expect(noMatch).toContainText("没有符合条件的故事");
    await noMatch.getByRole("button", { name: "清空筛选" }).click();
    await expect(page.locator(".story-card")).toHaveCount(3);

    // Sorting by title is the one order that does not depend on reading history, so
    // it is the one that can be asserted exactly.
    await page.getByLabel("排序").click();
    await page.getByRole("option", { name: "按标题" }).click();
    const titles = await page.locator(".story-card h2").allInnerTexts();
    expect(titles).toEqual([...titles].sort((left, right) => left.localeCompare(right, "zh-CN")));

    for (const storyId of created) {
      const removed = await request.delete(`${API_BASE}/api/me/stories/${storyId}`, {
        headers: { authorization: `Bearer ${token}` }
      });
      expect(removed.status()).toBe(204);
    }
  });

  test("the console keeps its header pinned and scrolls the rest", async ({ page, request }) => {
    const { userId } = await signIn(page, request, "e2e-shell-admin@example.com");

    // The console renders real model config and sessions, so the page checks the
    // account's role. Promotion goes through the token, as it would in production.
    const promoted = await request.put(`${API_BASE}/api/admin/users/${userId}/role`, {
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
      data: { role: "admin" }
    });
    expect(promoted.status()).toBe(200);

    await page.goto("/admin");
    const header = page.locator(".admin-header");
    await expect(header).toBeVisible();

    // The console can now answer "who has an account" without opening the database:
    // the role endpoint existed, but nothing listed the ids it needs.
    const users = page.locator("#users");
    await expect(users).toContainText("e2e-shell-admin@example.com");
    await expect(users.locator("tr", { hasText: "e2e-shell-admin@example.com" })).toContainText(
      "当前登录"
    );

    // And it says who is using it, with a way out: signing out used to mean going
    // back to the client first, because the console had no account bar at all.
    const bar = page.locator(".admin-header .account-bar");
    await expect(bar).toContainText("e2e-shell-admin@example.com");
    await expect(bar.getByRole("button", { name: "退出登录" })).toBeVisible();



    expect(await documentScrolls(page)).toBe(false);
    expect(await overflowY(page, ".admin-shell")).toBe("auto");

    // Scroll the shell to the bottom; the header has to still be there.
    await page.locator(".admin-shell").evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect(header).toBeInViewport();
  });

  test("the console turns away an account that is not an administrator", async ({ page, request }) => {
    await signIn(page, request, "e2e-shell-reader-admin@example.com");

    // Anyone who typed the address used to be served the console in full.
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator(".admin-header")).toHaveCount(0);
    // And a reader is never offered the way in.
    await expect(page.locator(".account-bar a")).toHaveCount(0);
  });

  test("the sign-in screen fits one screen and never scrolls the page", async ({ page }) => {
    await page.goto("/login");
    await expect(page.locator(".auth-card")).toBeVisible();

    expect(await documentScrolls(page)).toBe(false);
    expect(await overflowY(page, ".auth-page")).toBe("auto");

    // The taller of the two forms must still not push the document.
    await page.goto("/login?mode=register");
    await expect(page.getByLabel("昵称")).toBeVisible();
    expect(await documentScrolls(page)).toBe(false);
  });
});
