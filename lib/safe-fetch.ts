import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { request as httpRequest, type RequestOptions } from "node:http";
import { request as httpsRequest } from "node:https";

const MAX_REDIRECTS = 4;

// Hard ceiling on how much of a response body we buffer. The target host is
// user-supplied, so a malicious endpoint could otherwise stream unbounded bytes
// into memory (DoS). robots.txt and the other resources fetched through here are
// tiny; 2 MiB is generous headroom. Bodies past the cap abort the request.
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

/**
 * Raised when a request target is rejected by the SSRF guard. Callers can treat
 * the message as user-facing, it never contains resolved addresses.
 */
export class SsrfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SsrfError";
  }
}

// IPv4 ranges that must never be reachable from a user-supplied URL: loopback,
// link-local (cloud metadata lives at 169.254.169.254), RFC1918 private space,
// CGNAT, benchmarking/documentation, multicast and reserved blocks.
const IPV4_BLOCKED_RANGES: Array<[string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
  ["255.255.255.255", 32]
];

function ipv4ToLong(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value >>> 0;
}

function isBlockedIpv4(ip: string): boolean {
  const value = ipv4ToLong(ip);
  if (value === null) return true;
  return IPV4_BLOCKED_RANGES.some(([base, bits]) => {
    const baseLong = ipv4ToLong(base)!;
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (value & mask) === (baseLong & mask);
  });
}

function isBlockedIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase().split("%")[0];
  const mapped = normalized.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mapped) return isBlockedIpv4(mapped[1]);
  if (normalized === "::1" || normalized === "::") return true; // loopback / unspecified
  if (/^fe[89ab]/.test(normalized)) return true; // fe80::/10 link-local
  if (/^f[cd]/.test(normalized)) return true; // fc00::/7 unique-local
  if (normalized.startsWith("ff")) return true; // ff00::/8 multicast
  return false;
}

export function isBlockedAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return isBlockedIpv4(address);
  if (version === 6) return isBlockedIpv6(address);
  return true;
}

/**
 * Resolve a target URL and return a single validated address to connect to.
 * Throws {@link SsrfError} for non-http(s) schemes, missing hosts, or any
 * hostname that resolves (wholly or partly) to a private/reserved address.
 */
async function resolveAllowedTarget(url: URL): Promise<string> {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SsrfError("Only http and https URLs can be checked.");
  }

  const hostname = url.hostname.replace(/^\[/, "").replace(/\]$/, "");
  if (!hostname) throw new SsrfError("The URL is missing a host.");

  if (isIP(hostname)) {
    if (isBlockedAddress(hostname)) {
      throw new SsrfError("Target address is private or reserved.");
    }
    return hostname;
  }

  let resolved;
  try {
    resolved = await lookup(hostname, { all: true });
  } catch {
    throw new SsrfError("Target host could not be resolved.");
  }
  if (resolved.length === 0) throw new SsrfError("Target host could not be resolved.");
  for (const { address } of resolved) {
    if (isBlockedAddress(address)) {
      throw new SsrfError("Target resolves to a private or reserved address.");
    }
  }
  return resolved[0].address;
}

/** Network primitive used by {@link safeFetch}. Injectable for testing. */
export type Transport = (url: URL, pinnedIp: string, init: RequestInit) => Promise<Response>;

function toHeaderRecord(headers: HeadersInit | undefined): Record<string, string> {
  const record: Record<string, string> = {};
  if (headers) new Headers(headers).forEach((value, key) => (record[key] = value));
  return record;
}

function toAbortError(signal: AbortSignal): Error {
  const reason = signal.reason;
  if (reason instanceof Error) return reason;
  return new DOMException(typeof reason === "string" ? reason : "The request was aborted.", "AbortError");
}

/**
 * Default transport: issues the request with node's http(s) client and pins the
 * socket to {@link pinnedIp} via a custom `lookup`. This closes the DNS
 * rebinding window — the address is validated *and* connected to, so a
 * second DNS answer cannot swap in an internal host between check and connect.
 * The Host header and TLS SNI keep the original hostname so certificates still
 * validate.
 */
function nodePinnedTransport(url: URL, pinnedIp: string, init: RequestInit): Promise<Response> {
  return new Promise<Response>((resolve, reject) => {
    const isHttps = url.protocol === "https:";
    const requestImpl = isHttps ? httpsRequest : httpRequest;
    const family = isIP(pinnedIp) || 4;

    const pinnedLookup = ((hostname: string, options: { all?: boolean }, callback: (...args: unknown[]) => void) => {
      if (options && options.all) callback(null, [{ address: pinnedIp, family }]);
      else callback(null, pinnedIp, family);
    }) as unknown as RequestOptions["lookup"];

    const req = requestImpl(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port ? Number(url.port) : isHttps ? 443 : 80,
        path: `${url.pathname}${url.search}`,
        method: init.method ?? "GET",
        headers: toHeaderRecord(init.headers),
        servername: isHttps ? url.hostname : undefined,
        lookup: pinnedLookup
      },
      (res) => {
        const chunks: Buffer[] = [];
        let received = 0;
        res.on("data", (chunk: Buffer) => {
          received += chunk.length;
          if (received > MAX_RESPONSE_BYTES) {
            req.destroy(new SsrfError("Target response exceeded the size limit."));
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => {
          const status = res.statusCode ?? 502;
          const headers = new Headers();
          for (const [key, value] of Object.entries(res.headers)) {
            if (Array.isArray(value)) for (const item of value) headers.append(key, item);
            else if (typeof value === "string") headers.set(key, value);
          }
          const nullBody = status === 204 || status === 205 || status === 304;
          resolve(new Response(nullBody ? null : Buffer.concat(chunks), { status, headers }));
        });
        res.on("error", reject);
      }
    );

    const signal = init.signal ?? undefined;
    if (signal) {
      if (signal.aborted) req.destroy(toAbortError(signal));
      else signal.addEventListener("abort", () => req.destroy(toAbortError(signal)), { once: true });
    }

    req.on("error", reject);
    req.end();
  });
}

/**
 * fetch()-style helper that blocks SSRF. The scheme is restricted to http(s),
 * the host is DNS-resolved and validated against private/reserved ranges, the
 * connection is pinned to the validated address (anti DNS-rebinding), and
 * redirects are followed manually so every hop is re-validated.
 */
export async function safeFetch(
  input: string,
  init: RequestInit = {},
  transport: Transport = nodePinnedTransport
): Promise<Response> {
  let current = new URL(input);
  for (let redirects = 0; ; redirects += 1) {
    const pinnedIp = await resolveAllowedTarget(current);
    const response = await transport(current, pinnedIp, init);

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) return response;
      if (redirects >= MAX_REDIRECTS) {
        throw new SsrfError("Too many redirects while checking the target.");
      }
      current = new URL(location, current);
      continue;
    }

    return response;
  }
}
