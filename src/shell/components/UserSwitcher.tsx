"use client";

import { signIn, signOut } from "@/shell/actions";
import styles from "@/shell/shell.module.css";

interface Option {
  id: string;
  label: string;
}

export function UserSwitcher({ users, currentUserId }: { users: Option[]; currentUserId: string | null }) {
  return (
    <div className={styles.switcher}>
      {/* Remount on user change: React resets a form after its action, which would restore a stale selection. */}
      <form key={currentUserId ?? ""} action={signIn}>
        <label className={styles.switcherLabel}>
          Signed in as
          <select
            name="userId"
            defaultValue={currentUserId ?? ""}
            onChange={(event) => event.currentTarget.form?.requestSubmit()}
            aria-label="Switch user"
          >
            {!currentUserId && <option value="">Choose a user…</option>}
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.label}
              </option>
            ))}
          </select>
        </label>
        <noscript>
          <button type="submit">Switch</button>
        </noscript>
      </form>
      {currentUserId && (
        <form action={signOut}>
          <button type="submit" className={styles.linkButton}>
            Sign out
          </button>
        </form>
      )}
    </div>
  );
}
