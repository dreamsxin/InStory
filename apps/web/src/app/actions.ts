"use server";

import { revalidatePath } from "next/cache";
import {
  createReaderProfile,
  createStory,
  deleteMyStory,
  deleteReaderProfile,
  updateMyStory,
  updateReaderProfile
} from "@/lib/api";

export async function createReaderProfileAction(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const gender = String(formData.get("gender") ?? "").trim();
  const personality = String(formData.get("personality") ?? "").trim();
  const avatarUrl = String(formData.get("avatarUrl") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const visibility = formData.get("visibility") === "public" ? "public" : "private";

  await createReaderProfile({
    name,
    gender: gender || null,
    personality,
    avatarUrl: avatarUrl || null,
    description,
    visibility
  });

  revalidatePath("/");
}

export async function updateReaderProfileAction(formData: FormData) {
  const profileId = String(formData.get("profileId") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const gender = String(formData.get("gender") ?? "").trim();
  const personality = String(formData.get("personality") ?? "").trim();
  const avatarUrl = String(formData.get("avatarUrl") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const visibility = formData.get("visibility") === "public" ? "public" : "private";

  await updateReaderProfile(profileId, {
    name,
    gender: gender || null,
    personality,
    avatarUrl: avatarUrl || null,
    description,
    visibility
  });

  revalidatePath("/");
}

export async function deleteReaderProfileAction(formData: FormData) {
  const profileId = String(formData.get("profileId") ?? "").trim();
  await deleteReaderProfile(profileId);
  revalidatePath("/");
}

export async function createStoryAction(formData: FormData) {
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

  await createStory({
    id,
    title,
    tagline,
    genre,
    coverUrl: coverUrl || null,
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

  revalidatePath("/");
}

export async function updateStoryAction(formData: FormData) {
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

  await updateMyStory(storyId, {
    title,
    tagline,
    genre,
    coverUrl: coverUrl || null,
    premise,
    openingLocationName,
    openingLocationDescription,
    worldRules,
    visibility,
    aiFreedom: aiFreedom as "low" | "medium" | "high",
    experienceMode: experienceMode as "scripted" | "coauthored" | "improvised",
    defaultSegmentLength: defaultSegmentLength as "short" | "standard" | "long"
  });

  revalidatePath("/");
}

export async function deleteStoryAction(formData: FormData) {
  const storyId = String(formData.get("storyId") ?? "").trim();
  await deleteMyStory(storyId);
  revalidatePath("/");
}
