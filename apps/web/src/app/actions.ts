"use server";

import { revalidatePath } from "next/cache";
import { parseReadingTheme } from "@/lib/reading-themes";
import type { FormResult } from "@/lib/form-result";
import {
  createReaderProfile,
  createStory,
  deleteMyStory,
  deleteReaderProfile,
  deleteSession,
  updateMyStory,
  updateReaderProfile
} from "@/lib/api";

/**
 * Server actions used to return nothing and let failures throw, which sent the
 * reader to the framework's error page and threw away everything they had typed -
 * worst on the four-section story form. They now report back instead.
 */
function failed(error: unknown, fallback: string): FormResult {
  return { status: "error", message: error instanceof Error ? error.message : fallback };
}

/** Every single-valued field, so a rejected form can be handed back filled in. */
function submittedValues(formData: FormData): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string" && !(key in values)) {
      values[key] = value;
    }
  }
  return values;
}

export async function createReaderProfileAction(_state: FormResult, formData: FormData): Promise<FormResult> {
  const name = String(formData.get("name") ?? "").trim();
  const gender = String(formData.get("gender") ?? "").trim();
  const personality = String(formData.get("personality") ?? "").trim();
  const avatarUrl = String(formData.get("avatarUrl") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const visibility = formData.get("visibility") === "public" ? "public" : "private";

  try {
    await createReaderProfile({
      name,
      gender: gender || null,
      personality,
      avatarUrl: avatarUrl || null,
      description,
      visibility
    });
  } catch (error) {
    return { ...failed(error, "创建角色失败，请稍后重试。"), values: submittedValues(formData) };
  }

  revalidatePath("/");
  return { status: "ok", message: `已创建角色「${name}」，可在进入故事时选用。` };
}

export async function updateReaderProfileAction(_state: FormResult, formData: FormData): Promise<FormResult> {
  const profileId = String(formData.get("profileId") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const gender = String(formData.get("gender") ?? "").trim();
  const personality = String(formData.get("personality") ?? "").trim();
  const avatarUrl = String(formData.get("avatarUrl") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const visibility = formData.get("visibility") === "public" ? "public" : "private";

  try {
    await updateReaderProfile(profileId, {
      name,
      gender: gender || null,
      personality,
      avatarUrl: avatarUrl || null,
      description,
      visibility
    });
  } catch (error) {
    return { ...failed(error, "保存角色失败，请稍后重试。"), values: submittedValues(formData) };
  }

  revalidatePath("/");
  return { status: "ok", message: "角色已保存。" };
}

export async function deleteReaderProfileAction(formData: FormData) {
  const profileId = String(formData.get("profileId") ?? "").trim();
  await deleteReaderProfile(profileId);
  revalidatePath("/");
}

export async function createStoryAction(_state: FormResult, formData: FormData): Promise<FormResult> {
  const id = String(formData.get("id") ?? "").trim();
  const title = String(formData.get("title") ?? "").trim();
  const tagline = String(formData.get("tagline") ?? "").trim();
  const genre = String(formData.get("genre") ?? "").trim();
  const coverUrl = String(formData.get("coverUrl") ?? "").trim();
  const premise = String(formData.get("premise") ?? "").trim();
  const openingLocationName = String(formData.get("openingLocationName") ?? "").trim();
  const openingLocationDescription = String(formData.get("openingLocationDescription") ?? "").trim();
  const castProfileIds = formData.getAll("castProfileIds").map((value) => String(value));
  const visibility = formData.get("visibility") === "public" ? "public" : "private";
  const worldRules = String(formData.get("worldRules") ?? "")
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
  const aiFreedom = formData.get("aiFreedom") === "high" || formData.get("aiFreedom") === "low"
    ? String(formData.get("aiFreedom"))
    : "medium";
  const experienceMode = formData.get("experienceMode") === "scripted" || formData.get("experienceMode") === "improvised"
    ? String(formData.get("experienceMode"))
    : "coauthored";
  const defaultSegmentLength = formData.get("defaultSegmentLength") === "short" || formData.get("defaultSegmentLength") === "long"
    ? String(formData.get("defaultSegmentLength"))
    : "standard";

  try {
    await createStory({
      id,
      title,
      tagline,
      genre,
      coverUrl: coverUrl || null,
      readingTheme: parseReadingTheme(formData.get("readingTheme")),
      premise,
      openingLocationName,
      openingLocationDescription,
      worldRules,
      castProfileIds,
      visibility,
      aiFreedom: aiFreedom as "low" | "medium" | "high",
      experienceMode: experienceMode as "scripted" | "coauthored" | "improvised",
      defaultSegmentLength: defaultSegmentLength as "short" | "standard" | "long"
    });
  } catch (error) {
    // The id has to be a slug and has to be unused, and both rules only fail here.
    return { ...failed(error, "创建故事失败，请检查故事 ID 是否已被占用。"), values: submittedValues(formData) };
  }

  revalidatePath("/");
  return {
    status: "ok",
    message:
      visibility === "public"
        ? `已创建《${title}》并公开，现在可以在「故事」里进入。`
        : `已创建《${title}》，默认仅自己可见；可在下方展开试玩，或改为公开。`
  };
}

export async function updateStoryAction(_state: FormResult, formData: FormData): Promise<FormResult> {
  const storyId = String(formData.get("storyId") ?? "").trim();
  const title = String(formData.get("title") ?? "").trim();
  const tagline = String(formData.get("tagline") ?? "").trim();
  const genre = String(formData.get("genre") ?? "").trim();
  const coverUrl = String(formData.get("coverUrl") ?? "").trim();
  const premise = String(formData.get("premise") ?? "").trim();
  const openingLocationName = String(formData.get("openingLocationName") ?? "").trim();
  const openingLocationDescription = String(formData.get("openingLocationDescription") ?? "").trim();
  const worldRules = String(formData.get("worldRules") ?? "")
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
  const visibility = formData.get("visibility") === "public" ? "public" : "private";
  const aiFreedom = formData.get("aiFreedom") === "high" || formData.get("aiFreedom") === "low"
    ? String(formData.get("aiFreedom"))
    : "medium";
  const experienceMode = formData.get("experienceMode") === "scripted" || formData.get("experienceMode") === "improvised"
    ? String(formData.get("experienceMode"))
    : "coauthored";
  const defaultSegmentLength = formData.get("defaultSegmentLength") === "short" || formData.get("defaultSegmentLength") === "long"
    ? String(formData.get("defaultSegmentLength"))
    : "standard";

  try {
    await updateMyStory(storyId, {
      title,
      tagline,
      genre,
      coverUrl: coverUrl || null,
      readingTheme: parseReadingTheme(formData.get("readingTheme")),
      premise,
      openingLocationName,
      openingLocationDescription,
      worldRules,
      visibility,
      aiFreedom: aiFreedom as "low" | "medium" | "high",
      experienceMode: experienceMode as "scripted" | "coauthored" | "improvised",
      defaultSegmentLength: defaultSegmentLength as "short" | "standard" | "long"
    });
  } catch (error) {
    return { ...failed(error, "保存故事失败，请稍后重试。"), values: submittedValues(formData) };
  }

  revalidatePath("/");
  return { status: "ok", message: `《${title}》已保存。` };
}

export async function deleteStoryAction(formData: FormData) {
  const storyId = String(formData.get("storyId") ?? "").trim();
  await deleteMyStory(storyId);
  revalidatePath("/");
}

/** Removes one reading progress card, transcript and saves included. */
export async function deleteSessionAction(formData: FormData) {
  const sessionId = String(formData.get("sessionId") ?? "").trim();
  await deleteSession(sessionId);
  revalidatePath("/");
}
