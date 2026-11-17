import { Suspense } from "react";
import { CustomerPage } from "@/shell/pages/CustomerPage";
import { getCurrentUserId } from "@/shell/session";

export default function Customer({ params }: PageProps<"/customers/[id]">) {
  return (
    <Suspense fallback={<p>Loading customer…</p>}>
      <CustomerContent params={params} />
    </Suspense>
  );
}

async function CustomerContent({ params }: Pick<PageProps<"/customers/[id]">, "params">) {
  const [{ id }, viewerId] = await Promise.all([params, getCurrentUserId()]);
  return viewerId ? <CustomerPage viewerId={viewerId} customerId={id} /> : null;
}
