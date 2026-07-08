import { measureSync } from "@/lib/performance";

// Leading characters that spreadsheet apps (Excel, Sheets, LibreOffice) treat
// as the start of a formula. Exported cells include attacker-controlled archived
// URLs, so a value like `=HYPERLINK(...)` or `@SUM(...)` would execute on open.
const CSV_FORMULA_TRIGGERS = new Set(["=", "+", "-", "@", "\t", "\r"]);

/**
 * Quote a CSV cell, doubling embedded quotes (RFC 4180), and neutralize CSV
 * formula injection by prefixing a leading formula trigger with a tab so
 * spreadsheet apps treat the cell as text rather than a formula.
 */
export function escapeCsvCell(value: string): string {
  const guarded = value.length > 0 && CSV_FORMULA_TRIGGERS.has(value[0]) ? `\t${value}` : value;
  return `"${guarded.replaceAll('"', '""')}"`;
}

/**
 * Serialize a matrix of string cells into CSV text. Pure and self-contained so
 * it can run either on the main thread or inside the compute worker.
 */
export function rowsToCsv(rows: string[][]): string {
  return measureSync("csv-build", () => rows.map((row) => row.map(escapeCsvCell).join(",")).join("\n"), {
    rows: rows.length
  });
}
