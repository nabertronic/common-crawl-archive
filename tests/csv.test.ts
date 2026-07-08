import { describe, expect, it } from "vitest";
import { escapeCsvCell, rowsToCsv } from "@/lib/csv";

describe("escapeCsvCell", () => {
  it("quotes plain values and doubles embedded quotes", () => {
    expect(escapeCsvCell("hello")).toBe('"hello"');
    expect(escapeCsvCell('a "b" c')).toBe('"a ""b"" c"');
  });

  it("neutralizes formula-injection triggers with a leading tab", () => {
    for (const trigger of ["=", "+", "-", "@"]) {
      const cell = escapeCsvCell(`${trigger}HYPERLINK("http://evil")`);
      expect(cell.startsWith('"\t')).toBe(true);
    }
  });

  it("prefixes an archived URL that starts with a formula trigger", () => {
    expect(escapeCsvCell("=1+2")).toBe('"\t=1+2"');
  });

  it("leaves an interior trigger character untouched", () => {
    expect(escapeCsvCell("http://x/a=b")).toBe('"http://x/a=b"');
  });
});

describe("rowsToCsv", () => {
  it("guards every cell in a matrix", () => {
    const csv = rowsToCsv([["url", "note"], ["@evil", "ok"]]);
    expect(csv).toBe('"url","note"\n"\t@evil","ok"');
  });
});
