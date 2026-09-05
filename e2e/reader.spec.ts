import { expect, test } from "@playwright/test";

const API_BASE = "http://127.0.0.1:4000";
const PASSWORD = "e2e-password-123";

interface Registration {
  token: string;
  displayName: string;
}

/**
 * Sets up reader state through the API and hands the browser the matching session
 * cookie. Going through the API keeps this spec focused on the reader itself rather
 * than on the details of the home page's story cards.
 */
async function signInViaApi(
  page: import("@playwright/test").Page,
  request: import("@playwright/test").APIRequestContext,
  email: string,
  displayName: string
): Promise<Registration> {
  const response = await request.post(`${API_BASE}/api/auth/register`, {
    data: { email, displayName, password: PASSWORD }
  });
  expect(response.status()).toBe(201);
  const { token } = (await response.json()) as { token: string };

  await page.context().addCookies([
    { name: "instory_session", value: token, domain: "127.0.0.1", path: "/", httpOnly: true, sameSite: "Lax" }
  ]);

  return { token, displayName };
}

async function startSession(
  request: import("@playwright/test").APIRequestContext,
  token: string
): Promise<string> {
  const response = await request.post(`${API_BASE}/api/stories/rain-mansion/sessions`, {
    headers: { authorization: `Bearer ${token}` },
    data: { entryMode: "existing_character", characterId: "lu_qinghe" }
  });
  expect(response.status()).toBe(200);
  const body = (await response.json()) as { session: { id: string } };
  return body.session.id;
}

test.describe("reader", () => {
  test("streams a new passage and keeps it after a reload", async ({ page, request }) => {
    const { token } = await signInViaApi(page, request, "e2e-reader@example.com", "E2E 读者");
    const sessionId = await startSession(request, token);

    await page.goto(`/story/${sessionId}`);
    // The opening turn is rendered from the story's own world config.
    await expect(page.locator(".turn").first()).toContainText("旧宅东厢房");

    const turnsBefore = await page.locator(".turn").count();

    await page.getByRole("button", { name: /继续阅读/ }).click();

    // The in-progress turn appears while the model is still writing.
    await expect(page.locator(".turn-streaming")).toBeVisible();
    await expect(page.getByRole("button", { name: "停止生成" })).toBeVisible();

    // It resolves into a real turn, and the placeholder goes away.
    await expect(page.locator(".turn-streaming")).toBeHidden();
    await expect(page.locator(".turn")).toHaveCount(turnsBefore + 1);

    const narration = await page.locator(".turn").last().innerText();
    expect(narration.length).toBeGreaterThan(20);

    // Persisted, not just held in component state.
    await page.reload();
    await expect(page.locator(".turn")).toHaveCount(turnsBefore + 1);
    await expect(page.locator(".turn").last()).toContainText(narration.slice(0, 12));
  });

  test("shows the remaining daily quota after advancing", async ({ page, request }) => {
    const { token } = await signInViaApi(page, request, "e2e-quota@example.com", "E2E 配额");
    const sessionId = await startSession(request, token);

    await page.goto(`/story/${sessionId}`);
    await page.getByRole("button", { name: /继续阅读/ }).click();
    await expect(page.locator(".turn-streaming")).toBeHidden();

    await expect(page.locator(".quota-chip")).toContainText("今日剩余");
    // Visible, not merely present: the bar used to carry the hidden-chrome class
    // unconditionally with no button to turn it back on.
    await expect(page.locator(".quota-chip")).toBeVisible();
  });

  test("names the story it is actually playing, and can hide the bar", async ({ page, request }) => {
    const { token } = await signInViaApi(page, request, "e2e-title@example.com", "E2E 标题");
    const sessionId = await startSession(request, token);

    // Read the expected title from the API so a hardcoded literal cannot pass.
    const detail = await request.get(`${API_BASE}/api/stories/rain-mansion`);
    const expectedTitle = ((await detail.json()) as { story: { title: string } }).story.title;

    await page.goto(`/story/${sessionId}`);

    const heading = page.locator(".reader-topbar h1");
    await expect(heading).toHaveText(expectedTitle);

    await page.getByRole("button", { name: "沉浸阅读" }).click();
    await expect(heading).toBeHidden();

    await page.getByRole("button", { name: "显示信息栏" }).click();
    await expect(heading).toBeVisible();
  });

  test("loads older turns on demand instead of shipping the whole transcript", async ({
    page,
    request
  }) => {
    const { token } = await signInViaApi(page, request, "e2e-history@example.com", "E2E 历史");
    const sessionId = await startSession(request, token);

    // Advance through the API so the test spends its time on the UI, not on
    // waiting for six streamed passages.
    for (let index = 0; index < 5; index += 1) {
      const advanced = await request.post(`${API_BASE}/api/sessions/${sessionId}/turns`, {
        headers: { authorization: `Bearer ${token}` },
        data: { inputType: "read_continue", content: "继续阅读" }
      });
      expect(advanced.status()).toBe(200);
    }

    await page.goto(`/story/${sessionId}`);

    // SESSION_TURN_WINDOW is 5, so one of the six turns is left behind.
    await expect(page.locator(".turn")).toHaveCount(5);
    await expect(page.locator(".older-turns-row")).toContainText("已载入 5/6 回合");

    await page.getByRole("button", { name: "载入更早的回合" }).click();

    await expect(page.locator(".turn")).toHaveCount(6);
    // Nothing older remains, so the control goes away rather than lying.
    await expect(page.locator(".older-turns-row")).toHaveCount(0);
    // The opening passage is the one that was missing.
    await expect(page.locator(".turn").first()).toContainText("旧宅东厢房");
  });

  test("sends a visitor without a session to sign in instead of leaking the story", async ({
    page,
    request
  }) => {
    const { token } = await signInViaApi(page, request, "e2e-guard@example.com", "E2E 守卫");
    const sessionId = await startSession(request, token);

    await page.context().clearCookies();
    await page.goto(`/story/${sessionId}`);

    await expect(page).toHaveURL(/\/login$/);
  });
});
