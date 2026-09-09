"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { parseReadingTheme } from "@/lib/reading-themes";
import {
  resolveAdminModerationEvent,
  revokeAdminUserSessions,
  takedownModeratedStory,
  updateAdminModelConfig,
  updateAdminStorySummary,
  updateAdminUserRole,
  verifyAdminModelConfig
} from "@/lib/api";

/**
 * Promotes or demotes one account. The submitter carries the role, so the row shows
 * one button saying what it will do rather than a select the operator has to read.
 */
export async function updateUserRoleAction(formData: FormData) {
  const userId = String(formData.get("userId") ?? "");
  if (!userId) {
    return;
  }

  await updateAdminUserRole(userId, formData.get("role") === "admin" ? "admin" : "reader");

  revalidatePath("/admin");
}

/**
 * Ends every login an account has. Kept out of the role form: one changes what
 * someone may do, this one throws them out of where they already are.
 */
export async function revokeUserSessionsAction(formData: FormData) {
  const userId = String(formData.get("userId") ?? "");
  if (!userId) {
    return;
  }

  await revokeAdminUserSessions(userId);

  revalidatePath("/admin");
}

/** Handles both the resolve and the dismiss buttons; the submitter carries which one. */
export async function resolveModerationEventAction(formData: FormData) {
  const eventId = String(formData.get("eventId") ?? "");
  if (!eventId) {
    return;
  }

  const status = formData.get("status") === "dismissed" ? "dismissed" : "resolved";
  const resolution = String(formData.get("resolution") ?? "").trim();

  await resolveAdminModerationEvent(eventId, {
    status,
    resolution: resolution || null
  });

  revalidatePath("/admin");
}

/**
 * Closes the event and hides the story it was about. Separate from the resolve action
 * because it does something to the world, not just to the row. Reversible on purpose:
 * it flips visibility, so 故事配置 can put the story back.
 */
export async function takedownModeratedStoryAction(formData: FormData) {
  const eventId = String(formData.get("eventId") ?? "");
  if (!eventId) {
    return;
  }

  const resolution = String(formData.get("resolution") ?? "").trim();

  await takedownModeratedStory(eventId, { resolution: resolution || null });

  revalidatePath("/admin");
}

export async function updateModelConfigAction(formData: FormData) {
  const provider = formData.get("provider") === "openai-compatible" ? "openai-compatible" : "mock";
  const baseUrl = String(formData.get("baseUrl") ?? "");
  const model = String(formData.get("model") ?? "");
  const apiKey = String(formData.get("apiKey") ?? "");
  const clearApiKey = formData.get("clearApiKey") === "on";

  await updateAdminModelConfig({
    provider,
    baseUrl,
    model,
    apiKey: apiKey || null,
    clearApiKey
  });

  revalidatePath("/admin");
}

export async function verifyModelConfigAction() {
  let params: URLSearchParams;

  try {
    const result = await verifyAdminModelConfig();
    params = new URLSearchParams({
      verify: "ok",
      provider: result.provider,
      latencyMs: result.latencyMs.toString(),
      choices: result.choices.toString(),
      checkedAt: result.checkedAt
    });
  } catch (error) {
    params = new URLSearchParams({
      verify: "failed",
      message: error instanceof Error ? error.message : "模型验证失败"
    });
  }

  redirect(`/admin?${params.toString()}`);
}

export async function updateStorySummaryAction(formData: FormData) {
  const storyId = String(formData.get("storyId") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  const tagline = String(formData.get("tagline") ?? "").trim();
  const genre = String(formData.get("genre") ?? "").trim();
  const coverUrl = String(formData.get("coverUrl") ?? "").trim();
  const visibility = formData.get("visibility") === "private" ? "private" : "public";
  const aiFreedom = formData.get("aiFreedom") === "high" || formData.get("aiFreedom") === "low"
    ? String(formData.get("aiFreedom"))
    : "medium";
  const experienceMode = formData.get("experienceMode") === "scripted" || formData.get("experienceMode") === "improvised"
    ? String(formData.get("experienceMode"))
    : "coauthored";
  const defaultSegmentLength = formData.get("defaultSegmentLength") === "short" || formData.get("defaultSegmentLength") === "long"
    ? String(formData.get("defaultSegmentLength"))
    : "standard";

  await updateAdminStorySummary(storyId, {
    title,
    tagline,
    genre,
    coverUrl: coverUrl || null,
    readingTheme: parseReadingTheme(formData.get("readingTheme")),
    visibility,
    aiFreedom: aiFreedom as "low" | "medium" | "high",
    experienceMode: experienceMode as "scripted" | "coauthored" | "improvised",
    defaultSegmentLength: defaultSegmentLength as "short" | "standard" | "long"
  });

  revalidatePath("/admin");
}
