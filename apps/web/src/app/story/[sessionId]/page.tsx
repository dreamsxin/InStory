import { ReaderClient } from "@/components/reader-client";
import { getSession } from "@/lib/api";

export default async function StoryPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  const session = await getSession(sessionId);

  return <ReaderClient initialSession={session} />;
}
