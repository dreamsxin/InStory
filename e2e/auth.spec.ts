import { expect, test } from "@playwright/test";

const PASSWORD = "e2e-password-123";

test.describe("sign-in", () => {
  test("sends an unauthenticated visitor to the sign-in page", async ({ page }) => {
    await page.goto("/");

    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("link", { name: "注册" })).toBeVisible();
  });

  test("registers an account and lands in the reader's workspace", async ({ page }) => {
    await page.goto("/login?mode=register");

    await page.getByLabel("邮箱").fill("e2e-register@example.com");
    await page.getByLabel("昵称").fill("E2E 注册者");
    await page.getByLabel("密码").fill(PASSWORD);
    await page.getByRole("button", { name: "创建账号" }).click();

    await expect(page).toHaveURL("/");
    await expect(page.getByText("E2E 注册者")).toBeVisible();
    await expect(page.getByRole("button", { name: "退出登录" })).toBeVisible();
  });

  test("signs out and refuses to go back without a session", async ({ page }) => {
    await page.goto("/login?mode=register");
    await page.getByLabel("邮箱").fill("e2e-logout@example.com");
    await page.getByLabel("昵称").fill("E2E 登出者");
    await page.getByLabel("密码").fill(PASSWORD);
    await page.getByRole("button", { name: "创建账号" }).click();
    await expect(page).toHaveURL("/");

    await page.getByRole("button", { name: "退出登录" }).click();
    await expect(page).toHaveURL(/\/login$/);

    // The revoked cookie must not get the reader back in.
    await page.goto("/");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("signs back in with the same credentials", async ({ page }) => {
    await page.goto("/login?mode=register");
    await page.getByLabel("邮箱").fill("e2e-login@example.com");
    await page.getByLabel("昵称").fill("E2E 登录者");
    await page.getByLabel("密码").fill(PASSWORD);
    await page.getByRole("button", { name: "创建账号" }).click();
    await expect(page).toHaveURL("/");
    await page.getByRole("button", { name: "退出登录" }).click();
    await expect(page).toHaveURL(/\/login$/);

    await page.getByLabel("邮箱").fill("e2e-login@example.com");
    await page.getByLabel("密码").fill(PASSWORD);
    await page.getByRole("button", { name: "登录", exact: true }).click();

    await expect(page).toHaveURL("/");
    await expect(page.getByText("E2E 登录者")).toBeVisible();
  });

  test("shows an inline error for a wrong password and stays on the page", async ({ page }) => {
    await page.goto("/login");

    await page.getByLabel("邮箱").fill("e2e-register@example.com");
    await page.getByLabel("密码").fill("definitely-not-the-password");
    await page.getByRole("button", { name: "登录", exact: true }).click();

    await expect(page.getByRole("alert")).toContainText("邮箱或密码不正确");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("rejects a duplicate email", async ({ page }) => {
    await page.goto("/login?mode=register");

    await page.getByLabel("邮箱").fill("e2e-register@example.com");
    await page.getByLabel("昵称").fill("重复注册");
    await page.getByLabel("密码").fill(PASSWORD);
    await page.getByRole("button", { name: "创建账号" }).click();

    await expect(page.getByRole("alert")).toContainText("该邮箱已被注册");
  });
});
