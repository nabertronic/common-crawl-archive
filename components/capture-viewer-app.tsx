"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, Copy, Download, FileCode2, Loader2, ShieldAlert } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  LARGE_CAPTURE_LIMIT_BYTES,
  warcRecordUrl,
  type CommonCrawlCapture,
  type MatchType
} from "@/lib/common-crawl";
import { loadCaptureRecord, type ParsedWarcRecord } from "@/lib/warc";
import { buildCapturePreviewDocument } from "@/lib/capture-preview";
import { markPerformance, measureAsync } from "@/lib/performance";
import { cn, formatBytes, formatTimestamp } from "@/lib/utils";
import { formatCaptureCitation, formatCaptureDateLong } from "@/lib/capture-citation";
import { Button } from "@/components/ui/button";
import { HtmlPrivacyWarningDialog } from "@/components/html-privacy-warning-dialog";
import {
  buildDownloadedHtml,
  checkCaptureIntegrity,
  formatCaptureTimestamp,
  type CaptureIntegrity
} from "@/lib/capture-integrity";
import { createMockWarcRecord, isMockCaptureFilename } from "@/lib/mock-data";
import { buildTabTitle, extractHtmlTitle } from "@/lib/app-meta";
import { CaptureNavBar } from "@/components/capture-navbar";
import {
  coverageCaptures,
  findOrCreateLegacySession,
  getCoverage,
  getSettings,
  getScanSession,
  getSearch,
  legacyScanSearchKeys,
  scanSearchKey,
  searchKey,
  subscribeToSearch,
  subscribeToSearchChanges,
  updateSettings
} from "@/lib/capture-store";
import { createViewerHref, parseViewerRoute, viewerBackHref } from "@/lib/navigation-state";

type ViewerState =
  | { kind: "loading"; source?: "cache" | "network" }
  | { kind: "loaded"; record: ParsedWarcRecord; source: "cache" | "network" }
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
  const routeState = useMemo(() => parseViewerRoute(params), [params]);
  const scanId = routeState.scanId;

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

  const legacyBackContext = routeState.legacyBackContext ?? {
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
  };
  const backHref = viewerBackHref({ scanId, legacyBackContext }) ?? "/";
  const backContext = useMemo(
    () => legacyBackContext,
    [legacyBackContext]
  );

  const [state, setState] = useState<ViewerState>({ kind: "loading" });
  const [activeTab, setActiveTab] = useState<"preview" | "source" | "headers">("preview");
  const [copied, setCopied] = useState(false);
  const [citationCopied, setCitationCopied] = useState(false);
  const [pendingHtmlAction, setPendingHtmlAction] = useState<"copy" | "download" | null>(null);
  const [showHtmlPrivacyWarning, setShowHtmlPrivacyWarning] = useState(true);
  const [largeCaptureLimitBytes, setLargeCaptureLimitBytes] = useState(LARGE_CAPTURE_LIMIT_BYTES);
  const [captures, setCaptures] = useState<CommonCrawlCapture[]>([]);
  const [allowLargeLoad, setAllowLargeLoad] = useState(false);
  const [showMismatchedPreview, setShowMismatchedPreview] = useState(false);
  const numericLength = Number(length);

  // Compare the link's url/timestamp with the record's own WARC headers.
  const integrity = useMemo<CaptureIntegrity | undefined>(
    () =>
      state.kind === "loaded"
        ? checkCaptureIntegrity({ linkUrl: url, linkTimestamp: timestamp, warcHeaders: state.record.warcHeaders })
        : undefined,
    [state, timestamp, url]
  );
  const previewBlocked = integrity?.status === "mismatch" && !showMismatchedPreview;

  const sortedCaptures = useMemo(
    () => [...captures].sort((a, b) => a.timestamp.localeCompare(b.timestamp)),
    [captures]
  );

  const currentIndex = useMemo(() => {
    if (captures.length === 0) return -1;
    return captures.findIndex(
      (c) => c.filename === filename && c.offset === offset && c.timestamp === timestamp
    );
  }, [captures, filename, offset, timestamp]);

  const currentSortedIndex = useMemo(() => {
    if (currentIndex < 0) return -1;
    const current = captures[currentIndex];
    if (!current) return -1;
    return sortedCaptures.findIndex(
      (capture) =>
        capture.timestamp === current.timestamp &&
        capture.filename === current.filename &&
        capture.offset === current.offset
    );
  }, [captures, currentIndex, sortedCaptures]);

  const routeCapture = useMemo<CommonCrawlCapture>(
    () => ({
      collectionId: collection,
      collectionName: collection,
      collectionFrom: "",
      collectionTo: "",
      timestamp,
      url,
      status: "",
      mime: "text/html",
      filename,
      offset,
      length
    }),
    [collection, filename, length, offset, timestamp, url]
  );

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1800);
    return () => window.clearTimeout(timer);
  }, [copied]);

  useEffect(() => {
    if (!citationCopied) return;
    const timer = window.setTimeout(() => setCitationCopied(false), 1800);
    return () => window.clearTimeout(timer);
  }, [citationCopied]);

  // Ledger dossier only. Built from the route and the loaded record's headers.
  const citationText = useMemo(
    () => formatCaptureCitation({ url, timestamp, collection, retrievedAt: new Date() }),
    [collection, timestamp, url]
  );
  const dossierDate = formatCaptureDateLong(timestamp) || "—";
  const dossierRows: { label: string; value: string }[] = [
    { label: "Captured (UTC)", value: /^\d{14}$/.test(timestamp) ? formatTimestamp(timestamp) : "—" },
    { label: "Original URL", value: url || "—" },
    { label: "Collection", value: collection || "—" },
    { label: "Payload digest", value: findHeaderValue(state.kind === "loaded" ? state.record.warcHeaders : undefined, "WARC-Payload-Digest") || "—" },
    { label: "Record ID", value: findHeaderValue(state.kind === "loaded" ? state.record.warcHeaders : undefined, "WARC-Record-ID") || "—" },
    { label: "Content type", value: findHeaderValue(state.kind === "loaded" ? state.record.httpHeaders : undefined, "content-type") || "—" },
    { label: "WARC file", value: filename || "—" },
    { label: "Byte range", value: offset && length ? formatByteRange(offset, length) : "—" }
  ];

  const copyCitation = useCallback(() => {
    const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard;
    if (!clipboard || typeof clipboard.writeText !== "function") return;
    void clipboard
      .writeText(citationText)
      .then(() => setCitationCopied(true))
      .catch(() => undefined);
  }, [citationText]);

  useEffect(() => {
    void getSettings()
      .then((settings) => {
        setShowHtmlPrivacyWarning(settings.showHtmlPrivacyWarning);
        setLargeCaptureLimitBytes(settings.largeCaptureLimitBytes);
      })
      .catch(() => setShowHtmlPrivacyWarning(true));
    const unsubscribe = subscribeToSearchChanges(() => {
      void getSettings()
        .then((settings) => {
          setShowHtmlPrivacyWarning(settings.showHtmlPrivacyWarning);
          setLargeCaptureLimitBytes(settings.largeCaptureLimitBytes);
        })
        .catch(() => setShowHtmlPrivacyWarning(true));
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    setAllowLargeLoad(false);
  }, [filename, offset, length, timestamp]);

  useEffect(() => {
    setShowMismatchedPreview(false);
  }, [filename, offset, length, timestamp, url]);

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
        record: createMockWarcRecord({ filename, timestamp, url, collection }),
        source: "network"
      });
      return;
    }
    if (!allowLargeLoad && Number.isFinite(numericLength) && numericLength > largeCaptureLimitBytes) {
      setState({ kind: "too-large", length: numericLength });
      return;
    }

    void measureAsync(
      "viewer-capture-record-load",
      () => loadCaptureRecord({ capture: routeCapture, allowLarge: allowLargeLoad, signal: controller.signal }),
      { allowLarge: allowLargeLoad }
    )
      .then(({ record, source }) => setState({ kind: "loaded", record, source }))
      .catch((error) => {
        if (controller.signal.aborted) return;
        setState({ kind: "error", message: error instanceof Error ? error.message : "Could not load WARC record." });
      });

    return () => controller.abort();
  }, [allowLargeLoad, collection, filename, largeCaptureLimitBytes, length, numericLength, offset, routeCapture, timestamp, url]);

  useEffect(() => {
    markPerformance("page-hydrated:viewer");
    if (scanId) {
      let cancelled = false;
      const load = () => {
        measureAsync("viewer-capture-manifest-load", () =>
          getScanSession(scanId).then((session) => session ? getCoverage(session.targetId) : undefined)
        )
          .then((coverage) => {
            if (!cancelled) setCaptures(coverageCaptures(coverage));
          });
      };
      load();
      const unsubscribe = subscribeToSearchChanges(load);
      return () => {
        cancelled = true;
        unsubscribe();
      };
    }
    if (!backUrl) return;
    const activeMatch = (backMatch as MatchType) || "exact";
    const mock = backMock === "1";
    const activeScope = backScope === "all" ? "all" : "recent";
    void findOrCreateLegacySession(backUrl, activeMatch, mock, activeScope);
    const keys = Array.from(new Set([
      scanSearchKey(backUrl, activeMatch, mock, activeScope),
      searchKey(backUrl, activeMatch, mock),
      ...legacyScanSearchKeys(backUrl, activeMatch, mock)
    ]));
    let cancelled = false;
    const load = () => {
      measureAsync("viewer-capture-manifest-load", () => Promise.all(keys.map((key) => getSearch(key)))).then((records) => {
        const stored = records
          .filter((record) => record?.captures?.length)
          .sort((left, right) => (right?.updatedAt ?? 0) - (left?.updatedAt ?? 0))[0];
        if (!cancelled && stored) setCaptures(stored.captures);
      });
    };
    load();
    const unsubscribers = keys.map((key) => subscribeToSearch(key, load));
    return () => {
      cancelled = true;
      for (const unsubscribe of unsubscribers) unsubscribe();
    };
  }, [scanId, backUrl, backMatch, backMock, backScope]);

  const navigateToCapture = useCallback(
    (capture: CommonCrawlCapture) => {
      router.replace(createViewerHref(capture, { scanId, legacyBackContext: backContext }));
    },
    [router, scanId, backContext]
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
      if (currentSortedIndex < 0) return;
      if (event.key === "ArrowLeft" && currentSortedIndex > 0) {
        event.preventDefault();
        navigateToCapture(sortedCaptures[currentSortedIndex - 1]);
      } else if (event.key === "ArrowRight" && currentSortedIndex < sortedCaptures.length - 1) {
        event.preventDefault();
        navigateToCapture(sortedCaptures[currentSortedIndex + 1]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [captures, currentSortedIndex, navigateToCapture, sortedCaptures]);

  const sanitizedHtml = useMemo(
    () => (state.kind === "loaded" ? buildCapturePreviewDocument(state.record.html) : ""),
    [state]
  );

  const copyHtml = useCallback(() => {
    if (state.kind !== "loaded") return;
    void (async () => {
      try {
        await navigator.clipboard.writeText(state.record.html);
        setCopied(true);
      } catch {
        // ignore — clipboard may be unavailable
      }
    })();
  }, [state]);

  const downloadHtml = useCallback(() => {
    if (state.kind !== "loaded") return;
    // Downloaded HTML carries a CSP so opening it locally cannot run scripts or
    // fetch remote assets. Copy HTML stays the raw archived markup.
    const blob = new Blob([buildDownloadedHtml(state.record.html)], { type: "text/html;charset=utf-8" });
    const downloadUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = downloadUrl;
    anchor.download = `${timestamp || "capture"}.html`;
    anchor.click();
    URL.revokeObjectURL(downloadUrl);
  }, [state, timestamp]);

  const confirmPendingHtmlAction = useCallback(() => {
    const action = pendingHtmlAction;
    setPendingHtmlAction(null);
    if (action === "copy") copyHtml();
    if (action === "download") downloadHtml();
  }, [copyHtml, downloadHtml, pendingHtmlAction]);

  const requestHtmlAction = useCallback((action: "copy" | "download") => {
    if (showHtmlPrivacyWarning) {
      setPendingHtmlAction(action);
      return;
    }
    if (action === "copy") copyHtml();
    if (action === "download") downloadHtml();
  }, [copyHtml, downloadHtml, showHtmlPrivacyWarning]);

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
        sortedCaptures={sortedCaptures}
        currentIndex={currentIndex}
        backHref={scanId || backUrl ? backHref : null}
        onJumpTo={handleJumpTo}
      />

      <div className="flex min-h-0 flex-1 flex-col ledger:overflow-y-auto lg:ledger:flex-row lg:ledger:overflow-hidden">
        {state.kind === "loading" ? (
          <section className="grid flex-1 min-h-96 place-items-center bg-zinc-950/40 p-8">
            <div className="text-center">
              <Loader2 className="mx-auto mb-3 animate-spin text-amber-200" size={30} />
              <p className="font-semibold">Loading capture...</p>
              <p className="mt-1 text-sm text-zinc-500">
                {allowLargeLoad
                  ? "Loading the full WARC range from Common Crawl."
                  : "Checking local cache before requesting Common Crawl."}
              </p>
              <p className="mt-1 text-xs text-zinc-500">{isMockCaptureFilename(filename) ? filename : warcRecordUrl(filename)}</p>
            </div>
          </section>
        ) : null}

        {state.kind === "too-large" ? (
          <div className="p-4 lg:ledger:min-w-0 lg:ledger:flex-1">
            <LargeCaptureNotice length={state.length} limitBytes={largeCaptureLimitBytes} onLoadAnyway={() => setAllowLargeLoad(true)} />
          </div>
        ) : null}

        {state.kind === "error" ? (
          <div className="p-4 lg:ledger:min-w-0 lg:ledger:flex-1">
            <Notice title="Could not render capture" message={state.message} />
          </div>
        ) : null}

        {state.kind === "loaded" ? (
          <section className="flex min-h-0 flex-1 flex-col overflow-hidden bg-zinc-950 ledger:min-h-[70dvh] ledger:flex-none lg:ledger:min-h-0 lg:ledger:min-w-0 lg:ledger:flex-1">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800 p-3 ledger:bg-zinc-900">
              <div className="flex gap-1 max-sm:w-full max-sm:[&>*]:flex-1">
                {(["preview", "source", "headers"] as const).map((tab) => (
                  <Button
                    key={tab}
                    size="sm"
                    variant={activeTab === tab ? "primary" : "ghost"}
                    onClick={() => setActiveTab(tab)}
                    className="ledger:font-sans ledger:normal-case ledger:tracking-normal"
                  >
                    {tab}
                  </Button>
                ))}
              </div>
              <div className="flex gap-2 max-sm:w-full max-sm:[&>button]:flex-1">
                <Button
                  variant="secondary"
                  size="sm"
                  aria-live="polite"
                  onClick={() => requestHtmlAction("copy")}
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
                  onClick={() => requestHtmlAction("download")}
                >
                  <Download size={14} />
                  Download HTML
                </Button>
              </div>
            </div>
            {integrity?.status === "mismatch" ? (
              <IntegrityWarning
                linkUrl={url}
                linkTimestamp={timestamp}
                integrity={integrity}
                previewShown={!previewBlocked}
                onShowAnyway={() => setShowMismatchedPreview(true)}
              />
            ) : null}
            {activeTab === "preview" && previewBlocked ? (
              <div className="grid min-h-0 flex-1 place-items-center bg-zinc-950 p-6 text-center text-sm text-zinc-500">
                Preview hidden until you confirm this record is the one you expected.
              </div>
            ) : null}
            {activeTab === "preview" && !previewBlocked ? (
              <div className="min-h-0 flex-1 bg-white ledger:flex ledger:flex-col ledger:bg-transparent ledger:p-3 ledger:sm:p-6">
                <div
                  aria-hidden="true"
                  className="hidden ledger:block ledger:shrink-0 ledger:pb-2 ledger:font-sans ledger:text-[13px] ledger:text-zinc-400"
                >
                  Sandboxed preview: scripts and external requests are blocked
                </div>
                <div className="h-full w-full bg-white ledger:relative ledger:min-h-0 ledger:flex-1 ledger:border ledger:border-zinc-800 ledger:bg-[#fff] ledger:shadow-none">
                  <iframe
                    title="Sanitized capture preview"
                    sandbox=""
                    srcDoc={sanitizedHtml}
                    className="block h-full w-full bg-white ledger:bg-[#fff]"
                  />
                </div>
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

        <aside
          aria-label="Capture record"
          className="hidden ledger:flex ledger:w-full ledger:shrink-0 ledger:flex-col ledger:border-t ledger:border-zinc-50 ledger:bg-zinc-950 ledger:p-6 ledger:pb-[max(2.5rem,env(safe-area-inset-bottom))] lg:ledger:h-full lg:ledger:min-h-0 lg:ledger:w-[340px] lg:ledger:overflow-y-auto lg:ledger:border-l lg:ledger:border-t-0"
        >
          <h2 className="ledger:font-serif ledger:text-[30px] ledger:font-normal ledger:leading-[1.1] ledger:tracking-[-0.02em] ledger:text-zinc-50">
            {dossierDate}
          </h2>
          <dl className="ledger:mt-[18px]">
            {dossierRows.map((row) => (
              <div key={row.label} className="ledger:border-b ledger:border-zinc-800 ledger:py-2.5">
                <dt className="ledger-label ledger:text-xs ledger:normal-case ledger:tracking-normal">{row.label}</dt>
                <dd className="ledger:mt-1 ledger:break-all ledger:font-mono ledger:text-sm ledger:text-zinc-50">{row.value}</dd>
              </div>
            ))}
          </dl>
          <div className="ledger:mt-[22px] ledger:grid ledger:gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              aria-live="polite"
              onClick={copyCitation}
              className="ledger:w-full ledger:justify-center"
            >
              {citationCopied ? <Check size={14} /> : <Copy size={14} />}
              {citationCopied ? "Copied" : "Copy citation"}
            </Button>
          </div>
          <div className="ledger:mt-6 ledger:border ledger:border-dashed ledger:border-zinc-600 ledger:p-3.5 ledger:font-mono ledger:text-[12.5px] ledger:leading-[1.55] ledger:text-zinc-300 ledger:break-words">
            {citationText}
          </div>
          <p className="ledger:mt-[18px] ledger:text-[13.5px] ledger:leading-normal ledger:text-zinc-300">
            Common Crawl saved this page on the date shown above. That is not necessarily the day the page went live.
          </p>
        </aside>
      </div>
      <HtmlPrivacyWarningDialog
        open={pendingHtmlAction !== null}
        actionLabel={pendingHtmlAction === "copy" ? "Copy HTML" : "Download HTML"}
        protectedDownload={pendingHtmlAction === "download"}
        onCancel={() => setPendingHtmlAction(null)}
        onContinue={({ dontShowAgain }) => {
          if (dontShowAgain) {
            setShowHtmlPrivacyWarning(false);
            void updateSettings({ showHtmlPrivacyWarning: false }).catch(() => undefined);
          }
          confirmPendingHtmlAction();
        }}
      />
    </main>
  );
}

function IntegrityWarning({
  linkUrl,
  linkTimestamp,
  integrity,
  previewShown,
  onShowAnyway
}: {
  linkUrl: string;
  linkTimestamp: string;
  integrity: Extract<CaptureIntegrity, { status: "mismatch" }>;
  previewShown: boolean;
  onShowAnyway: () => void;
}) {
  const recordDate = integrity.recordDate || "missing";
  return (
    <section role="alert" className="m-3 rounded-md border border-red-400/40 bg-red-400/10 p-4 text-sm text-red-100 ledger:rounded-none">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex gap-3">
          <ShieldAlert className="mt-1 shrink-0 text-red-300" size={22} />
          <div className="space-y-2">
            <h2 className="font-bold text-zinc-100">This link does not match the archived record</h2>
            <p className="max-w-2xl text-xs leading-5 text-red-100/85">
              The link says it shows a capture of {linkUrl || "an unknown URL"} from{" "}
              {formatCaptureTimestamp(linkTimestamp)}. The archived record itself is different.
            </p>
            <dl className="grid gap-1 text-xs">
              <div className="flex flex-wrap gap-x-2">
                <dt className="font-bold text-zinc-300">Record URL:</dt>
                <dd className="break-all">{integrity.recordUrl || "missing"}</dd>
              </div>
              <div className="flex flex-wrap gap-x-2">
                <dt className="font-bold text-zinc-300">Record date:</dt>
                <dd>{recordDate}</dd>
              </div>
            </dl>
            {integrity.urlDiffersOnlyByVariant ? (
              <p className="text-xs leading-5 text-red-100/75">
                The URLs differ only by http/https or www., so this may be a harmless alias.
              </p>
            ) : null}
          </div>
        </div>
        {previewShown ? null : (
          <Button type="button" variant="secondary" size="sm" onClick={onShowAnyway} className="shrink-0 justify-center">
            Show anyway
          </Button>
        )}
      </div>
    </section>
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

function LargeCaptureNotice({ length, limitBytes, onLoadAnyway }: { length: number; limitBytes: number; onLoadAnyway: () => void }) {
  return (
    <section className="archive-panel rounded-md p-6">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex gap-3">
          <ShieldAlert className="mt-1 shrink-0 text-amber-200" size={24} />
          <div>
            <h2 className="font-bold text-zinc-100">Capture is unusually large</h2>
            <p className="mt-1 max-w-2xl text-sm text-zinc-400">
              This compressed WARC record is {formatBytes(length)}. The viewer normally stops at{" "}
              {formatBytes(limitBytes)} to avoid long waits, high memory use, or a stalled tab.
            </p>
            <p className="mt-3 max-w-2xl text-xs leading-5 text-zinc-500">
              Loading it anyway fetches and decompresses the full range in this browser. Keep the tab open and expect
              slower rendering if the archived HTML is very large.
            </p>
          </div>
        </div>
        <Button type="button" variant="primary" onClick={onLoadAnyway} className="shrink-0 justify-center">
          <Download size={16} />
          Load anyway
        </Button>
      </div>
    </section>
  );
}

function findHeaderValue(headers: Record<string, string> | undefined, name: string): string | undefined {
  if (!headers) return undefined;
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.trim().toLowerCase() === wanted && value.trim()) return value.trim();
  }
  return undefined;
}

// Inclusive first-last byte positions, the same convention as an HTTP Range header.
function formatByteRange(offset: string, length: string): string {
  const start = Number(offset);
  const size = Number(length);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(size) || start < 0 || size <= 0) {
    return `${offset}, ${length}`;
  }
  return `${start}–${start + size - 1}`;
}

function HeaderBlock({ title, headers }: { title: string; headers: Record<string, string> }) {
  return (
    <section className="rounded-md border border-zinc-800 bg-zinc-950 p-4 ledger:rounded-none">
      <div className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-[0.14em] ledger:font-mono ledger:text-[11.5px] ledger:normal-case ledger:tracking-normal">
        <FileCode2 size={15} />
        {title}
      </div>
      <dl className="space-y-2 ledger:!space-y-0">
        {Object.entries(headers).map(([key, value]) => (
          <div key={key} className="ledger:border-b ledger:border-zinc-800 ledger:py-2">
            <dt className="text-xs font-bold uppercase tracking-[0.14em] text-zinc-500 ledger:font-mono ledger:text-[11px] ledger:normal-case ledger:tracking-normal">{key}</dt>
            <dd className="break-all text-xs text-zinc-300 ledger:mt-1 ledger:font-mono ledger:text-[13px]">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
