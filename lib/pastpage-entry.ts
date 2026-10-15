/** Only PastPage's exact-URL, full-archive search may run before storage consent. */
export function isPastPageEntry(pathname: string, params: { get(name: string): string | null }): boolean {
  return pathname === "/search" && params.get("source") === "pastpage" &&
    params.get("match") === "exact" && params.get("scope") === "all" &&
    Boolean(params.get("url")?.trim()) &&
    !["scan", "saved", "history", "action", "mock", "from", "to"].some((key) => params.get(key));
}
