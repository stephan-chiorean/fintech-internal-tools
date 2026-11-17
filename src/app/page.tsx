import { Dashboard } from "@/shell/pages/Dashboard";
import { getCurrentUserId } from "@/shell/session";

export default async function Home() {
  const viewerId = await getCurrentUserId();
  return viewerId ? <Dashboard viewerId={viewerId} /> : null;
}
