import { redirect } from "next/navigation";
import { ReaderClient } from "@/components/reader-client";
import { getCurrentUser, getSession, getStoryDetail } from "@/lib/api";

export default async function StoryPage({ params }: { params: Promise<{ sessionId: string }> }) {
  if (!(await getCurrentUser())) {
    redirect("/login");
  }

  const { sessionId } = await params;
  const { session, history } = await getSession(sessionId);
  // The session only carries storyId, and the reader needs the title and the
  // story's own reading theme in its header and page frame.
  const story = await getStoryDetail(session.storyId);

  return (
    <ReaderClient
      initialHistory={history}
      initialSession={session}
      readingTheme={story.story.readingTheme}
      storyTitle={story.story.title}
    />
  );
}


