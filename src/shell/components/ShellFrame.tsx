import Link from "next/link";
import type { ReactNode } from "react";
import { getDirectory } from "@/foundation/permissions";
import { listTools } from "@/shell/extensions";
import { getCurrentUserId } from "@/shell/session";
import styles from "@/shell/shell.module.css";
import { UserSwitcher } from "./UserSwitcher";
import "@/tools";

const NAV = [
  { href: "/", label: "Dashboard" },
  { href: "/customers", label: "Customers" },
  { href: "/approvals", label: "Approvals" },
  { href: "/audit", label: "Audit log" },
];

export async function ShellFrame({ children }: { children: ReactNode }) {
  const currentUserId = await getCurrentUserId();
  const { users } = getDirectory();
  const toolNav = listTools().flatMap((tool) => (tool.nav ? [tool.nav] : []));

  return (
    <div className={styles.frame}>
      <header className={styles.header}>
        <Link href="/" className={styles.brand}>
          Fintech Internal Tools
        </Link>
        {currentUserId && (
          <nav className={styles.nav} aria-label="Main">
            {[...NAV, ...toolNav].map((item) => (
              <Link key={item.href} href={item.href}>
                {item.label}
              </Link>
            ))}
          </nav>
        )}
        <UserSwitcher
          currentUserId={currentUserId}
          users={users.map((u) => ({ id: u.id, label: `${u.name} — ${u.title}` }))}
        />
      </header>
      <main className={styles.main}>
        {currentUserId ? (
          children
        ) : (
          <div className={styles.card}>
            <h1>Sign in</h1>
            <p className={styles.muted}>
              This prototype uses a mock sign-in. Pick a user in the switcher above to see the app with their
              permissions.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
