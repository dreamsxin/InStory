import { redirect } from "next/navigation";
import { ReaderClient } from "@/components/reader-client";
import { getCurrentUser, getSession, getStoryDetail } from "@/lib/api";

export default async function StoryPage({ params }: { params: Promise<{ sessionId: string }> }) {
  if (!(await getCurrentUser())) {
    redirect("/login");
  }

  const { sessionId } = await params;
  const { session, history } = await getSession(sessionId);
  // The session only carries storyId, and the reader needs the title in its header.
  const story = await getStoryDetail(session.storyId);

  return <ReaderClient initialHistory={history} initialSession={session} storyTitle={story.story.title} />;
}


