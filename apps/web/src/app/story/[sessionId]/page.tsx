import { notFound, redirect } from "next/navigation";
import { ReaderClient } from "@/components/reader-client";
import { ApiNotFoundError, getCurrentUser, getSession, getStoryDetail } from "@/lib/api";

export default async function StoryPage({ params }: { params: Promise<{ sessionId: string }> }) {
  if (!(await getCurrentUser())) {
    redirect("/login");
  }

  const { sessionId } = await params;

  try {
    const { session, history, quota } = await getSession(sessionId);
    // The session only carries storyId, and the reader needs the title and the
    // story's own reading theme in its header and page frame.
    const story = await getStoryDetail(session.storyId);

    return (
      <ReaderClient
        initialHistory={history}
        initialQuota={quota}
        initialSession={session}
        readingTheme={story.story.readingTheme}
        storyTitle={story.story.title}
      />
    );
  } catch (error) {
    // A stale bookmark is not a server failure, so it gets the 404 page rather
    // than the error boundary.
    if (error instanceof ApiNotFoundError) {
      notFound();
    }
    throw error;
  }
}


