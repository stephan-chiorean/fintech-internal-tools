"use server";

import { revalidatePath } from "next/cache";
import { decideApproval as decide, type ApprovalDecisionResult } from "@/foundation/approvals";
import { getCustomerFacts, getCustomerProfile } from "@/foundation/data";
import { getActor } from "@/foundation/permissions";
import { runAction, type ActionResult } from "@/foundation/pipeline";
import { getCurrentUserId, setCurrentUserId } from "@/shell/session";
import "@/tools";

const ANONYMOUS = "anonymous";

/** Mock sign-in: switches the current user. */
export async function signIn(formData: FormData): Promise<void> {
  const userId = String(formData.get("userId") ?? "");
  await setCurrentUserId(getActor(userId) ? userId : null);
  revalidatePath("/", "layout");
}

export async function signOut(): Promise<void> {
  await setCurrentUserId(null);
  revalidatePath("/", "layout");
}

/** The one server action tools call to write. Runs the shared pipeline as the signed-in user. */
export async function submitToolAction(actionId: string, input: unknown): Promise<ActionResult> {
  const actorId = (await getCurrentUserId()) ?? ANONYMOUS;
  const result = runAction(actorId, actionId, input);
  revalidatePath("/", "layout");
  return result;
}

export async function decideApproval(approvalId: string, decision: "approve" | "reject"): Promise<ApprovalDecisionResult> {
  const actorId = (await getCurrentUserId()) ?? ANONYMOUS;
  const result = decide(actorId, approvalId, decision === "approve" ? "approve" : "reject");
  revalidatePath("/", "layout");
  return result;
}

export async function fetchCustomerProfile(customerId: string) {
  return getCustomerProfile((await getCurrentUserId()) ?? ANONYMOUS, customerId);
}

export async function fetchCustomerFacts(customerId: string) {
  return getCustomerFacts((await getCurrentUserId()) ?? ANONYMOUS, customerId);
}
