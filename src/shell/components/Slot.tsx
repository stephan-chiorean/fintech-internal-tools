import { getSlotComponents, type SlotName, type SlotProps } from "@/shell/extensions";
import styles from "@/shell/shell.module.css";

/** Renders every tool component registered into a shell slot. */
export function Slot<S extends SlotName>({ name, props }: { name: S; props: SlotProps[S] }) {
  const entries = getSlotComponents(name);
  if (entries.length === 0) {
    return <p className={styles.muted}>No tools have registered into the {name} slot yet.</p>;
  }
  return (
    <div className={styles.slot} data-slot={name}>
      {entries.map(({ tool, Component }) => (
        <section key={tool.id} className={styles.card} data-tool={tool.id}>
          <h3 className={styles.cardTitle}>{tool.name}</h3>
          <Component {...props} />
        </section>
      ))}
    </div>
  );
}
