// Tiny dependency-free RPC to the compute worker. Every public helper degrades
// to running the same pure function on the main thread if the worker cannot be
// created or fails to load (SSR, jsdom tests, or a CSP block), so the worker is
// a pure performance optimization and never a correctness dependency.
import { buildZipBytes, type ZipEntry } from "@/lib/zip";
import { rowsToCsv } from "@/lib/csv";

type ComputeResult = ArrayBuffer | string;
type Pending = { resolve: (value: ComputeResult) => void; reject: (error: Error) => void };

// undefined = not yet attempted, null = known unavailable (fall back inline).
let worker: Worker | null | undefined;
let sequence = 0;
const pending = new Map<number, Pending>();

function failAllPending(reason: string) {
  for (const [, entry] of pending) entry.reject(new Error(reason));
  pending.clear();
}

function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  if (typeof Worker === "undefined") {
    worker = null;
    return null;
  }
  try {
    const instance = new Worker(new URL("./workers/compute.worker.ts", import.meta.url), { type: "module" });
    instance.onmessage = (event: MessageEvent<{ id: number; ok: boolean; result?: ComputeResult; error?: string }>) => {
      const { id, ok, result, error } = event.data;
      const entry = pending.get(id);
      if (!entry) return;
      pending.delete(id);
      if (ok && result !== undefined) entry.resolve(result);
      else entry.reject(new Error(error ?? "compute worker error"));
    };
    instance.onerror = () => {
      // Script failed to load/execute (e.g. blocked by CSP). Disable the worker
      // and let pending + future calls fall back to the main thread.
      worker = null;
      failAllPending("compute worker failed to load");
    };
    worker = instance;
    return instance;
  } catch {
    worker = null;
    return null;
  }
}

function callWorker(op: "zip" | "csv", payload: unknown): Promise<ComputeResult> {
  const active = getWorker();
  if (!active) return Promise.reject(new Error("compute worker unavailable"));
  const id = (sequence += 1);
  return new Promise<ComputeResult>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    try {
      active.postMessage({ id, op, payload });
    } catch (error) {
      pending.delete(id);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

/**
 * Build ZIP bytes for the given entries, off the main thread when possible.
 * Falls back to synchronous main-thread assembly on any worker failure.
 */
export async function computeZipBytes(entries: ZipEntry[]): Promise<Uint8Array<ArrayBuffer>> {
  try {
    const result = await callWorker("zip", entries);
    if (result instanceof ArrayBuffer) return new Uint8Array(result);
    throw new Error("unexpected worker result for zip");
  } catch {
    return buildZipBytes(entries);
  }
}

/**
 * Serialize CSV rows off the main thread when possible; falls back to
 * synchronous main-thread serialization on any worker failure.
 */
export async function computeCsv(rows: string[][]): Promise<string> {
  try {
    const result = await callWorker("csv", rows);
    if (typeof result === "string") return result;
    throw new Error("unexpected worker result for csv");
  } catch {
    return rowsToCsv(rows);
  }
}

/** Test-only reset of the memoized worker state. */
export function __resetComputeWorkerForTests() {
  if (worker) {
    try {
      worker.terminate();
    } catch {
      // ignore
    }
  }
  worker = undefined;
  failAllPending("reset");
}
