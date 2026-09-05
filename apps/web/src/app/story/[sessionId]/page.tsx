import { redirect } from "next/navigation";
import { ReaderClient } from "@/components/reader-client";
import { getCurrentUser, getSession } from "@/lib/api";

export default async function StoryPage({ params }: { params: Promise<{ sessionId: string }> }) {
  if (!(await getCurrentUser())) {
    redirect("/login");
  }

  const { sessionId } = await params;
  const session = await getSession(sessionId);

  return <ReaderClient initialSession={session} />;
}
