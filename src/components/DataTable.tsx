import type { ReactNode } from "react";

export type DataTableColumn<T> = {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  className?: string;
  sortable?: boolean;
};

type DataTableProps<T> = {
  columns: DataTableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  rowClassName?: (row: T) => string;
  empty?: ReactNode;
  sortKey?: string;
  sortDirection?: "asc" | "desc";
  onSort?: (key: string) => void;
};

export default function DataTable<T>({
  columns,
  rows,
  rowKey,
  rowClassName,
  empty,
  sortKey,
  sortDirection,
  onSort,
}: DataTableProps<T>) {
  if (!rows.length) {
    return <>{empty ?? null}</>;
  }

  return (
    <div className="wc-data-table-wrap">
      <table className="wc-data-table">
        <thead>
          <tr>
            {columns.map((column) => {
              const active = sortKey === column.key;
              return (
                <th key={column.key} className={column.className}>
                  {column.sortable && onSort ? (
                    <button type="button" className="wc-data-table__sort" onClick={() => onSort(column.key)}>
                      {column.header}
                      <span>{active ? (sortDirection === "asc" ? "ASC" : "DESC") : "SORT"}</span>
                    </button>
                  ) : (
                    column.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)} className={rowClassName?.(row)}>
              {columns.map((column) => (
                <td key={column.key} className={column.className}>
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
