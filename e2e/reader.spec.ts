import { expect, test } from "@playwright/test";
import { E2E_API_BASE as API_BASE } from "../playwright.config.js";
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

  test("shows the remaining daily quota before and after advancing", async ({ page, request }) => {
    const { token } = await signInViaApi(page, request, "e2e-quota@example.com", "E2E 配额");
    const sessionId = await startSession(request, token);

    await page.goto(`/story/${sessionId}`);

    // On arrival, not only after spending: the budget now comes with the session,
    // so nobody has to burn a turn to find out how many are left.
    const quota = page.locator(".quota-chip");
    await expect(quota).toBeVisible();
    await expect(quota).toContainText("今日剩余 20/20");

    await page.getByRole("button", { name: /继续阅读/ }).click();
    await expect(page.locator(".turn-streaming")).toBeHidden();

    await expect(quota).toContainText("今日剩余 19/20");
    // The reset time is only useful if it is a real local time, so check the chip
    // carries one rather than the "明天" it used to imply.
    await expect(quota).toHaveAttribute("title", /配额于 .*\d.* 恢复/);
    // Visible, not merely present: the bar used to carry the hidden-chrome class
    // unconditionally with no button to turn it back on.
    await expect(quota).toBeVisible();

    // And the home card says the same number. It used to quote the allowance
    // ("每天 20 次推进") to everyone, so a reader with one turn left read the same
    // sentence as a reader who had not started.
    await page.goto("/");
    await expect(page.locator(".hero-quota-line")).toContainText("你今天还剩 19 次");
    await expect(page.locator(".hero-quota strong")).toHaveText("19");
  });


  test("marks a key node in the transcript and opens 入戏 from it", async ({ page, request }) => {
    const { token } = await signInViaApi(page, request, "e2e-cue@example.com", "E2E 节点");
    const sessionId = await startSession(request, token);

    await page.goto(`/story/${sessionId}`);
    // The opening is just the story starting: no invitation yet.
    await expect(page.locator(".intervention-cue")).toHaveCount(0);

    await page.getByRole("button", { name: /继续阅读/ }).click();
    await expect(page.locator(".turn-streaming")).toBeHidden();

    // Every passage used to look identical, so the reader had no way to tell where
    // stepping in would actually change something.
    const cue = page.locator(".intervention-cue");
    await expect(cue).toHaveCount(1);
    await expect(cue).toHaveAttribute("data-kind", "clue_found");
    await expect(cue).toContainText("你发现了线索");

    await cue.getByRole("button", { name: "入戏参与" }).click();
    await expect(page.locator(".action-panel")).toBeVisible();

    // The mark belongs to the passage, so it is still there after a reload.
    await page.reload();
    await expect(page.locator(".intervention-cue")).toHaveCount(1);
  });

  test("lets the reader change type size and keeps that choice after a reload", async ({
    page,
    request
  }) => {
    const { token } = await signInViaApi(page, request, "e2e-display@example.com", "E2E 版式");
    const sessionId = await startSession(request, token);

    await page.goto(`/story/${sessionId}`);
    const paragraph = page.locator(".turn .reader-paragraph").first();
    const fontSize = () =>
      paragraph.evaluate((node) => Number.parseFloat(window.getComputedStyle(node).fontSize));
    const before = await fontSize();

    await page.getByRole("button", { name: "版式" }).click();
    await page.getByRole("button", { name: "特大" }).click();

    await expect.poll(fontSize).toBeGreaterThan(before);
    const enlarged = await fontSize();

    // Stored locally, so it survives leaving the page - a setting that resets is
    // not a setting.
    await page.reload();
    await expect.poll(fontSize).toBeCloseTo(enlarged, 1);
  });

  test("lays the action panel out as one titled sheet and submits free text", async ({
    page,
    request
  }) => {
    const { token } = await signInViaApi(page, request, "e2e-action@example.com", "E2E 行动");
    const sessionId = await startSession(request, token);

    await page.goto(`/story/${sessionId}`);
    await page.getByRole("button", { name: "入戏行动" }).first().click();

    const panel = page.locator(".reader-context-panel");
    await expect(panel).toBeVisible();

    // The panel used to print its own <h2>入戏行动</h2> under the header's title.
    await expect(panel.getByText("入戏行动", { exact: true })).toHaveCount(1);

    await expect(panel.locator(".action-preset")).toHaveCount(4);
    await expect(panel.locator(".action-preset").first()).toContainText("观察");

    // Risk used to render as the raw enum, so a reader saw "(medium)".
    const badges = panel.locator(".risk-badge");
    await expect(badges.first()).toBeVisible();
    await expect(badges.first()).not.toContainText("medium");

    const counter = panel.locator(".action-section-note").last();
    await expect(counter).toHaveText("0/2000");

    const textarea = panel.locator(".action-textarea");
    await textarea.fill("我压低声音问陆清河，昨夜谁最后见过父亲。");
    await expect(counter).toHaveText("20/2000");

    await panel.getByRole("button", { name: "提交行动" }).click();
    await expect(page.locator(".turn")).toHaveCount(2);
  });

  test("shows on the shelf that other people have read a story", async ({ page, request }) => {
    const { token } = await signInViaApi(page, request, "e2e-shelf@example.com", "E2E 书架");
    const sessionId = await startSession(request, token);

    // A card said nothing about whether the story was worth starting.
    const advanced = await request.post(`${API_BASE}/api/sessions/${sessionId}/turns`, {
      headers: { authorization: `Bearer ${token}` },
      data: { inputType: "read_continue", content: "继续阅读" }
    });
    expect(advanced.ok()).toBe(true);

    await page.goto("/");
    const card = page.locator(".story-card", { hasText: "旧宅" }).first();
    const readCount = card.locator(".story-read-count");
    await expect(readCount).toContainText("位读者读过");
    await expect(readCount).toContainText("最深读到");
    await expect(readCount).not.toContainText("还没有人读过");
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

    // The reader used to be a dead end: no control led anywhere else.
    await page.getByRole("link", { name: "返回书架" }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator(".app-topbar")).toBeVisible();
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
    // The passage that opens the story is still behind the cursor, so there is no
    // honest place to put a scene divider yet.
    await expect(page.locator(".scene-divider")).toHaveCount(0);

    await page.getByRole("button", { name: "载入更早的回合" }).click();

    await expect(page.locator(".turn")).toHaveCount(6);
    // Nothing older remains, so the control goes away rather than lying.
    await expect(page.locator(".older-turns-row")).toHaveCount(0);
    // The opening passage is the one that was missing.
    await expect(page.locator(".turn").first()).toContainText("旧宅东厢房");
    // And now that the beginning is on screen it gets a scene divider — exactly one,
    // because the six passages never leave the room.
    await expect(page.locator(".scene-divider")).toHaveCount(1);
    await expect(page.locator(".scene-divider-label")).toHaveText("旧宅东厢房");
  });

  test("asks before it throws away reading, and obeys the answer", async ({ page, request }) => {
    const { token } = await signInViaApi(page, request, "e2e-confirm@example.com", "E2E 确认");
    const sessionId = await startSession(request, token);

    await page.goto(`/story/${sessionId}`);
    await expect(page.locator(".turn").first()).toBeVisible();
    await page.getByRole("button", { name: "记忆" }).click();

    // Reset starts a fresh session and cannot be undone, so a dismissed dialog has
    // to leave the reader exactly where they were - deleting a story already asked.
    page.once("dialog", (dialog) => void dialog.dismiss());
    await page.getByRole("button", { name: "重置会话" }).click();
    await expect(page).toHaveURL(new RegExp(`/story/${sessionId}$`));

    page.once("dialog", (dialog) => void dialog.accept());
    await page.getByRole("button", { name: "重置会话" }).click();
    await expect(page).not.toHaveURL(new RegExp(`/story/${sessionId}$`));
    await expect(page).toHaveURL(/\/story\/sess_/);
  });

  test("lets a reader delete a reading progress card", async ({ page, request }) => {
    const { token } = await signInViaApi(page, request, "e2e-delete-session@example.com", "E2E 删除进度");
    await startSession(request, token);

    await page.goto("/");
    await page.locator(".app-topbar").getByRole("button", { name: "继续" }).click();
    await expect(page.locator(".story-card")).toHaveCount(1);

    // Sessions only ever accumulated before this, with no way to remove one.
    page.once("dialog", (dialog) => void dialog.accept());
    await page.getByRole("button", { name: "删除进度" }).click();

    await expect(page.locator(".story-card")).toHaveCount(0);
    await expect(page.getByText("还没有阅读进度")).toBeVisible();
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

  test("answers a stale bookmark with the 404 page, not a server error", async ({ page, request }) => {
    await signInViaApi(page, request, "e2e-stale@example.com", "E2E 失效书签");

    // A deleted session or a mistyped address used to throw, and with no boundary
    // anywhere the reader got the framework's error screen with no way back.
    await page.goto("/story/sess_does-not-exist");

    await expect(page.locator(".fallback-title")).toHaveText("找不到这个页面");
    await page.getByRole("link", { name: "回到书架" }).click();
    await expect(page).toHaveURL(/\/$/);
  });
});
