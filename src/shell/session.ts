import { cookies } from "next/headers";
import { getActor } from "@/foundation/permissions";

export const SESSION_COOKIE = "fit_user";

/** The mock signed-in user, or null. Production would read an SSO session instead. */
export async function getCurrentUserId(): Promise<string | null> {
  const id = (await cookies()).get(SESSION_COOKIE)?.value;
  return id && getActor(id) ? id : null;
}

export async function setCurrentUserId(userId: string | null): Promise<void> {
  const store = await cookies();
  if (userId) store.set(SESSION_COOKIE, userId, { httpOnly: true, sameSite: "lax", path: "/" });
  else store.delete(SESSION_COOKIE);
}
