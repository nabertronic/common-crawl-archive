"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, Copy, Download, FileCode2, Loader2 } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  LARGE_CAPTURE_LIMIT_BYTES,
  buildResultsBackHref,
  captureToViewerParams,
  appendResultsBackContext,
  warcRecordUrl,
  type CommonCrawlCapture,
  type MatchType
} from "@/lib/common-crawl";
import { fetchAndParseWarcRecord, sanitizeHtmlForPreview, type ParsedWarcRecord } from "@/lib/warc";
import { cn, formatBytes } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { createMockWarcRecord, isMockCaptureFilename } from "@/lib/mock-data";
import { buildTabTitle, extractHtmlTitle } from "@/lib/app-meta";
import { CaptureNavBar } from "@/components/capture-navbar";
import { getSearch, scanSearchKey, searchKey, subscribeToSearch } from "@/lib/capture-store";

type ViewerState =
  | { kind: "loading" }
  | { kind: "loaded"; record: ParsedWarcRecord }
  | { kind: "too-large"; length: number }
  | { kind: "error"; message: string };

export function CaptureViewerApp() {
  const params = useSearchParams();
  const router = useRouter();
  const filename = params.get("filename") ?? "";
  const offset = params.get("offset") ?? "";
  const length = params.get("length") ?? "";
  const timestamp = params.get("timestamp") ?? "";
  const url = params.get("url") ?? "";
  const collection = params.get("collection") ?? "";

  const backUrl = params.get("back_url");
  const backMatch = params.get("back_match");
  const backMock = params.get("back_mock");
  const backScope = params.get("back_scope");
  const backHistory = params.get("back_history");
  const backYear = params.get("back_year");
  const backCollection = params.get("back_collection");
  const backMime = params.get("back_mime");
  const backStatus = params.get("back_status");
  const backFilter = params.get("back_filter");
  const backSort = params.get("back_sort");
  const backView = params.get("back_view");
  const backPage = params.get("back_page");

  const backHref = buildResultsBackHref({
    url: backUrl,
    match: backMatch,
    mock: backMock,
    scope: backScope,
    history: backHistory,
    year: backYear,
    collection: backCollection,
    mime: backMime,
    status: backStatus,
    filter: backFilter,
    sort: backSort,
    view: backView,
    page: backPage
  }) ?? "/";
  const backContext = useMemo(
    () => ({
      url: backUrl,
      match: backMatch,
      mock: backMock,
      scope: backScope,
      history: backHistory,
      year: backYear,
      collection: backCollection,
      mime: backMime,
      status: backStatus,
      filter: backFilter,
      sort: backSort,
      view: backView,
      page: backPage
    }),
    [backCollection, backFilter, backHistory, backMatch, backMime, backMock, backPage, backScope, backSort, backStatus, backUrl, backView, backYear]
  );

  const [state, setState] = useState<ViewerState>({ kind: "loading" });
  const [activeTab, setActiveTab] = useState<"preview" | "source" | "headers">("preview");
  const [copied, setCopied] = useState(false);
  const [captures, setCaptures] = useState<CommonCrawlCapture[]>([]);
  const numericLength = Number(length);

  const currentIndex = useMemo(() => {
    if (captures.length === 0) return -1;
    return captures.findIndex(
      (c) => c.filename === filename && c.offset === offset && c.timestamp === timestamp
    );
  }, [captures, filename, offset, timestamp]);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1800);
    return () => window.clearTimeout(timer);
  }, [copied]);

  useEffect(() => {
    setState({ kind: "loading" });
    const controller = new AbortController();
    if (!filename || !offset || !length) {
      setState({ kind: "error", message: "Missing WARC metadata in the viewer URL." });
      return;
    }
    if (isMockCaptureFilename(filename)) {
      setState({
        kind: "loaded",
        record: createMockWarcRecord({ filename, timestamp, url, collection })
      });
      return;
    }
    if (Number.isFinite(numericLength) && numericLength > LARGE_CAPTURE_LIMIT_BYTES) {
      setState({ kind: "too-large", length: numericLength });
      return;
    }

    void fetchAndParseWarcRecord({ filename, offset, length, signal: controller.signal })
      .then((record) => setState({ kind: "loaded", record }))
      .catch((error) => {
        if (controller.signal.aborted) return;
        setState({ kind: "error", message: error instanceof Error ? error.message : "Could not load WARC record." });
      });

    return () => controller.abort();
  }, [collection, filename, length, numericLength, offset, timestamp, url]);

  useEffect(() => {
    if (!backUrl) return;
    const activeMatch = (backMatch as MatchType) || "exact";
    const mock = backMock === "1";
    const keys = backScope === "all"
      ? [scanSearchKey(backUrl, activeMatch, mock, "all"), searchKey(backUrl, activeMatch, mock)]
      : [searchKey(backUrl, activeMatch, mock)];
    let cancelled = false;
    const load = () => {
      Promise.all(keys.map((key) => getSearch(key))).then((records) => {
        const stored = records.find((record) => record?.captures?.length);
        if (!cancelled && stored) setCaptures(stored.captures);
      });
    };
    load();
    const unsubscribers = keys.map((key) => subscribeToSearch(key, load));
    return () => {
      cancelled = true;
      for (const unsubscribe of unsubscribers) unsubscribe();
    };
  }, [backUrl, backMatch, backMock, backScope]);

  const navigateToCapture = useCallback(
    (capture: CommonCrawlCapture) => {
      const next = captureToViewerParams(capture);
      appendResultsBackContext(next, backContext);
      router.replace(`/view?${next.toString()}`);
    },
    [router, backContext]
  );

  const handleJumpTo = useCallback(
    (index: number) => {
      const capture = captures[index];
      if (capture) navigateToCapture(capture);
    },
    [captures, navigateToCapture]
  );

  useEffect(() => {
    if (captures.length === 0) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      const sorted = [...captures].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
      const current = captures[currentIndex];
      if (!current) return;
      const sortedIndex = sorted.findIndex(
        (c) => c.timestamp === current.timestamp && c.filename === current.filename && c.offset === current.offset
      );
      if (sortedIndex < 0) return;
      if (event.key === "ArrowLeft" && sortedIndex > 0) {
        event.preventDefault();
        navigateToCapture(sorted[sortedIndex - 1]);
      } else if (event.key === "ArrowRight" && sortedIndex < sorted.length - 1) {
        event.preventDefault();
        navigateToCapture(sorted[sortedIndex + 1]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [captures, currentIndex, navigateToCapture]);

  const sanitizedHtml = useMemo(
    () => (state.kind === "loaded" ? sanitizeHtmlForPreview(state.record.html) : ""),
    [state]
  );

  useEffect(() => {
    const htmlTitle = state.kind === "loaded" ? extractHtmlTitle(state.record.html) : "";
    document.title = buildTabTitle(htmlTitle);
  }, [state]);

  return (
    <main className="flex h-dvh min-h-0 flex-col overflow-hidden text-zinc-100">
      <CaptureNavBar
        url={url}
        timestamp={timestamp}
        captures={captures}
        currentIndex={currentIndex}
        backHref={backUrl ? backHref : null}
        onJumpTo={handleJumpTo}
      />

      <div className="flex min-h-0 flex-1 flex-col">
        {state.kind === "loading" ? (
          <section className="grid flex-1 min-h-96 place-items-center bg-zinc-950/40 p-8">
            <div className="text-center">
              <Loader2 className="mx-auto mb-3 animate-spin text-amber-200" size={30} />
              <p className="font-semibold">Loading WARC range from Common Crawl...</p>
              <p className="mt-1 text-sm text-zinc-500">
                {isMockCaptureFilename(filename) ? filename : warcRecordUrl(filename)}
              </p>
            </div>
          </section>
        ) : null}

        {state.kind === "too-large" ? (
          <div className="p-4">
            <Notice
              title="Capture exceeds the MVP viewer limit"
              message={`This compressed WARC record is ${formatBytes(state.length)}. The MVP viewer limit is ${formatBytes(LARGE_CAPTURE_LIMIT_BYTES)}.`}
            />
          </div>
        ) : null}

        {state.kind === "error" ? (
          <div className="p-4">
            <Notice title="Could not render capture" message={state.message} />
          </div>
        ) : null}

        {state.kind === "loaded" ? (
          <section className="flex min-h-0 flex-1 flex-col overflow-hidden bg-zinc-950">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800 p-3">
              <div className="flex gap-1">
                {(["preview", "source", "headers"] as const).map((tab) => (
                  <Button
                    key={tab}
                    size="sm"
                    variant={activeTab === tab ? "primary" : "ghost"}
                    onClick={() => setActiveTab(tab)}
                  >
                    {tab}
                  </Button>
                ))}
              </div>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  aria-live="polite"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(state.record.html);
                      setCopied(true);
                    } catch {
                      // ignore — clipboard may be unavailable
                    }
                  }}
                  className={cn(
                    "relative overflow-hidden transition-colors",
                    copied && "border-emerald-400/60 bg-emerald-400/15 text-emerald-100"
                  )}
                >
                  <span
                    key={copied ? "copied" : "idle"}
                    className="inline-flex items-center gap-2 animate-[copy-pop_220ms_ease-out]"
                  >
                    {copied ? <Check size={14} className="text-emerald-300" /> : <Copy size={14} />}
                    {copied ? "Copied!" : "Copy HTML"}
                  </span>
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    const blob = new Blob([state.record.html], { type: "text/html;charset=utf-8" });
                    const downloadUrl = URL.createObjectURL(blob);
                    const anchor = document.createElement("a");
                    anchor.href = downloadUrl;
                    anchor.download = `${timestamp || "capture"}.html`;
                    anchor.click();
                    URL.revokeObjectURL(downloadUrl);
                  }}
                >
                  <Download size={14} />
                  Download HTML
                </Button>
              </div>
            </div>
            {activeTab === "preview" ? (
              <div className="min-h-0 flex-1 bg-white">
                <iframe
                  title="Sanitized capture preview"
                  sandbox=""
                  srcDoc={sanitizedHtml}
                  className="block h-full w-full bg-white"
                />
              </div>
            ) : null}
            {activeTab === "source" ? (
              <pre className="thin-scrollbar min-h-0 flex-1 overflow-auto p-4 text-xs leading-5 text-zinc-300">
                {state.record.html}
              </pre>
            ) : null}
            {activeTab === "headers" ? (
              <div className="grid min-h-0 flex-1 gap-4 overflow-auto p-4">
                <HeaderBlock title={state.record.statusLine || "HTTP headers"} headers={state.record.httpHeaders} />
              </div>
            ) : null}
          </section>
        ) : null}
      </div>
    </main>
  );
}

function Notice({ title, message }: { title: string; message: string }) {
  return (
    <section className="archive-panel rounded-md p-6">
      <div className="flex gap-3">
        <AlertTriangle className="mt-1 shrink-0 text-amber-200" size={22} />
        <div>
          <h2 className="font-bold text-zinc-100">{title}</h2>
          <p className="mt-1 text-sm text-zinc-400">{message}</p>
        </div>
      </div>
    </section>
  );
}

function HeaderBlock({ title, headers }: { title: string; headers: Record<string, string> }) {
  return (
    <section className="rounded-md border border-zinc-800 bg-zinc-950 p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-[0.14em]">
        <FileCode2 size={15} />
        {title}
      </div>
      <dl className="space-y-2">
        {Object.entries(headers).map(([key, value]) => (
          <div key={key}>
            <dt className="text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-500">{key}</dt>
            <dd className="break-all text-xs text-zinc-300">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
