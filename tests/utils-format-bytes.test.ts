import { describe, expect, it } from "vitest";
import { formatBytes } from "@/lib/utils";

describe("formatBytes", () => {
  it("promotes values that round up to 1024 into the next unit", () => {
    expect(formatBytes(1_048_575)).toBe("1.0 MB");
    expect(formatBytes(1023)).toBe("1023 B");
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(10 * 1024 * 1024)).toBe("10 MB");
  });
});
