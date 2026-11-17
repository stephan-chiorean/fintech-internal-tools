import { CustomerPage } from "@/shell/pages/CustomerPage";
import { getCurrentUserId } from "@/shell/session";

export default async function Customer({ params }: PageProps<"/customers/[id]">) {
  const [{ id }, viewerId] = await Promise.all([params, getCurrentUserId()]);
  return viewerId ? <CustomerPage viewerId={viewerId} customerId={id} /> : null;
}
