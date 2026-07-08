import { afterEach, describe, expect, it, vi } from "vitest";
import { computeCsv, computeZipBytes, __resetComputeWorkerForTests } from "@/lib/compute-client";
import { buildZipBytes } from "@/lib/zip";
import { rowsToCsv } from "@/lib/csv";

afterEach(() => {
  __resetComputeWorkerForTests();
  vi.unstubAllGlobals();
});

describe("computeZipBytes fallback", () => {
  it("falls back to main-thread assembly when Worker is unavailable", async () => {
    vi.stubGlobal("Worker", undefined);
    __resetComputeWorkerForTests();

    const entries = [
      { filename: "a.txt", content: "hello" },
      { filename: "b.txt", content: "world" }
    ];
    const bytes = await computeZipBytes(entries);
    const expected = buildZipBytes(entries);

    expect(Array.from(bytes)).toEqual(Array.from(expected));
  });

  it("produces a valid ZIP local-file-header signature (PK\\x03\\x04)", async () => {
    vi.stubGlobal("Worker", undefined);
    __resetComputeWorkerForTests();

    const bytes = await computeZipBytes([{ filename: "a.txt", content: "x" }]);
    expect(bytes[0]).toBe(0x50); // P
    expect(bytes[1]).toBe(0x4b); // K
    expect(bytes[2]).toBe(0x03);
    expect(bytes[3]).toBe(0x04);
  });

  it("computeCsv falls back to main-thread serialization when Worker is unavailable", async () => {
    vi.stubGlobal("Worker", undefined);
    __resetComputeWorkerForTests();

    const rows = [
      ["a", "b"],
      ['has "quote"', "plain"]
    ];
    const csv = await computeCsv(rows);
    expect(csv).toBe(rowsToCsv(rows));
    expect(csv).toContain('"has ""quote"""');
  });

  it("falls back when the worker constructor throws", async () => {
    vi.stubGlobal(
      "Worker",
      class {
        constructor() {
          throw new Error("blocked by CSP");
        }
      }
    );
    __resetComputeWorkerForTests();

    const entries = [{ filename: "a.txt", content: "data" }];
    const bytes = await computeZipBytes(entries);
    expect(Array.from(bytes)).toEqual(Array.from(buildZipBytes(entries)));
  });
});
