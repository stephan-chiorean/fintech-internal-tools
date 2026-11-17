import Link from "next/link";
import { listCustomers } from "@/foundation/data";
import styles from "@/shell/shell.module.css";

export function CustomersPage({ viewerId }: { viewerId: string }) {
  const customers = listCustomers(viewerId);
  return (
    <div className={styles.stack}>
      <h1>Customers</h1>
      {customers.length === 0 ? (
        <p className={styles.muted}>You can&apos;t view any customers.</p>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Name</th>
              <th>Product area</th>
              <th>KYC</th>
              <th>Risk</th>
              <th>SSN</th>
            </tr>
          </thead>
          <tbody>
            {customers.map((c) => (
              <tr key={c.id}>
                <td>
                  <Link href={`/customers/${c.id}`}>{c.name}</Link>
                </td>
                <td>{c.productArea}</td>
                <td>{c.kycStatus}</td>
                <td>{c.riskLevel}</td>
                <td>{c.fields.ssn.value ?? <span className={styles.muted}>hidden</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
