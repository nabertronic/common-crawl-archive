import type {
  CollectionCheckResult,
  CommonCrawlCapture,
  CommonCrawlCollection,
  MatchType
} from "@/lib/common-crawl";
import type { ParsedWarcRecord } from "@/lib/warc";

const MOCK_FILENAME_PREFIX = "mock/snapshot-search/";

export const MOCK_COLLECTIONS: CommonCrawlCollection[] = [
  {
    id: "CC-MAIN-2026-18",
    name: "April 2026 Index",
    cdxApi: "mock://index/CC-MAIN-2026-18",
    from: "2026-04-16T00:00:00Z",
    to: "2026-04-29T23:59:59Z"
  },
  {
    id: "CC-MAIN-2025-51",
    name: "December 2025 Index",
    cdxApi: "mock://index/CC-MAIN-2025-51",
    from: "2025-12-12T00:00:00Z",
    to: "2025-12-25T23:59:59Z"
  },
  {
    id: "CC-MAIN-2025-33",
    name: "August 2025 Index",
    cdxApi: "mock://index/CC-MAIN-2025-33",
    from: "2025-08-04T00:00:00Z",
    to: "2025-08-17T23:59:59Z"
  },
  {
    id: "CC-MAIN-2024-46",
    name: "November 2024 Index",
    cdxApi: "mock://index/CC-MAIN-2024-46",
    from: "2024-11-05T00:00:00Z",
    to: "2024-11-18T23:59:59Z"
  },
  {
    id: "CC-MAIN-2024-10",
    name: "March 2024 Index",
    cdxApi: "mock://index/CC-MAIN-2024-10",
    from: "2024-03-01T00:00:00Z",
    to: "2024-03-14T23:59:59Z"
  },
  {
    id: "CC-MAIN-2023-23",
    name: "May 2023 Index",
    cdxApi: "mock://index/CC-MAIN-2023-23",
    from: "2023-05-20T00:00:00Z",
    to: "2023-06-02T23:59:59Z"
  },
  {
    id: "CC-MAIN-2022-40",
    name: "October 2022 Index",
    cdxApi: "mock://index/CC-MAIN-2022-40",
    from: "2022-09-26T00:00:00Z",
    to: "2022-10-09T23:59:59Z"
  },
  {
    id: "CC-MAIN-2021-17",
    name: "April 2021 Index",
    cdxApi: "mock://index/CC-MAIN-2021-17",
    from: "2021-04-10T00:00:00Z",
    to: "2021-04-23T23:59:59Z"
  }
];

type MockCaptureSeed = {
  collectionId: string;
  timestamp: string;
  path: string;
  status?: string;
  mime?: string;
  length: string;
  redirect?: string;
};

const MOCK_CAPTURE_SEEDS: MockCaptureSeed[] = [
  { collectionId: "CC-MAIN-2026-18", timestamp: "20260420140722", path: "/", length: "68421" },
  { collectionId: "CC-MAIN-2026-18", timestamp: "20260420141203", path: "/pricing", length: "52218" },
  {
    collectionId: "CC-MAIN-2026-18",
    timestamp: "20260421101944",
    path: "/docs",
    status: "302",
    mime: "text/html",
    length: "1432",
    redirect: "https://docs.example.org/"
  },
  { collectionId: "CC-MAIN-2025-51", timestamp: "20251218115508", path: "/", length: "71104" },
  { collectionId: "CC-MAIN-2025-51", timestamp: "20251218120539", path: "/blog/common-crawl-outage", length: "44927" },
  {
    collectionId: "CC-MAIN-2025-51",
    timestamp: "20251219163218",
    path: "/login",
    status: "301",
    mime: "text/html",
    length: "1210",
    redirect: "https://example.org/sign-in"
  },
  { collectionId: "CC-MAIN-2025-33", timestamp: "20250810102110", path: "/", length: "69780" },
  { collectionId: "CC-MAIN-2025-33", timestamp: "20250810104754", path: "/features", length: "58633" },
  { collectionId: "CC-MAIN-2025-33", timestamp: "20250811180027", path: "/status", length: "38442" },
  { collectionId: "CC-MAIN-2024-46", timestamp: "20241109144938", path: "/", length: "64201" },
  { collectionId: "CC-MAIN-2024-46", timestamp: "20241110133621", path: "/archive", length: "81742" },
  { collectionId: "CC-MAIN-2024-46", timestamp: "20241111191802", path: "/contact", length: "29145" },
  { collectionId: "CC-MAIN-2024-10", timestamp: "20240303105519", path: "/", length: "60334" },
  { collectionId: "CC-MAIN-2024-10", timestamp: "20240305163940", path: "/releases", length: "74590" },
  {
    collectionId: "CC-MAIN-2024-10",
    timestamp: "20240306124731",
    path: "/old-docs",
    status: "301",
    mime: "text/html",
    length: "1018",
    redirect: "https://example.org/docs"
  },
  { collectionId: "CC-MAIN-2023-23", timestamp: "20230523120505", path: "/", length: "55312" },
  { collectionId: "CC-MAIN-2023-23", timestamp: "20230524101045", path: "/team", length: "33680" },
  { collectionId: "CC-MAIN-2022-40", timestamp: "20221003164309", path: "/", length: "49802" },
  { collectionId: "CC-MAIN-2022-40", timestamp: "20221004111158", path: "/docs", length: "61292" },
  { collectionId: "CC-MAIN-2021-17", timestamp: "20210412172433", path: "/", length: "42155" },
  { collectionId: "CC-MAIN-2021-17", timestamp: "20210413100327", path: "/about", length: "28745" }
];

export function isMockCaptureFilename(filename: string) {
  return filename.startsWith(MOCK_FILENAME_PREFIX);
}

function collectionById(collectionId: string) {
  const collection = MOCK_COLLECTIONS.find((item) => item.id === collectionId);
  if (!collection) throw new Error(`Unknown mock collection: ${collectionId}`);
  return collection;
}

function normalizedBaseUrl(targetUrl: string, matchType: MatchType) {
  const fallback = "https://example.org";
  try {
    const parsed = new URL(targetUrl || fallback);
    if (matchType === "exact") return new URL("/", parsed.origin).toString().replace(/\/$/, "");
    return parsed.origin;
  } catch {
    return fallback;
  }
}

function makeCapture(seed: MockCaptureSeed, index: number, baseUrl: string): CommonCrawlCapture {
  const collection = collectionById(seed.collectionId);
  const url = new URL(seed.path, `${baseUrl}/`).toString();
  return {
    collectionId: collection.id,
    collectionName: collection.name,
    collectionFrom: collection.from,
    collectionTo: collection.to,
    timestamp: seed.timestamp,
    url,
    status: seed.status ?? "200",
    mime: seed.mime ?? "text/html",
    digest: `mock-digest-${seed.timestamp}-${index}`,
    filename: `${MOCK_FILENAME_PREFIX}${collection.id}-${seed.timestamp}.warc.gz`,
    offset: String(900000 + index * 27191),
    length: seed.length,
    redirect: seed.redirect
  };
}

export function createMockSearchDataset(targetUrl: string, matchType: MatchType) {
  const baseUrl = normalizedBaseUrl(targetUrl, matchType);
  const captures = MOCK_CAPTURE_SEEDS.map((seed, index) => makeCapture(seed, index, baseUrl));
  const capturesByCollection = new Map<string, CommonCrawlCapture[]>();
  for (const capture of captures) {
    const current = capturesByCollection.get(capture.collectionId) ?? [];
    current.push(capture);
    capturesByCollection.set(capture.collectionId, current);
  }

  const failureResults: CollectionCheckResult[] = [
    {
      collection: MOCK_COLLECTIONS[1],
      status: "not-checked",
      captures: [],
      httpStatus: 500,
      error: "SlowDown response from Common Crawl",
      errorKind: "http_500_slowdown",
      attempts: 1,
      runs: 1
    },
    {
      collection: MOCK_COLLECTIONS[3],
      status: "not-checked",
      captures: [],
      httpStatus: 504,
      error: "Gateway timeout response from Common Crawl",
      errorKind: "http_504_gateway_timeout",
      attempts: 2,
      runs: 1
    },
    {
      collection: MOCK_COLLECTIONS[5],
      status: "not-checked",
      captures: [],
      httpStatus: 503,
      error: "Service unavailable response from Common Crawl",
      errorKind: "http_503_unavailable",
      attempts: 2,
      runs: 1
    },
    {
      collection: MOCK_COLLECTIONS[7],
      status: "not-checked",
      captures: [],
      httpStatus: 429,
      error: "Rate limit response from Common Crawl",
      errorKind: "http_429_rate_limit",
      attempts: 1,
      runs: 1
    }
  ];

  const checkedResults: CollectionCheckResult[] = MOCK_COLLECTIONS.map((collection) => ({
    collection,
    status: "checked",
    captures: capturesByCollection.get(collection.id) ?? [],
    httpStatus: 200,
    attempts: 1,
    runs: 1
  }));

  const scanLog = checkedResults.flatMap((result, index) => {
    const failure = failureResults.find((item) => item.collection.id === result.collection.id);
    return failure && index % 2 === 1 ? [failure, result] : [result];
  });

  return {
    collections: MOCK_COLLECTIONS,
    captures,
    failedResults: failureResults,
    scanLog
  };
}

export function createMockWarcRecord({
  filename,
  timestamp,
  url,
  collection
}: {
  filename: string;
  timestamp: string;
  url: string;
  collection: string;
}): ParsedWarcRecord {
  const title = url ? new URL(url).hostname : "Mock capture";
  return {
    warcHeaders: {
      "WARC-Type": "response",
      "WARC-Target-URI": url || "https://example.org/",
      "WARC-Date": timestamp || "mock-timestamp",
      "WARC-Record-ID": `<urn:uuid:mock-${timestamp || "capture"}>`,
      "Content-Type": "application/http; msgtype=response",
      "Content-Length": "mock"
    },
    httpHeaders: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "max-age=600",
      "x-common-crawl-mock": "true"
    },
    statusLine: "HTTP/1.1 200 OK",
    html: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${title} mock capture</title>
    <style>
      body { margin: 0; font-family: ui-sans-serif, system-ui, sans-serif; color: #151515; background: #f6f2e8; }
      header { padding: 42px; background: #1f2937; color: white; }
      main { padding: 42px; display: grid; gap: 20px; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }
      section { border: 1px solid #d6ccb8; background: white; padding: 22px; }
      small { color: #786f61; text-transform: uppercase; letter-spacing: .12em; font-weight: 700; }
    </style>
  </head>
  <body>
    <header>
      <small>${collection || "Mock Collection"} · ${timestamp || "snapshot"}</small>
      <h1>${title}</h1>
      <p>This is a local mock WARC record, so the viewer can be designed without calling Common Crawl.</p>
    </header>
    <main>
      <section><small>Snapshot URL</small><p>${url || "https://example.org/"}</p></section>
      <section><small>Filename</small><p>${filename}</p></section>
      <section><small>Preview State</small><p>HTML preview, source, headers, copy and download controls are available.</p></section>
    </main>
  </body>
</html>`
  };
}
