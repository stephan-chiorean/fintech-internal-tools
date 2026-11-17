import type { Database } from "better-sqlite3";

export const SEED_TEAMS = [
  { id: "basic-support", name: "Basic Support", parentId: null },
  { id: "support-t1", name: "Support Tier 1", parentId: "basic-support" },
  { id: "support-t2", name: "Support Tier 2", parentId: "support-t1" },
  { id: "support-bpo", name: "Support BPO", parentId: "basic-support" },
  { id: "payments-eng", name: "Payments Engineering", parentId: null },
  { id: "payments-oncall", name: "Payments On-call", parentId: "payments-eng" },
  { id: "refunds-ops", name: "Refunds Ops", parentId: null },
  { id: "kyc-review", name: "KYC Review", parentId: null },
  { id: "fraud", name: "Fraud", parentId: null },
  { id: "compliance", name: "Compliance", parentId: null },
] as const;

export const SEED_USERS = [
  { id: "priya", name: "Priya Shah", title: "Payments Engineer", teams: ["payments-eng"], contractor: false },
  { id: "marcus", name: "Marcus Lee", title: "Payments On-call Engineer", teams: ["payments-oncall"], contractor: false },
  { id: "alex", name: "Alex Rivera", title: "BPO Support Agent (contractor)", teams: ["support-bpo"], contractor: true },
  { id: "jordan", name: "Jordan Kim", title: "Support Agent, Tier 1", teams: ["support-t1"], contractor: false },
  { id: "taylor", name: "Taylor Brooks", title: "Support Lead, Tier 2", teams: ["support-t2"], contractor: false },
  { id: "chris", name: "Chris Novak", title: "Refunds Specialist", teams: ["refunds-ops"], contractor: false },
  { id: "riley", name: "Riley Chen", title: "KYC Analyst", teams: ["kyc-review"], contractor: false },
  { id: "morgan", name: "Morgan Patel", title: "Compliance Officer", teams: ["compliance"], contractor: false },
  { id: "avery", name: "Avery Johnson", title: "Compliance & KYC Lead", teams: ["compliance", "kyc-review"], contractor: false },
  { id: "jamie", name: "Jamie Ortiz", title: "Fraud Investigator", teams: ["fraud"], contractor: false },
] as const;

// Fake data only. SSNs use the 900-999 area range, which is never issued.
export const SEED_CUSTOMERS = [
  { id: "cust_1001", name: "Dana Whitfield", email: "dana@example.com", productArea: "payments", kycStatus: "verified", riskLevel: "low", ssn: "901-12-4821", bankAccount: "021000021-4410023817", dob: "1987-03-14", address: "12 Harbor St, Portland, ME 04101" },
  { id: "cust_1002", name: "Omar Haddad", email: "omar@example.com", productArea: "cards", kycStatus: "pending", riskLevel: "medium", ssn: "902-34-7710", bankAccount: "026009593-9981200456", dob: "1992-11-02", address: "88 Elm Ave, Austin, TX 78701" },
  { id: "cust_1003", name: "Lena Fischer", email: "lena@example.com", productArea: "lending", kycStatus: "verified", riskLevel: "low", ssn: "903-56-1188", bankAccount: "121000358-3300987712", dob: "1979-06-25", address: "401 Pine Rd, Denver, CO 80202" },
  { id: "cust_1004", name: "Sam Okafor", email: "sam@example.com", productArea: "payments", kycStatus: "pending", riskLevel: "high", ssn: "904-78-5532", bankAccount: "011401533-7720045519", dob: "1995-01-30", address: "7 Bay View Ct, Tampa, FL 33602" },
  { id: "cust_1005", name: "Grace Liu", email: "grace@example.com", productArea: "cards", kycStatus: "verified", riskLevel: "low", ssn: "905-90-2264", bankAccount: "031101279-1102938475", dob: "1983-09-09", address: "230 Market St, San Jose, CA 95113" },
  { id: "cust_1006", name: "Mateo Alvarez", email: "mateo@example.com", productArea: "lending", kycStatus: "rejected", riskLevel: "high", ssn: "906-11-9043", bankAccount: "071000013-5566778899", dob: "1990-12-19", address: "15 Lake Shore Dr, Chicago, IL 60611" },
] as const;

export function seed(db: Database): void {
  const insertTeam = db.prepare("INSERT INTO teams (id, name, parent_id) VALUES (?, ?, ?)");
  const insertUser = db.prepare(
    "INSERT INTO users (id, name, email, title, is_contractor) VALUES (?, ?, ?, ?, ?)",
  );
  const insertMembership = db.prepare("INSERT INTO user_teams (user_id, team_id) VALUES (?, ?)");
  const insertCustomer = db.prepare(
    `INSERT INTO customers (id, name, email, product_area, kyc_status, risk_level, ssn, bank_account, dob, address)
     VALUES (@id, @name, @email, @productArea, @kycStatus, @riskLevel, @ssn, @bankAccount, @dob, @address)`,
  );

  db.transaction(() => {
    for (const team of SEED_TEAMS) insertTeam.run(team.id, team.name, team.parentId);
    for (const user of SEED_USERS) {
      insertUser.run(user.id, user.name, `${user.id}@corp.example`, user.title, user.contractor ? 1 : 0);
      for (const team of user.teams) insertMembership.run(user.id, team);
    }
    for (const customer of SEED_CUSTOMERS) insertCustomer.run(customer);
  })();
}
