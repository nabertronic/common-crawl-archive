import { describe, expect, it, vi } from "vitest";
import { evaluateRobots, fetchRobotsStatus, parseRobotsTxt, robotsUrlForTarget } from "@/lib/robots";

describe("robots.txt CCBot checks", () => {
  it("builds the root robots.txt URL for schemeless targets", () => {
    expect(robotsUrlForTarget("example.com/products?ref=cc")).toEqual({
      robotsUrl: "https://example.com/robots.txt",
      targetPath: "/products?ref=cc"
    });
  });

  it("returns undefined for unparseable or opaque-origin targets", () => {
    expect(robotsUrlForTarget("")).toBeUndefined();
    expect(robotsUrlForTarget("file:///etc/passwd")).toBeUndefined();
  });

  it("does not fetch when the target cannot be turned into a robots URL", async () => {
    const fetchImpl = vi.fn();
    const result = await fetchRobotsStatus("file:///etc/passwd", undefined, fetchImpl as never);

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.status).toBe("unavailable");
  });

  it("uses specific CCBot directives before wildcard directives", () => {
    const parsed = parseRobotsTxt(`
User-agent: *
Disallow: /

User-agent: CCBot
Allow: /
Disallow: /private
`);

    expect(evaluateRobots(parsed, "/public", "https://example.com/robots.txt", 1).status).toBe("allowed");
    const blocked = evaluateRobots(parsed, "/private/file", "https://example.com/robots.txt", 1);

    expect(blocked.status).toBe("blocked");
    if (blocked.status !== "blocked") throw new Error("Expected CCBot to be blocked");
    expect(blocked.matchedRule).toMatchObject({ directive: "disallow", path: "/private" });
  });

  it("lets longer allow rules win over broader disallow rules", () => {
    const parsed = parseRobotsTxt(`
User-agent: CCBot
Disallow: /docs
Allow: /docs/public
`);

    const result = evaluateRobots(parsed, "/docs/public/page", "https://example.com/robots.txt", 1);

    expect(result.status).toBe("allowed");
    if (result.status !== "allowed") throw new Error("Expected CCBot to be allowed");
    expect(result.matchedRule).toMatchObject({ directive: "allow", path: "/docs/public" });
  });

  it("treats missing robots.txt as allow by default", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 404 })));

    await expect(fetchRobotsStatus("https://example.com/page")).resolves.toMatchObject({
      status: "no-robots",
      robotsUrl: "https://example.com/robots.txt",
      targetPath: "/page"
    });
  });
});
