import { HomeWorkspace } from "@/components/home-workspace";
import { listMyStoryDetails, listReaderProfiles, listReaderSessions, listStories } from "@/lib/api";

export default async function HomePage() {
  const [stories, profiles, myStoryDetails, sessions] = await Promise.all([
    listStories(),
    listReaderProfiles(),
    listMyStoryDetails(),
    listReaderSessions()
  ]);

  return <HomeWorkspace myStoryDetails={myStoryDetails} profiles={profiles} sessions={sessions} stories={stories} />;
}
