import { CustomersPage } from "@/shell/pages/CustomersPage";
import { getCurrentUserId } from "@/shell/session";

export default async function Customers() {
  const viewerId = await getCurrentUserId();
  return viewerId ? <CustomersPage viewerId={viewerId} /> : null;
}
