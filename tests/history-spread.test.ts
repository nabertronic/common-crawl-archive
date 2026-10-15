import { describe, expect, it } from "vitest";
import { buildSpread, captureYearsFromKeys } from "@/lib/history-spread";

const key = (collection: string, offset = 0) =>
  `warc:crawl-data/${collection}/segments/1700000000000.1/warc/CC-MAIN-file-${offset}.warc.gz:${offset * 100}:512`;

describe("captureYearsFromKeys", () => {
  it("reads the year from real-looking collection keys", () => {
    expect(captureYearsFromKeys([key("CC-MAIN-2020-50"), key("CC-MAIN-2015-14", 1)])).toEqual([2020, 2015]);
  });

  it("handles older collection id shapes", () => {
    expect(captureYearsFromKeys([key("CC-MAIN-2008-2009"), key("CC-MAIN-2012")])).toEqual([2008, 2012]);
  });

  it("parses mock keys that embed the collection id", () => {
    const mock = "warc:mock/snapshot-search/CC-MAIN-2019-30-20190722000000.warc.gz:0:512";
    expect(captureYearsFromKeys([mock])).toEqual([2019]);
  });

  it("ignores malformed keys", () => {
    expect(
      captureYearsFromKeys([
        "",
        "warc:no-collection-here.warc.gz:0:1",
        "warc:crawl-data/CC-MAIN-20x0-50/file.warc.gz:0:1",
        "warc:crawl-data/CC-MAIN-20200-50/file.warc.gz:0:1",
        "warc:crawl-data/CC-MAIN-1850-01/file.warc.gz:0:1",
        "warc:crawl-data/CC-MAIN-2021-10/file.warc.gz:0:1",
        null as unknown as string,
        42 as unknown as string
      ])
    ).toEqual([2021]);
  });

  it("counts a repeated key once", () => {
    expect(captureYearsFromKeys([key("CC-MAIN-2020-50"), key("CC-MAIN-2020-50")])).toEqual([2020]);
  });

  it("returns an empty list for no keys", () => {
    expect(captureYearsFromKeys([])).toEqual([]);
  });
});

describe("buildSpread", () => {
  it("counts captures per year across multiple collections", () => {
    const keys = [
      key("CC-MAIN-2015-14", 1),
      key("CC-MAIN-2015-22", 2),
      key("CC-MAIN-2015-48", 3),
      key("CC-MAIN-2019-13", 4),
      key("CC-MAIN-2021-04", 5)
    ];
    expect(buildSpread(keys, 2014, 2021)).toEqual([0, 3, 0, 0, 0, 1, 0, 1]);
  });

  it("defaults to 2008 through the given end year, contiguous", () => {
    const spread = buildSpread([key("CC-MAIN-2008-2009")], undefined, 2010);
    expect(spread).toEqual([1, 0, 0]);
  });

  it("defaults the end year to the current UTC year", () => {
    const spread = buildSpread([]);
    expect(spread).toHaveLength(new Date().getUTCFullYear() - 2008 + 1);
    expect(spread.every((count) => count === 0)).toBe(true);
  });

  it("ignores years outside the range", () => {
    expect(buildSpread([key("CC-MAIN-2005-01"), key("CC-MAIN-2030-01")], 2008, 2012)).toEqual([0, 0, 0, 0, 0]);
  });

  it("returns an empty array for an empty key list with an empty range", () => {
    expect(buildSpread([], 2010, 2009)).toEqual([]);
    expect(buildSpread([], 2008, 2008)).toEqual([0]);
  });

  it("ignores malformed keys", () => {
    expect(buildSpread(["garbage", "warc:CC-MAIN-20x1-01:0:1"], 2008, 2009)).toEqual([0, 0]);
  });
});
