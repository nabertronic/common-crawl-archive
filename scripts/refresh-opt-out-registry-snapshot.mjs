import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const url =
  "https://docs.google.com/spreadsheets/d/1uavIZ-Y2ew-Vj7d0_pY67SGD2jcUCsZZ5rPy1qEyPzg/export?format=csv&gid=0";
const targetPath = path.join(process.cwd(), "data", "common-crawl-opt-out-registry-snapshot.csv");

const response = await fetch(url, {
  headers: { Accept: "text/csv" },
  signal: AbortSignal.timeout(15_000)
});

if (!response.ok) {
  throw new Error(`Opt-out registry returned HTTP ${response.status}`);
}

const csv = await response.text();
if (!csv.trim() || csv.length > 2 * 1024 * 1024 || /^\s*</.test(csv)) {
  throw new Error("Opt-out registry returned an empty, oversized, or HTML response; snapshot was not replaced.");
}
await mkdir(path.dirname(targetPath), { recursive: true });
await writeFile(targetPath, csv, "utf8");

process.stdout.write(`Saved opt-out registry snapshot to ${targetPath}\n`);
