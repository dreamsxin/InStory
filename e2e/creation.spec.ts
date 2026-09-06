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
