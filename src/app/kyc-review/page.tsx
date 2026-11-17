import { getCurrentUserId } from "@/shell/session";
import { QueuePage } from "@/tools/kyc-review";

export default async function KycReview() {
  const viewerId = await getCurrentUserId();
  return viewerId ? <QueuePage viewerId={viewerId} /> : null;
}
