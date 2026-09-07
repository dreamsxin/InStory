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

  test("offers the last trial back instead of silently starting another one", async ({ page, request }) => {
    await signIn(page, request, "e2e-trial-story@example.com");
    await page.goto("/");
    await page.locator(".app-topbar").getByRole("button", { name: "创作" }).click();

    const storyId = `e2e-lamp-keeper-${Date.now()}`;
    const panel = page.locator(".create-story-panel");
    await panel.getByLabel("故事 ID").fill(storyId);
    await panel.getByLabel("标题").fill("守灯人");
    await panel.getByLabel("类型").fill("西方幻想");
    await panel.getByLabel("一句话钩子").fill("灯灭之前，必须有人守着。");
    await panel.getByLabel("世界前提").fill("一座只有灯塔还亮着的荒岛。");
    await panel.getByLabel("起点地点").fill("灯塔顶层");
    await panel.getByLabel("起点场景").fill("风从破窗灌进来，灯芯只剩一寸。");
    await panel.getByRole("button", { name: "创建故事" }).click();
    await expect(panel.locator(".form-feedback")).toHaveClass(/is-ok/);

    const editor = page.locator(".story-management-list .management-details");
    await editor.locator("summary").click();
    await editor.getByRole("button", { name: "试玩故事" }).click();
    await expect(page).toHaveURL(/\/story\//);

    // Coming back used to offer only 试玩故事, which built a second identical
    // progress card every time the author re-checked the opening.
    await page.goto("/");
    await page.locator(".app-topbar").getByRole("button", { name: "创作" }).click();
    const reopened = page.locator(".story-management-list .management-details");
    await reopened.locator("summary").click();
    await expect(reopened.getByRole("button", { name: /回到上次试玩/ })).toBeVisible();
    await expect(reopened.getByRole("button", { name: "从开场重新试玩" })).toBeVisible();
  });

  test("re-sets an actor inside one story without touching the profile", async ({ page, request }) => {
    await signIn(page, request, "e2e-recast-story@example.com");
    await page.goto("/");
    await page.locator(".app-topbar").getByRole("button", { name: "创作" }).click();

    await page.getByRole("button", { name: "角色库" }).click();
    const profilePanel = page.locator(".create-profile-panel");
    await profilePanel.getByLabel("名称").fill("柳明河");
    await profilePanel.getByLabel("性格").fill("温和，习惯先听完再答。");
    await profilePanel.getByLabel("身份背景").fill("旧书店店主，认识城里所有夜归人。");
    await profilePanel.getByRole("button", { name: "创建入戏角色" }).click();
    await expect(profilePanel.locator(".form-feedback")).toHaveClass(/is-ok/);

    await page.getByRole("button", { name: "故事工作台" }).click();
    const storyPanel = page.locator(".create-story-panel");
    await storyPanel.getByLabel("故事 ID").fill(`e2e-night-shop-${Date.now()}`);
    await storyPanel.getByLabel("标题").fill("夜市旧书店");
    await storyPanel.getByLabel("类型").fill("都市奇谈");
    await storyPanel.getByLabel("一句话钩子").fill("有些书只在打烊后才上架。");
    await storyPanel.getByLabel("世界前提").fill("一间只在深夜营业的书店，卖的是别人的记忆。");
    await storyPanel.getByLabel("起点地点").fill("书店后间");
    await storyPanel.getByLabel("起点场景").fill("门帘一响，柜台后的人抬起头，像在等你很久了。");
    await storyPanel.locator('input[name="castProfileIds"]').first().check();
    await storyPanel.getByRole("button", { name: "创建故事" }).click();
    await expect(storyPanel.locator(".form-feedback")).toHaveClass(/is-ok/);

    const editor = page.locator(".story-management-list .management-details");
    await editor.locator("summary").click();
    const cast = editor.locator(".cast-form");
    await expect(cast.locator(".cast-name")).toHaveText("柳明河");

    // The whole point of the re-set: the same character can be someone else here.
    await cast.getByLabel("故事身份").fill("替人保管记忆的书店老板");
    await cast.getByLabel("与读者的关系").fill("欠你一本没还的书");
    await cast.getByLabel("秘密（读者看不到，AI 只能暗示）").fill("你上次卖掉的记忆还在他手里");
    await cast.getByLabel("当前目标（每行一条）").fill("拖到打烊\n不让你翻后间的架子");
    await cast.getByRole("button", { name: "保存演员" }).click();
    await expect(cast.locator(".form-feedback")).toHaveClass(/is-ok/);

    await page.goto("/");
    await page.locator(".app-topbar").getByRole("button", { name: "创作" }).click();
    const reopened = page.locator(".story-management-list .management-details");
    await reopened.locator("summary").click();
    await expect(reopened.locator(".cast-form").getByLabel("与读者的关系")).toHaveValue("欠你一本没还的书");
    await expect(reopened.locator(".cast-form").getByLabel("当前目标（每行一条）")).toHaveValue(
      "拖到打烊\n不让你翻后间的架子"
    );

    // The profile it was snapshotted from must be untouched.
    await page.getByRole("button", { name: "角色库" }).click();
    const profileEditor = page.locator(".profile-list .management-details");
    await profileEditor.locator("summary").click();
    await expect(profileEditor.getByLabel("身份背景")).toHaveValue("旧书店店主，认识城里所有夜归人。");
  });

  test("gives a story plot anchors, which it had no way to have before", async ({ page, request }) => {
    await signIn(page, request, "e2e-anchors@example.com");
    await page.goto("/");
    await page.locator(".app-topbar").getByRole("button", { name: "创作" }).click();

    const panel = page.locator(".create-story-panel");
    await panel.getByLabel("故事 ID").fill(`e2e-salt-road-${Date.now()}`);
    await panel.getByLabel("标题").fill("盐路");
    await panel.getByLabel("类型").fill("公路奇谈");
    await panel.getByLabel("一句话钩子").fill("这条路只在退潮时出现。");
    await panel.getByLabel("世界前提").fill("一条横穿盐滩的路，走完要三天。");
    await panel.getByLabel("起点地点").fill("盐滩起点");
    await panel.getByLabel("起点场景").fill("车停在路口，前面全是白。");
    await panel.getByRole("button", { name: "创建故事" }).click();
    await expect(panel.locator(".form-feedback")).toHaveClass(/is-ok/);

    const editor = page.locator(".story-management-list .management-details");
    await editor.locator("summary").click();

    // A story created from the console always had zero anchors: the field existed,
    // reached the prompt, and had no way in.
    const anchors = editor.locator(".anchors-form");
    await expect(anchors).toContainText("还没有锚点");

    await anchors.getByRole("button", { name: "添加锚点" }).click();
    await anchors.getByLabel("锚点 1").fill("潮水回来");
    await anchors.getByLabel("说明").fill("第三天日落前潮水必须回来，路要被淹掉。");
    await anchors.getByRole("button", { name: "保存锚点" }).click();
    await expect(anchors.locator(".form-feedback")).toHaveClass(/is-ok/);
    await expect(anchors.locator(".form-feedback")).toContainText("1 条");

    await page.goto("/");
    await page.locator(".app-topbar").getByRole("button", { name: "创作" }).click();
    const reopened = page.locator(".story-management-list .management-details");
    await reopened.locator("summary").click();
    await expect(reopened.locator(".anchors-form").getByLabel("锚点 1")).toHaveValue("潮水回来");
  });

  test("tells the author whether anyone has read the story", async ({ page, request }) => {
    await signIn(page, request, "e2e-insight-author@example.com");
    await page.goto("/");
    await page.locator(".app-topbar").getByRole("button", { name: "创作" }).click();

    const storyId = `e2e-lantern-ferry-${Date.now()}`;
    const panel = page.locator(".create-story-panel");
    await panel.getByLabel("故事 ID").fill(storyId);
    await panel.getByLabel("标题").fill("提灯渡");
    await panel.getByLabel("类型").fill("民俗奇谈");
    await panel.getByLabel("一句话钩子").fill("船只在有人提灯时才靠岸。");
    await panel.getByLabel("世界前提").fill("一条只在夜里摆渡的河。");
    await panel.getByLabel("起点地点").fill("渡口");
    await panel.getByLabel("起点场景").fill("你提着灯站在水边，对岸什么也看不见。");
    await panel.getByRole("button", { name: "创建故事" }).click();
    await expect(panel.locator(".form-feedback")).toHaveClass(/is-ok/);

    // A brand new story has to say so, not show four zeros.
    const row = page.locator(".story-management-list .management-details");
    await expect(row.locator(".story-insight")).toHaveText("还没有人读过");

    // Publish it, so the second account is reading something it is meant to see.
    await row.locator("summary").click();
    await row.getByLabel("可见性").click();
    await page.getByRole("option", { name: "公开到故事探索" }).click();
    await row.getByRole("button", { name: "保存故事" }).click();
    await expect(row.locator(".management-edit .form-feedback").first()).toHaveClass(/is-ok/);

    // Someone else reads one passage of it.
    const registered = await request.post(`${API_BASE}/api/auth/register`, {
      data: { email: `e2e-insight-reader-${Date.now()}@example.com`, displayName: "E2E 读者", password: PASSWORD }
    });
    const readerToken = (await registered.json()).token as string;
    const asReader = { authorization: `Bearer ${readerToken}` };
    const session = await request.post(`${API_BASE}/api/stories/${storyId}/sessions`, {
      headers: asReader,
      data: { entryMode: "existing_character", characterId: null }
    });
    const sessionId = (await session.json()).session.id as string;
    const advanced = await request.post(`${API_BASE}/api/sessions/${sessionId}/turns`, {
      headers: asReader,
      data: { inputType: "read_continue", content: "继续阅读" }
    });
    expect(advanced.ok()).toBe(true);

    // The author had no way to know any of this until now.
    await page.goto("/");
    await page.locator(".app-topbar").getByRole("button", { name: "创作" }).click();
    const insight = page.locator(".story-management-list .management-details .story-insight");
    await expect(insight).toContainText("1 位读者");
    await expect(insight).toContainText("最深 2 回合");
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
