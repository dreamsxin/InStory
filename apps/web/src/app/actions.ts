"use server";

import { revalidatePath } from "next/cache";
import { createReaderProfile } from "@/lib/api";

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
