import { measureSync } from "@/lib/performance";

/** Quote a CSV cell, doubling embedded quotes (RFC 4180). */
export function escapeCsvCell(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
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
