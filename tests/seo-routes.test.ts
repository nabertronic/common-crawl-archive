import { describe, expect, it } from "vitest";
import sitemap from "@/app/sitemap";
import robots from "@/app/robots";

describe("search indexing routes", () => {
  it("lists only the public site and guide pages in the sitemap", () => {
    expect(sitemap().map(({ url }) => url)).toEqual([
      "https://crawlback.cc/",
      "https://crawlback.cc/how-it-works",
      "https://crawlback.cc/privacy",
      "https://crawlback.cc/terms",
      "https://crawlback.cc/imprint"
    ]);
  });

  it("publishes its sitemap while keeping private app routes excluded", () => {
    const config = robots();
    expect(config.sitemap).toBe("https://crawlback.cc/sitemap.xml");
    expect(config.rules).toMatchObject({
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/search", "/history", "/settings", "/view"]
    });
  });
});
