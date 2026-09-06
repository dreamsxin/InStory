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
  });

  test("the home screen scrolls its tab panel, not the page", async ({ page, request }) => {
    await signIn(page, request, "e2e-shell-home@example.com");

    await page.goto("/");
    await expect(page.locator(".app-topbar")).toBeVisible();

    expect(await documentScrolls(page)).toBe(false);
    expect(await overflowY(page, ".mobile-tab-panel")).toBe("auto");

    // The account controls belong to the chrome, so they must stay on screen.
    await expect(page.locator(".app-topbar .account-bar")).toBeVisible();
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
