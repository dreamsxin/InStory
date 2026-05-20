import { HomeWorkspace } from "@/components/home-workspace";
import { listReaderProfiles, listStories } from "@/lib/api";

export default async function HomePage() {
  const [stories, profiles] = await Promise.all([listStories(), listReaderProfiles()]);

  return <HomeWorkspace profiles={profiles} stories={stories} />;
}
