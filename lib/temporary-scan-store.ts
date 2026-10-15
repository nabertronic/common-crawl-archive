import type * as Store from "./capture-store";
import { targetIdFor } from "./capture-store";
import { mergeCollectionResult } from "./scan-results";

/** Visit-local scan state keeps PastPage scans independent of storage decisions. */
export function createTemporaryScanStore() {
  const sessions = new Map<string, Store.ScanSession>();
  const coverages = new Map<string, Store.CoverageRecord>();
  const ensureTarget: typeof Store.ensureTarget = async (url, matchType, mock) => ({
    targetId: targetIdFor(url, matchType, mock), url, matchType, mock,
    createdAt: Date.now(), updatedAt: Date.now()
  });
  const coverageFor = (target: Pick<Store.SearchTarget, "targetId" | "url" | "matchType" | "mock">) => {
    let coverage = coverages.get(target.targetId);
    if (!coverage) {
      coverage = { ...target, collectionResults: {}, updatedAt: Date.now() };
      coverages.set(target.targetId, coverage);
    }
    return coverage;
  };
  const ensureScanSession: typeof Store.ensureScanSession = async (input) => {
    const target = await ensureTarget(input.url, input.matchType, input.mock);
    const scanId = input.scanId ?? `temporary_${crypto.randomUUID()}`;
    const session = { ...sessions.get(scanId), ...target, ...input, scanId, targetId: target.targetId };
    sessions.set(scanId, session);
    return session;
  };
  const getCoverage: typeof Store.getCoverage = async (targetId) => coverages.get(targetId);
  const startCoverageRun: typeof Store.startCoverageRun = async (target, startedAt, durationMs, metadata) => {
    Object.assign(coverageFor(target), metadata, { activeScanStartedAt: startedAt, durationMs });
  };
  const addCoverageDuration: typeof Store.addCoverageDuration = async (targetId, durationMs) => {
    const coverage = coverages.get(targetId);
    if (coverage) {
      coverage.durationMs = (coverage.durationMs ?? 0) + durationMs;
      coverage.activeScanStartedAt = undefined;
    }
  };
  const appendCoverageScanLogEntry: typeof Store.appendCoverageScanLogEntry = async (target, entry) => {
    const coverage = coverageFor(target);
    coverage.scanLogResults = [...(coverage.scanLogResults ?? []), entry];
    return coverage;
  };
  const upsertCoverageResult: typeof Store.upsertCoverageResult = async (target, result) => {
    const coverage = coverageFor(target);
    coverage.collectionResults[result.collection.id] = mergeCollectionResult(coverage.collectionResults[result.collection.id], result);
    return coverage;
  };
  return { ensureTarget, ensureScanSession, getCoverage, startCoverageRun, addCoverageDuration, appendCoverageScanLogEntry, upsertCoverageResult };
}
