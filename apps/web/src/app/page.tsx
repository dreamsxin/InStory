import { HomeWorkspace } from "@/components/home-workspace";
import { listMyStories, listReaderProfiles, listStories } from "@/lib/api";

export default async function HomePage() {
  const [stories, profiles, myStories] = await Promise.all([listStories(), listReaderProfiles(), listMyStories()]);

  return <HomeWorkspace myStories={myStories} profiles={profiles} stories={stories} />;
}
