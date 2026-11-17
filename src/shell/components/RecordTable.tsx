import { Fragment, type ReactNode } from "react";
import styles from "@/shell/shell.module.css";

export interface RecordColumn<T> {
  header: string;
  cell: (row: T) => ReactNode;
}

/** A table of tool records. `expand` renders a full-width row under each record (e.g. its history). */
export function RecordTable<T>({
  rows,
  columns,
  rowKey,
  empty = "Nothing here.",
  expand,
}: {
  rows: T[];
  columns: RecordColumn<T>[];
  rowKey: (row: T) => string;
  empty?: string;
  expand?: (row: T) => ReactNode;
}) {
  if (rows.length === 0) return <p className={styles.muted}>{empty}</p>;
  return (
    <table className={styles.table}>
      <thead>
        <tr>
          {columns.map((column) => (
            <th key={column.header}>{column.header}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const key = rowKey(row);
          const extra = expand?.(row);
          return (
            <Fragment key={key}>
              <tr data-row={key}>
                {columns.map((column) => (
                  <td key={column.header}>{column.cell(row)}</td>
                ))}
              </tr>
              {extra && (
                <tr className={styles.expandRow}>
                  <td colSpan={columns.length}>{extra}</td>
                </tr>
              )}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}
