import { redirect } from "next/navigation";
import { AccountBar } from "@/components/account-bar";
import { HomeWorkspace } from "@/components/home-workspace";
import {
  getCurrentUser,
  getMyQuota,
  listMyStoryDetails,
  listMyStoryInsights,
  listReaderProfiles,
  listReaderSessions,
  listShelf
} from "@/lib/api";

export default async function HomePage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  // The shelf's first page, in the default order. Filtering and further pages are
  // fetched by the client from the same endpoint, so what the first screen shows and
  // what a keyword returns are decided in one place.
  const [shelf, profiles, myStoryDetails, sessions, storyInsights, quota] = await Promise.all([
    listShelf(),
    listReaderProfiles(),
    listMyStoryDetails(),
    listReaderSessions(),
    listMyStoryInsights(),
    getMyQuota()
  ]);

  return (
    <HomeWorkspace
      accountBar={<AccountBar user={user} />}
      myStoryDetails={myStoryDetails}
      profiles={profiles}
      quota={quota}
      sessions={sessions}
      shelf={shelf}
      storyInsights={storyInsights}
    />
  );
}



