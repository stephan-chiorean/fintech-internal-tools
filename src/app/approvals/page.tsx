import { ApprovalsPage } from "@/shell/pages/ApprovalsPage";
import { getCurrentUserId } from "@/shell/session";

export default async function Approvals() {
  const viewerId = await getCurrentUserId();
  return viewerId ? <ApprovalsPage viewerId={viewerId} /> : null;
}
