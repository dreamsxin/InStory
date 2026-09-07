import { redirect } from "next/navigation";
import { AccountBar } from "@/components/account-bar";
import { HomeWorkspace } from "@/components/home-workspace";
import {
  getCurrentUser,
  listMyStoryDetails,
  listMyStoryInsights,
  listReaderProfiles,
  listReaderSessions,
  listStories,
  listStoryInsights
} from "@/lib/api";

export default async function HomePage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const [stories, profiles, myStoryDetails, sessions, storyInsights, shelfInsights] = await Promise.all([
    listStories(),
    listReaderProfiles(),
    listMyStoryDetails(),
    listReaderSessions(),
    listMyStoryInsights(),
    listStoryInsights()
  ]);

  return (
    <HomeWorkspace
      accountBar={<AccountBar user={user} />}
      myStoryDetails={myStoryDetails}
      profiles={profiles}
      sessions={sessions}
      shelfInsights={shelfInsights}
      stories={stories}
      storyInsights={storyInsights}
    />
  );
}

