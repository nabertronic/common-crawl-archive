// Compute worker: runs pure, CPU-heavy assembly off the main thread. It must
// stay free of DOM/IndexedDB access so it can be bundled as a module worker.
// The main thread talks to it through lib/compute-client.ts, which falls back to
// running the same functions inline if the worker is unavailable (SSR, tests, or
// a CSP block), so correctness never depends on the worker loading.
import { buildZipBytes, type ZipEntry } from "@/lib/zip";
import { rowsToCsv } from "@/lib/csv";

type ComputeRequest =
  | { id: number; op: "zip"; payload: ZipEntry[] }
  | { id: number; op: "csv"; payload: string[][] };

type ComputeResponse =
  | { id: number; ok: true; result: ArrayBuffer | string }
  | { id: number; ok: false; error: string };

self.onmessage = (event: MessageEvent<ComputeRequest>) => {
  const { id } = event.data;
  const post = (response: ComputeResponse, transfer?: Transferable[]) =>
    (self as unknown as Worker).postMessage(response, transfer ?? []);
  try {
    if (event.data.op === "zip") {
      const bytes = buildZipBytes(event.data.payload);
      // Transfer the buffer to avoid a copy back across the thread boundary.
      post({ id, ok: true, result: bytes.buffer as ArrayBuffer }, [bytes.buffer as ArrayBuffer]);
      return;
    }
    if (event.data.op === "csv") {
      post({ id, ok: true, result: rowsToCsv(event.data.payload) });
      return;
    }
    post({ id, ok: false, error: `Unknown op` });
  } catch (error) {
    post({ id, ok: false, error: error instanceof Error ? error.message : String(error) });
  }
};
