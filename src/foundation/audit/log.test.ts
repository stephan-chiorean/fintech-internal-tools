import { beforeEach, describe, expect, it } from "vitest";
import type { Database } from "better-sqlite3";
import { freshDb } from "@/foundation/testing";
import { listAuditEntries } from "./index";
import { appendAudit } from "./log";

describe("audit log", () => {
  let db: Database;
  beforeEach(() => {
    db = freshDb();
    appendAudit(db, { actorId: "jordan", actionId: "test-harness.adjust", tool: "test-harness", outcome: "executed", input: {}, reasons: ["ok"] });
  });

  it("rejects updates", () => {
    expect(() => db.prepare("UPDATE audit SET outcome = 'denied'").run()).toThrow("audit log is append-only");
  });

  it("rejects deletes", () => {
    expect(() => db.prepare("DELETE FROM audit").run()).toThrow("audit log is append-only");
    expect((db.prepare("SELECT COUNT(*) AS n FROM audit").get() as { n: number }).n).toBe(1);
  });

  it("is readable only with audit.read", () => {
    expect(listAuditEntries("morgan")).toMatchObject({ ok: true, entries: [{ actorId: "jordan", outcome: "executed" }] });
    expect(listAuditEntries("jordan").ok).toBe(false);
  });
});
