import { registerTool } from "@/shell/extensions";
import "./records";
import { CustomerKyc } from "./CustomerKyc";
import { QueueCard } from "./QueueCard";

registerTool({
  id: "kyc-review",
  name: "KYC review",
  description: "Analysts claim, approve, reject or escalate customer identity checks.",
  nav: { href: "/kyc-review", label: "KYC review" },
  slots: { dashboard: QueueCard, customer: CustomerKyc },
});

export { CaseScreen } from "./CaseScreen";
export { QueuePage } from "./QueuePage";
