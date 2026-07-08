"use client";

import { useCallback, useEffect, useState } from "react";
import { getPerfSummary, observePerformance, type PerfSummaryEntry } from "@/lib/performance";

/**
 * Development-only overlay that aggregates the `crawlback:*` Performance
 * measures into a small p50/p95 table. It is mounted behind a NODE_ENV guard in
 * the root layout, so it is tree-shaken out of production bundles. It reads the
 * timeline only — it never records marks itself and never affects app behavior.
 */
export function PerfPanel() {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<PerfSummaryEntry[]>([]);

  const refresh = useCallback(() => {
    setRows(getPerfSummary());
  }, []);

  useEffect(() => {
    refresh();
    // Re-aggregate shortly after new measures land, coalescing bursts.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const disconnect = observePerformance(() => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = undefined;
        refresh();
      }, 250);
    });
    return () => {
      if (timer) clearTimeout(timer);
      disconnect();
    };
  }, [refresh]);

  const fmt = (value: number) => `${value.toFixed(1)}ms`;

  return (
    <div
      style={{
        position: "fixed",
        bottom: 8,
        right: 8,
        zIndex: 2147483647,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: 11,
        color: "#e5e7eb",
        pointerEvents: "none"
      }}
    >
      <div style={{ pointerEvents: "auto" }}>
        <button
          type="button"
          onClick={() => {
            refresh();
            setOpen((value) => !value);
          }}
          style={{
            background: "rgba(17,24,39,0.9)",
            border: "1px solid rgba(255,255,255,0.15)",
            borderRadius: 6,
            color: "#e5e7eb",
            padding: "3px 8px",
            cursor: "pointer"
          }}
        >
          ⏱ perf{rows.length > 0 ? ` (${rows.length})` : ""}
        </button>
        {open && (
          <div
            style={{
              marginTop: 6,
              maxHeight: "50vh",
              overflow: "auto",
              background: "rgba(17,24,39,0.96)",
              border: "1px solid rgba(255,255,255,0.15)",
              borderRadius: 8,
              padding: 8,
              minWidth: 320
            }}
          >
            <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
              <button type="button" onClick={refresh} style={panelButtonStyle}>
                refresh
              </button>
              <button
                type="button"
                onClick={() => {
                  // eslint-disable-next-line no-console
                  console.table(getPerfSummary());
                }}
                style={panelButtonStyle}
              >
                console.table
              </button>
              <button
                type="button"
                onClick={() => {
                  try {
                    performance.clearMeasures();
                    performance.clearMarks();
                  } catch {
                    // clearing is best-effort
                  }
                  refresh();
                }}
                style={panelButtonStyle}
              >
                clear
              </button>
            </div>
            {rows.length === 0 ? (
              <div style={{ opacity: 0.7 }}>no crawlback measures yet</div>
            ) : (
              <table style={{ borderCollapse: "collapse", width: "100%" }}>
                <thead>
                  <tr style={{ textAlign: "right", opacity: 0.7 }}>
                    <th style={{ textAlign: "left", paddingRight: 8 }}>measure</th>
                    <th style={cellStyle}>n</th>
                    <th style={cellStyle}>p50</th>
                    <th style={cellStyle}>p95</th>
                    <th style={cellStyle}>max</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.name}>
                      <td style={{ paddingRight: 8, whiteSpace: "nowrap" }}>{row.name}</td>
                      <td style={cellStyle}>{row.count}</td>
                      <td style={cellStyle}>{fmt(row.p50)}</td>
                      <td style={cellStyle}>{fmt(row.p95)}</td>
                      <td style={cellStyle}>{fmt(row.max)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const panelButtonStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.08)",
  border: "1px solid rgba(255,255,255,0.15)",
  borderRadius: 4,
  color: "#e5e7eb",
  padding: "2px 6px",
  cursor: "pointer",
  fontSize: 11
};

const cellStyle: React.CSSProperties = { textAlign: "right", padding: "1px 4px", whiteSpace: "nowrap" };

export default PerfPanel;
