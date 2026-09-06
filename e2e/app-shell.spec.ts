import { expect, test } from "@playwright/test";

const API_BASE = "http://127.0.0.1:4000";
const PASSWORD = "e2e-password-123";

/** Registers through the API, hands the browser the cookie, and returns the token. */
async function signIn(
  page: import("@playwright/test").Page,
  request: import("@playwright/test").APIRequestContext,
  email: string
): Promise<string> {
  const response = await request.post(`${API_BASE}/api/auth/register`, {
    data: { email, displayName: "E2E 外壳", password: PASSWORD }
  });
  expect(response.status()).toBe(201);
  const { token } = (await response.json()) as { token: string };

  await page.context().addCookies([
    { name: "instory_session", value: token, domain: "127.0.0.1", path: "/", httpOnly: true, sameSite: "Lax" }
  ]);

  return token;
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
    const token = await signIn(page, request, "e2e-shell-reader@example.com");

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

    // One card per story, sized like a card. A lone story used to fill the whole
    // grid row (auto-fit collapses empty tracks), so its 16/9 cover alone made a
    // ~900px slab; rows also have to size to content, not to the panel height.
    await expect(page.locator(".story-card")).toHaveCount(1);
    expect(await page.locator(".story-grid").evaluate((el) => getComputedStyle(el).alignContent)).toBe("start");

    const card = (await page.locator(".story-card").first().boundingBox()) ?? { height: 0, width: 0 };
    const grid = (await page.locator(".story-grid").boundingBox()) ?? { height: 0, width: 0 };
    expect(card.width).toBeGreaterThan(0);
    // Empty tracks are kept, so the single card occupies one column, not the row.
    expect(card.width).toBeLessThan(grid.width / 2);
    // And it is not stretched: the row is exactly as tall as the card.
    expect(grid.height).toBeCloseTo(card.height, 0);

  });

  test("the console keeps its header pinned and scrolls the rest", async ({ page, request }) => {
    await signIn(page, request, "e2e-shell-admin@example.com");

    await page.goto("/admin");
    const header = page.locator(".admin-header");
    await expect(header).toBeVisible();

    expect(await documentScrolls(page)).toBe(false);
    expect(await overflowY(page, ".admin-shell")).toBe("auto");

    // Scroll the shell to the bottom; the header has to still be there.
    await page.locator(".admin-shell").evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect(header).toBeInViewport();
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
