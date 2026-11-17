import { registerTool } from "@/shell/extensions";
import styles from "@/shell/shell.module.css";
import "./action";
import "./records";
import { HarnessForm } from "./HarnessForm";

registerTool({
  id: "test-harness",
  name: "Test harness",
  description: "Test-only tool that runs a sample action through the shared pipeline.",
  slots: {
    customer: ({ customerId }) => (
      <div className={styles.stack}>
        <p className={styles.muted}>
          Posts a test adjustment through the shared pipeline. Up to $100 runs directly for Tier 1, larger amounts need
          approval, and the outcome is always audited.
        </p>
        <HarnessForm customerId={customerId} />
      </div>
    ),
  },
});
