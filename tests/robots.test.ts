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

  it("matches wildcard and end-anchored patterns without catastrophic backtracking", () => {
    const parsed = parseRobotsTxt(`User-agent: CCBot\nDisallow: /${"*a".repeat(20)}b\n`);
    const started = performance.now();
    const result = evaluateRobots(parsed, `/${"a".repeat(5000)}`, "https://example.com/robots.txt", 1);
    expect(performance.now() - started).toBeLessThan(100);
    expect(result.status).toBe("allowed");
  });

  it("keeps wildcard and $ anchor semantics", () => {
    const parsed = parseRobotsTxt(`
User-agent: CCBot
Disallow: /*.php$
Disallow: /private*/data
Disallow: /exact$
`);
    const blocked = (path: string) => evaluateRobots(parsed, path, "https://example.com/robots.txt", 1).status === "blocked";

    expect(blocked("/index.php")).toBe(true);
    expect(blocked("/index.php?x=1")).toBe(false);
    expect(blocked("/private/a/data")).toBe(true);
    expect(blocked("/private/data")).toBe(true);
    expect(blocked("/privatedata")).toBe(false);
    expect(blocked("/exact")).toBe(true);
    expect(blocked("/exact/more")).toBe(false);
  });

  it("does not echo the remote HTTP status to the caller", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 503 })));

    const result = await fetchRobotsStatus("https://example.com/page");
    expect(result.status).toBe("unavailable");
    if (result.status !== "unavailable") throw new Error("Expected unavailable");
    expect(result.error).toBe("robots.txt could not be read from the target site.");
    expect(result.error).not.toMatch(/503/);
  });

  it("ignores robots.txt content past the byte cap and over-long rules", async () => {
    const padding = "# " + "x".repeat(1024) + "\n";
    const body = "User-agent: CCBot\n" + padding.repeat(600) + "Disallow: /late\n";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { status: 200 })));
    await expect(fetchRobotsStatus("https://example.com/late")).resolves.toMatchObject({ status: "allowed" });

    const longRule = parseRobotsTxt(`User-agent: CCBot\nDisallow: /${"a".repeat(3000)}\n`);
    expect(longRule.groups[0]?.rules).toHaveLength(0);
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
