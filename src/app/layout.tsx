import type { Metadata } from "next";
import { Suspense } from "react";
import { ShellFrame } from "@/shell/components/ShellFrame";
import "./globals.css";

export const metadata: Metadata = {
  title: "Fintech Internal Tools",
  description:
    "Internal tools built as modules on one shared foundation: permissions, customer data, actions, approvals and audit.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>
        <Suspense fallback={<p style={{ padding: 24 }}>Loading…</p>}>
          <ShellFrame>{children}</ShellFrame>
        </Suspense>
      </body>
    </html>
  );
}
