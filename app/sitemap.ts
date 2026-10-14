import type { MetadataRoute } from "next";

const SITE_ORIGIN = "https://crawlback.cc";

export default function sitemap(): MetadataRoute.Sitemap {
  return ["/", "/privacy", "/terms"].map((path) => ({
    url: new URL(path, SITE_ORIGIN).toString()
  }));
}
