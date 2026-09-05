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
