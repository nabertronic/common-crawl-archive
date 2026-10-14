import { sanitizeHtmlForPreview } from "@/lib/warc";

// srcdoc inherits the app's CSP, which permits app/API and archive requests.
// Add a stricter policy before any untrusted markup so CSS and residual HTML
// cannot trigger network requests. The empty iframe sandbox remains required.
export function buildCapturePreviewDocument(html: string): string {
  const policy = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'";
  return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${policy}"></head><body>${sanitizeHtmlForPreview(html)}</body></html>`;
}
