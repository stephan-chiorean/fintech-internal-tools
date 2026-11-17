import { AuditPage } from "@/shell/pages/AuditPage";
import { getCurrentUserId } from "@/shell/session";

export default async function Audit() {
  const viewerId = await getCurrentUserId();
  return viewerId ? <AuditPage viewerId={viewerId} /> : null;
}
