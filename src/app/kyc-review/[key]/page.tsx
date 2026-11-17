import { Suspense } from "react";
import { getCurrentUserId } from "@/shell/session";
import { CaseScreen } from "@/tools/kyc-review";

export default function KycCase({ params }: PageProps<"/kyc-review/[key]">) {
  return (
    <Suspense fallback={<p>Loading case…</p>}>
      <CaseContent params={params} />
    </Suspense>
  );
}

async function CaseContent({ params }: Pick<PageProps<"/kyc-review/[key]">, "params">) {
  const [{ key }, viewerId] = await Promise.all([params, getCurrentUserId()]);
  return viewerId ? <CaseScreen key={viewerId} viewerId={viewerId} caseKey={decodeURIComponent(key)} /> : null;
}
