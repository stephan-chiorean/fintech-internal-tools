import Link from "next/link";
import type { ToolRecord } from "@/foundation/data";
import { RecordTable, type RecordColumn } from "@/shell/components/RecordTable";
import { EffectBadge } from "@/shell/components/Reasons";
import { CaseActionForm } from "./CaseActionForm";
import { caseHref, caseStatus, claimedBy, customerName } from "./cases";

export function CaseTable({ viewerId, cases, showClaim = false }: { viewerId: string; cases: ToolRecord[]; showClaim?: boolean }) {
  const columns: RecordColumn<ToolRecord>[] = [
    { header: "Case", cell: (r) => <Link href={caseHref(r.key)}>{r.key}</Link> },
    { header: "Customer", cell: (r) => customerName(viewerId, r.customerId) },
    { header: "Status", cell: (r) => <EffectBadge effect={caseStatus(r)} /> },
    { header: "Opened by", cell: (r) => r.openedBy },
    { header: "Claimed by", cell: (r) => claimedBy(r) ?? "—" },
  ];
  if (showClaim) {
    columns.push({
      header: "",
      cell: (r) => <CaseActionForm actionId="kyc-review.claim-case" input={{ key: r.key }} buttons={[{ label: "Claim" }]} />,
    });
  }
  return <RecordTable rows={cases} columns={columns} rowKey={(r) => r.id} empty="None." />;
}
