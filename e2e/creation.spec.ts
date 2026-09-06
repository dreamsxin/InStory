import { expect, test } from "@playwright/test";

const API_BASE = "http://127.0.0.1:4000";
const PASSWORD = "e2e-password-123";

/** Registers through the API and hands the browser the matching session cookie. */
async function signIn(
  page: import("@playwright/test").Page,
  request: import("@playwright/test").APIRequestContext,
  email: string
): Promise<void> {
  const response = await request.post(`${API_BASE}/api/auth/register`, {
    data: { email, displayName: "E2E 创作者", password: PASSWORD }
  });
  expect(response.status()).toBe(201);
  const { token } = (await response.json()) as { token: string };

  await page.context().addCookies([
    { name: "instory_session", value: token, domain: "127.0.0.1", path: "/", httpOnly: true, sameSite: "Lax" }
  ]);
}

test.describe("creation console", () => {
  test("says whether the story was created, and keeps the form when it was not", async ({
    page,
    request
  }) => {
    await signIn(page, request, "e2e-create-story@example.com");
    await page.goto("/");
    await page.locator(".app-topbar").getByRole("button", { name: "创作" }).click();

    const storyId = `e2e-moon-market-${Date.now()}`;
    // Scoped to the create panel: once the story exists, its edit form carries the
    // same labels further down the page.
    const panel = page.locator(".create-story-panel");
    const fillStory = async () => {
      await panel.getByLabel("故事 ID").fill(storyId);
      await panel.getByLabel("标题").fill("月市");
      await panel.getByLabel("类型").fill("幻想");
      await panel.getByLabel("一句话钩子").fill("月亮落下时，市集才开门。");
      await panel.getByLabel("世界前提").fill("一座只在月落后出现的市集，交易的是记忆。");
      await panel.getByLabel("起点地点").fill("月落长街");
      await panel.getByLabel("起点场景").fill("你握着一枚不属于自己的铜钱，站在灯火刚亮的长街口。");
    };

    await fillStory();
    const submit = panel.getByRole("button", { name: "创建故事" });
    await submit.click();

    // Before this the page just quietly revalidated and the creator had to go
    // looking for their own story to find out whether it worked.
    const feedback = panel.locator(".form-feedback");
    await expect(feedback).toHaveClass(/is-ok/);
    await expect(feedback).toContainText("已创建《月市》");

    // The same id twice is the most likely mistake, and the failure has to leave
    // the four sections of typing where they were.
    await fillStory();
    await expect(submit).toBeEnabled();
    await submit.click();
    await expect(feedback).toHaveClass(/is-error/);
    await expect(panel.getByLabel("标题")).toHaveValue("月市");
    await expect(panel.getByLabel("世界前提")).toHaveValue("一座只在月落后出现的市集，交易的是记忆。");
  });

  test("keeps this round's edits when saving an existing story fails", async ({ page, request }) => {
    await signIn(page, request, "e2e-edit-story@example.com");
    await page.goto("/");
    await page.locator(".app-topbar").getByRole("button", { name: "创作" }).click();

    const storyId = `e2e-tide-archive-${Date.now()}`;
    const panel = page.locator(".create-story-panel");
    await panel.getByLabel("故事 ID").fill(storyId);
    await panel.getByLabel("标题").fill("潮汐档案");
    await panel.getByLabel("类型").fill("悬疑");
    await panel.getByLabel("一句话钩子").fill("退潮后，档案室多了一份卷宗。");
    await panel.getByLabel("世界前提").fill("一座靠潮水记事的港城。");
    await panel.getByLabel("起点地点").fill("潮汐档案室");
    await panel.getByLabel("起点场景").fill("盐味顺着窗缝进来，桌上摊着一份没有署名的卷宗。");
    await panel.getByRole("button", { name: "创建故事" }).click();
    await expect(panel.locator(".form-feedback")).toHaveClass(/is-ok/);

    const editor = page.locator(".story-management-list .management-details");
    await editor.locator("summary").click();
    await editor.getByLabel("标题").fill("潮汐档案 · 修订");
    await editor.getByLabel("世界前提").fill("一座靠潮水记事的港城，涨潮时没人敢翻旧卷宗。");

    // Removing the story out from under the open form is the cheapest way to make
    // the save fail for real, rather than mocking the action.
    const removed = await page.request.delete(`${API_BASE}/api/me/stories/${storyId}`);
    expect(removed.ok()).toBe(true);

    await editor.getByRole("button", { name: "保存故事" }).click();

    // The failure used to re-render the form from the stored values, quietly
    // throwing away the wording the author had just written.
    const feedback = editor.locator(".form-feedback");
    await expect(feedback).toHaveClass(/is-error/);
    await expect(editor.getByLabel("标题")).toHaveValue("潮汐档案 · 修订");
    await expect(editor.getByLabel("世界前提")).toHaveValue("一座靠潮水记事的港城，涨潮时没人敢翻旧卷宗。");
  });

  test("reports a saved reader profile in place", async ({ page, request }) => {
    await signIn(page, request, "e2e-create-profile@example.com");
    await page.goto("/");
    await page.locator(".app-topbar").getByRole("button", { name: "创作" }).click();
    await page.getByRole("button", { name: "角色库" }).click();

    const panel = page.locator(".create-profile-panel");
    await panel.getByLabel("名称").fill("沈既白");
    await panel.getByLabel("性格").fill("寡言，先看清再开口。");
    await panel.getByLabel("身份背景").fill("退役军医，为寻回失踪的妹妹而来。");
    await panel.getByRole("button", { name: "创建入戏角色" }).click();

    const feedback = panel.locator(".form-feedback");
    await expect(feedback).toHaveClass(/is-ok/);
    await expect(feedback).toContainText("沈既白");
  });
});
