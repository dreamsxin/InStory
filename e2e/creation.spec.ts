import { expect, test } from "@playwright/test";
import { E2E_API_BASE as API_BASE } from "../playwright.config.js";
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
    // And it says why: the duplicate id used to surface as a bare 创建故事失败,
    // because the client read the server's reason off the response and dropped it.
    await expect(feedback).toContainText("已经被占用");
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

    // And the progress card says it is a trial. It used to look exactly like reading
    // someone else's story, while the story's own reader count already excluded it.
    await page.locator(".app-topbar").getByRole("button", { name: "继续" }).click();
    const card = page.locator(".story-card", { hasText: "守灯人" });
    await expect(card.locator(".trial-chip")).toHaveText("试玩");
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

  test("writes a passage itself, and the reader gets it word for word without spending a turn", async ({
    page,
    request
  }) => {
    await signIn(page, request, "e2e-segments@example.com");
    await page.goto("/");
    await page.locator(".app-topbar").getByRole("button", { name: "创作" }).click();

    const panel = page.locator(".create-story-panel");
    const storyId = `e2e-tide-script-${Date.now()}`;
    await panel.getByLabel("故事 ID").fill(storyId);
    await panel.getByLabel("标题").fill("潮信");
    await panel.getByLabel("类型").fill("民国旧事");
    await panel.getByLabel("一句话钩子").fill("信在潮水里泡了三天。");
    await panel.getByLabel("世界前提").fill("一座靠潮水送信的港城。");
    await panel.getByLabel("起点地点").fill("码头");
    await panel.getByLabel("起点场景").fill("水退了，信箱露出来。");
    // Preset passages are only served in 剧本 mode, so this is the one dial the test
    // has to change: the other two promise the reader their actions bend the story.
    await panel.getByLabel("入戏体验").click();
    await page.getByRole("option", { name: "剧本入戏" }).click();
    await panel.getByRole("button", { name: "创建故事" }).click();
    await expect(panel.locator(".form-feedback")).toHaveClass(/is-ok/);

    const editor = page.locator(".story-management-list .management-details");
    await editor.locator("summary").click();

    const PASSAGE = "潮水退到最低的时候，信箱从泥里露出半个铁角，锁孔里塞着一撮头发。";
    const segments = editor.locator(".segments-form");
    await expect(segments).toContainText("还没有预设正文");
    await segments.getByRole("button", { name: "添加一段" }).click();
    await segments.getByLabel("第 1 段").fill("信箱露出来");
    await segments.getByLabel("正文").fill(PASSAGE);
    await segments.getByRole("button", { name: "保存预设正文" }).click();
    await expect(segments.locator(".form-feedback")).toHaveClass(/is-ok/);
    await expect(segments.locator(".form-feedback")).toContainText("1 段");

    await editor.getByRole("button", { name: "试玩故事" }).click();
    await expect(page).toHaveURL(/\/story\//);
    const quota = page.locator(".quota-chip");
    await expect(quota).toContainText("今日剩余 20/20");

    await page.getByRole("button", { name: /继续阅读/ }).click();

    // Word for word: this is the author's text, not a prompt about it.
    await expect(page.locator(".turn").last()).toContainText(PASSAGE);
    // And nothing was spent, because no model ran. The daily budget rations
    // generations, and this passage was written by hand.
    await expect(quota).toContainText("今日剩余 20/20");

    // Kept, like any other passage, and not served twice.
    await page.reload();
    await expect(page.locator(".turn").last()).toContainText(PASSAGE);
    await page.getByRole("button", { name: /继续阅读/ }).click();
    await expect(page.locator(".turn-streaming")).toBeHidden();
    await expect(page.locator(".turn", { hasText: PASSAGE })).toHaveCount(1);
    await expect(quota).toContainText("今日剩余 19/20");

    // Published, the shelf counts what is already written instead of estimating it -
    // and still ships a count rather than the passage.
    await page.goto("/");
    await page.locator(".app-topbar").getByRole("button", { name: "创作" }).click();
    const editorAgain = page.locator(".story-management-list .management-details");
    await editorAgain.locator("summary").click();
    await editorAgain.getByLabel("可见性").click();
    await page.getByRole("option", { name: "公开到故事探索" }).click();
    await editorAgain.getByRole("button", { name: "保存故事" }).click();
    await expect(editorAgain.locator(".form-feedback").first()).toHaveClass(/is-ok/);

    await page.locator(".app-topbar").getByRole("button", { name: "故事" }).click();
    const card = page.locator(".story-card", { hasText: "潮信" });
    await expect(card.locator(".story-expectation")).toContainText("作者写好 1 段共");
    await expect(card.locator(".story-expectation")).toContainText("之后由 AI 接着写");
    await expect(card).not.toContainText(PASSAGE);

    // Someone else reads that passage. The author's own trial does not count, so until
    // now the row said nothing - which is why the story had to be published first.
    const registered = await request.post(`${API_BASE}/api/auth/register`, {
      data: { email: `e2e-passage-reader-${Date.now()}@example.com`, displayName: "E2E 读者", password: PASSWORD }
    });
    const asReader = { authorization: `Bearer ${(await registered.json()).token as string}` };
    const session = await request.post(`${API_BASE}/api/stories/${storyId}/sessions`, {
      headers: asReader,
      data: { entryMode: "existing_character", characterId: null }
    });
    const advanced = await request.post(
      `${API_BASE}/api/sessions/${(await session.json()).session.id as string}/turns`,
      { headers: asReader, data: { inputType: "read_continue", content: "继续阅读" } }
    );
    expect(advanced.ok()).toBe(true);

    // The author can now see how far anyone got through what they wrote by hand, beside
    // the passage they would rewrite. Writing it was one thing; knowing whether readers
    // reach it is the part the text alone cannot tell them.
    await page.goto("/");
    await page.locator(".app-topbar").getByRole("button", { name: "创作" }).click();
    const reopened = page.locator(".story-management-list .management-details");
    await reopened.locator("summary").click();
    await expect(reopened.locator(".segments-form .anchor-row-reach")).toHaveText("1 位读者读到这一段");
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

    // Give it a beat to reach, so the row can answer "did anyone get there".
    const anchors = row.locator(".anchors-form");
    await anchors.getByRole("button", { name: "添加锚点" }).click();
    await anchors.getByLabel("锚点 1").fill("提灯人现身");
    await anchors.getByLabel("说明").fill("第一夜必须有人提灯出现在对岸。");
    await anchors.getByRole("button", { name: "保存锚点" }).click();
    await expect(anchors.locator(".form-feedback")).toHaveClass(/is-ok/);

    // With nobody reading yet, the beat gets no number: "nobody reached it" would be
    // true of every unread story and says nothing about the beat itself.
    await page.reload();
    await page.locator(".app-topbar").getByRole("button", { name: "创作" }).click();
    await expect(page.locator(".story-anchor-reach")).toContainText("还没有人读过");

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

    // And whether the beat they planned actually happened, which the anchors alone
    // could never tell them.
    await expect(page.locator(".story-anchor-reach")).toContainText("1 位读者读了 2 段");
    await expect(page.locator(".story-anchor-reach")).toContainText("提灯人现身 1 人到过");

    // The same number where it can be acted on: beside the beat's own text, in the
    // editor the author would use to rewrite it.
    const managed = page.locator(".story-management-list .management-details");
    await managed.locator("summary").click();
    await expect(managed.locator(".anchors-form .anchor-row-reach")).toHaveText("1 位读者到过这里");
  });


  test("leaves a tombstone card instead of losing the reading silently", async ({ page, request }) => {
    await signIn(page, request, "e2e-tombstone@example.com");
    await page.goto("/");
    await page.locator(".app-topbar").getByRole("button", { name: "创作" }).click();

    const panel = page.locator(".create-story-panel");
    await panel.getByLabel("故事 ID").fill(`e2e-vanishing-inn-${Date.now()}`);
    await panel.getByLabel("标题").fill("会消失的客栈");
    await panel.getByLabel("类型").fill("奇谈");
    await panel.getByLabel("一句话钩子").fill("住一晚，第二天路就没了。");
    await panel.getByLabel("世界前提").fill("一间只在雨天存在的客栈。");
    await panel.getByLabel("起点地点").fill("客栈门口");
    await panel.getByLabel("起点场景").fill("雨水顺着招牌往下流。");
    await panel.getByRole("button", { name: "创建故事" }).click();
    await expect(panel.locator(".form-feedback")).toHaveClass(/is-ok/);

    const editor = page.locator(".story-management-list .management-details");
    await editor.locator("summary").click();
    await editor.getByRole("button", { name: "试玩故事" }).click();
    await expect(page).toHaveURL(/\/story\//);

    await page.goto("/");
    await page.locator(".app-topbar").getByRole("button", { name: "创作" }).click();
    const reopened = page.locator(".story-management-list .management-details");
    await reopened.locator("summary").click();
    page.once("dialog", (dialog) => void dialog.accept());
    await reopened.getByRole("button", { name: "删除故事" }).click();
    await expect(page.getByText("还没有自己创建的故事")).toBeVisible();

    // The progress card used to disappear from the shelf without a word.
    await page.locator(".app-topbar").getByRole("button", { name: "继续" }).click();
    const gone = page.locator(".story-card-gone");
    await expect(gone).toHaveCount(1);
    await expect(gone).toContainText("会消失的客栈");
    await expect(gone).toContainText("作者已删除这个故事");
    await expect(gone.getByRole("link", { name: "继续阅读" })).toHaveCount(0);

    await gone.getByRole("button", { name: "移除这张卡片" }).click();
    await expect(page.getByText("还没有阅读进度")).toBeVisible();
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
