"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { loginAccount, logoutAccount, registerAccount, SESSION_COOKIE_NAME } from "@/lib/api";

const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

export interface AuthFormState {
  error: string | null;
}

async function storeSession(token: string): Promise<void> {
  (await cookies()).set({
    name: SESSION_COOKIE_NAME,
    value: token,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS
  });
}

export async function loginAction(_state: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "请填写邮箱和密码。" };
  }

  try {
    const session = await loginAccount({ email, password });
    await storeSession(session.token);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "登录失败，请稍后重试。" };
  }

  revalidatePath("/");
  redirect("/");
}

export async function registerAction(_state: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const email = String(formData.get("email") ?? "").trim();
  const displayName = String(formData.get("displayName") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !displayName || !password) {
    return { error: "请填写邮箱、昵称和密码。" };
  }

  if (password.length < 8) {
    return { error: "密码至少需要 8 位。" };
  }

  try {
    const session = await registerAccount({ email, displayName, password });
    await storeSession(session.token);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "注册失败，请稍后重试。" };
  }

  revalidatePath("/");
  redirect("/");
}

export async function logoutAction(): Promise<void> {
  // Revoke server-side first, so the token is dead even if cookie clearing fails.
  await logoutAccount();
  (await cookies()).delete(SESSION_COOKIE_NAME);

  revalidatePath("/");
  redirect("/login");
}
