export type HistoryCleanupSelection = {
  cleanTimesheets: boolean;
};

export function assertHistoryCleanupSelection(
  selection: HistoryCleanupSelection
): void {
  if (selection.cleanTimesheets) {
    throw new Error(
      "Pontajele sunt excluse din curatarea istoricului si trebuie pastrate permanent."
    );
  }
}
