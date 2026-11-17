import styles from "./page.module.css";

const plannedTools = [
  {
    name: "KYC review queue",
    description: "Review and decide on customer identity checks.",
  },
  {
    name: "Refunds dashboard",
    description: "Request, approve and track customer refunds.",
  },
  {
    name: "Feature-flag admin",
    description: "Change feature flags with approval and a full audit trail.",
  },
];

export default function Home() {
  return (
    <main className={styles.main}>
      <h1>Fintech Internal Tools</h1>
      <p className={styles.lead}>
        Internal tools built as modules on one shared foundation: permissions,
        customer data, an action pipeline, approvals and audit.
      </p>
      <h2>Planned tools</h2>
      <ul className={styles.tools}>
        {plannedTools.map((tool) => (
          <li key={tool.name} className={styles.tool}>
            <div>
              <h3>{tool.name}</h3>
              <p>{tool.description}</p>
            </div>
            <span className={styles.badge}>Coming soon</span>
          </li>
        ))}
      </ul>
    </main>
  );
}
