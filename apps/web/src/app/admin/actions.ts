"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { updateAdminModelConfig, updateAdminStorySummary, verifyAdminModelConfig } from "@/lib/api";

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
    visibility,
    aiFreedom: aiFreedom as "low" | "medium" | "high",
    experienceMode: experienceMode as "scripted" | "coauthored" | "improvised",
    defaultSegmentLength: defaultSegmentLength as "short" | "standard" | "long"
  });

  revalidatePath("/admin");
}
