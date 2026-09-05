import { redirect } from "next/navigation";
import { AccountBar } from "@/components/account-bar";
import { HomeWorkspace } from "@/components/home-workspace";
import {
  getCurrentUser,
  listMyStoryDetails,
  listReaderProfiles,
  listReaderSessions,
  listStories
} from "@/lib/api";

export default async function HomePage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const [stories, profiles, myStoryDetails, sessions] = await Promise.all([
    listStories(),
    listReaderProfiles(),
    listMyStoryDetails(),
    listReaderSessions()
  ]);

  return (
    <>
      <AccountBar user={user} />
      <HomeWorkspace myStoryDetails={myStoryDetails} profiles={profiles} sessions={sessions} stories={stories} />
    </>
  );
}
