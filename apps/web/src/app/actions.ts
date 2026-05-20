"use server";

import { revalidatePath } from "next/cache";
import { createReaderProfile, createStory } from "@/lib/api";

export async function createReaderProfileAction(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const gender = String(formData.get("gender") ?? "").trim();
  const personality = String(formData.get("personality") ?? "").trim();
  const avatarUrl = String(formData.get("avatarUrl") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();

  await createReaderProfile({
    name,
    gender: gender || null,
    personality,
    avatarUrl: avatarUrl || null,
    description
  });

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
    aiFreedom: aiFreedom as "low" | "medium" | "high",
    experienceMode: experienceMode as "scripted" | "coauthored" | "improvised",
    defaultSegmentLength: defaultSegmentLength as "short" | "standard" | "long"
  });

  revalidatePath("/");
}
