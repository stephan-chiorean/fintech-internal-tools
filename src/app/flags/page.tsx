import { FlagsPage } from "@/tools/feature-flags/FlagsPage";
import { getCurrentUserId } from "@/shell/session";

export default async function Flags() {
  const viewerId = await getCurrentUserId();
  return viewerId ? <FlagsPage viewerId={viewerId} /> : null;
}
