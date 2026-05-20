"use server";

import { revalidatePath } from "next/cache";
import { updateAdminModelConfig } from "@/lib/api";

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
