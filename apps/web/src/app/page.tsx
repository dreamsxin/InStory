import { HomeWorkspace } from "@/components/home-workspace";
import { listMyStoryDetails, listReaderProfiles, listStories } from "@/lib/api";

export default async function HomePage() {
  const [stories, profiles, myStoryDetails] = await Promise.all([listStories(), listReaderProfiles(), listMyStoryDetails()]);

  return <HomeWorkspace myStoryDetails={myStoryDetails} profiles={profiles} stories={stories} />;
}
