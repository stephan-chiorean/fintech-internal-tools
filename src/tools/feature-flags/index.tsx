import { listApprovals } from "@/foundation/approvals";
import { ApprovalButtons } from "@/shell/components/ApprovalButtons";
import { registerTool } from "@/shell/extensions";
import styles from "@/shell/shell.module.css";
import "./flags";
import { TOOL } from "./flags";

function ProdChangesToApprove({ viewerId }: { viewerId: string }) {
  const approvals = listApprovals(viewerId, { tool: TOOL, canDecide: true });
  return (
    <div className={styles.stack}>
      <p className={styles.muted}>Prod flag changes you can approve: {approvals.length}</p>
      <ul className={styles.list}>
        {approvals.map((a) => (
          <li key={a.id}>
            <strong>{a.summary}</strong>
            <div className={styles.muted}>
              requested by {a.requestedBy} at {new Date(a.requestedAt).toLocaleString()}
            </div>
            <ApprovalButtons key={`${viewerId}:${a.id}`} approvalId={a.id} />
          </li>
        ))}
      </ul>
    </div>
  );
}

registerTool({
  id: TOOL,
  name: "Feature flags",
  description: "Turn features on or off per environment. Prod changes need approval.",
  nav: { href: "/flags", label: "Feature flags" },
  slots: { dashboard: ProdChangesToApprove },
});
