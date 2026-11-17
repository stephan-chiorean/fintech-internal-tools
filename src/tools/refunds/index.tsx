import { registerTool } from "@/shell/extensions";
import "./actions";
import "./records";
import "./seeds";
import { CustomerRefunds, RefundsDashboardCard } from "./RefundsSlots";

registerTool({
  id: "refunds",
  name: "Refunds",
  description: "Request, approve and issue customer refunds with maker-checker approval.",
  slots: {
    dashboard: RefundsDashboardCard,
    customer: CustomerRefunds,
  },
});
