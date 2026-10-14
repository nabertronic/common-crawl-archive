export const APP_NAME = "Crawlback";

export const GITHUB_REPOSITORY_URL = "https://github.com/nabertronic/common-crawl-archive";

export function stripUrlForTitle(url: string): string {
  return url
    .trim()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/\/+$/, "");
}

export function extractHtmlTitle(html: string): string {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!match) return "";
  return match[1]
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildTabTitle(prefix: string): string {
  const trimmed = prefix.trim();
  return trimmed ? `${trimmed} · ${APP_NAME}` : APP_NAME;
}
