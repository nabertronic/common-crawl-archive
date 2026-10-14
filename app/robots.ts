import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/search", "/history", "/settings", "/view"]
    },
    sitemap: "https://crawlback.cc/sitemap.xml"
  };
}
