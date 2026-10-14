import { afterEach, describe, expect, it, vi } from "vitest";

const lookupMock = vi.fn();
vi.mock("node:dns/promises", () => {
  const lookup = (...args: unknown[]) => lookupMock(...args);
  return { lookup, default: { lookup } };
});

import { SsrfError, isBlockedAddress, safeFetch, type Transport } from "@/lib/safe-fetch";

afterEach(() => {
  vi.restoreAllMocks();
  lookupMock.mockReset();
});

describe("isBlockedAddress", () => {
  it("blocks loopback, link-local, private and reserved ranges", () => {
    for (const address of [
      "127.0.0.1",
      "169.254.169.254",
      "10.1.2.3",
      "172.16.5.4",
      "192.168.1.1",
      "100.64.0.1",
      "0.0.0.0",
      "::1",
      "fe80::1",
      "fc00::1",
      "fd12::1",
      "::ffff:127.0.0.1",
      "::ffff:a9fe:a9fe",
      "::ffff:7f00:1",
      "::7f00:1",
      "64:ff9b::a9fe:a9fe",
      "64:ff9b::8.8.8.8",
      "2002:a9fe:a9fe::1",
      "fec0::1",
      "100::1",
      "2001:db8::1",
      "2001::1",
      "fe80::1%eth0",
      "ff02::1",
      "::",
      "::192.0.2.1",
      "not:an:ip::address::"
    ]) {
      expect(isBlockedAddress(address), address).toBe(true);
    }
  });

  it("allows ordinary public addresses", () => {
    expect(isBlockedAddress("93.184.216.34")).toBe(false);
    expect(isBlockedAddress("8.8.8.8")).toBe(false);
    expect(isBlockedAddress("2606:2800:220:1:248:1893:25c8:1946")).toBe(false);
    expect(isBlockedAddress("2606:4700:4700::1111")).toBe(false);
    expect(isBlockedAddress("::ffff:8.8.8.8")).toBe(false);
    expect(isBlockedAddress("2002:5db8:d822::1")).toBe(false);
  });

  it("blocks unparseable input", () => {
    expect(isBlockedAddress("not-an-ip")).toBe(true);
  });
});

describe("safeFetch", () => {
  it("rejects IPv4-mapped IPv6 hex literals that point at metadata", async () => {
    const transport = vi.fn();
    await expect(safeFetch("http://[::ffff:169.254.169.254]/", {}, transport)).rejects.toBeInstanceOf(SsrfError);
    expect(transport).not.toHaveBeenCalled();
  });

  it("rejects non-standard ports on the initial URL and on redirect hops", async () => {
    lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    const transport = vi.fn();
    await expect(safeFetch("https://example.com:8443/robots.txt", {}, transport)).rejects.toThrow(
      "Only standard web ports can be checked."
    );
    expect(transport).not.toHaveBeenCalled();

    const redirecting: Transport = vi.fn(async () =>
      new Response(null, { status: 302, headers: { location: "https://example.com:8443/x" } })
    );
    await expect(safeFetch("https://example.com/robots.txt", {}, redirecting)).rejects.toBeInstanceOf(SsrfError);
    expect(redirecting).toHaveBeenCalledTimes(1);
  });

  it("accepts explicit default ports", async () => {
    lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    const transport: Transport = vi.fn(async () => new Response("ok", { status: 200 }));
    await safeFetch("https://example.com:443/robots.txt", {}, transport);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("rejects non-http(s) schemes before any request", async () => {
    const transport = vi.fn();
    await expect(safeFetch("ftp://example.com/robots.txt", {}, transport)).rejects.toBeInstanceOf(SsrfError);
    expect(transport).not.toHaveBeenCalled();
  });

  it("rejects literal private IP targets", async () => {
    const transport = vi.fn();
    await expect(safeFetch("http://169.254.169.254/latest/meta-data/", {}, transport)).rejects.toBeInstanceOf(SsrfError);
    expect(transport).not.toHaveBeenCalled();
  });

  it("rejects hostnames that resolve to private addresses", async () => {
    lookupMock.mockResolvedValue([{ address: "10.0.0.5", family: 4 }]);
    const transport = vi.fn();
    await expect(safeFetch("https://intranet.test/robots.txt", {}, transport)).rejects.toBeInstanceOf(SsrfError);
    expect(transport).not.toHaveBeenCalled();
  });

  it("pins the connection to the validated address", async () => {
    lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    const transport: Transport = vi.fn(async () => new Response("ok", { status: 200 }));

    await safeFetch("https://example.com/robots.txt", {}, transport);

    expect(transport).toHaveBeenCalledTimes(1);
    const [url, pinnedIp] = (transport as ReturnType<typeof vi.fn>).mock.calls[0];
    expect((url as URL).hostname).toBe("example.com");
    expect(pinnedIp).toBe("93.184.216.34");
  });

  it("re-validates redirect targets and blocks an internal hop", async () => {
    lookupMock.mockImplementation(async (hostname: string) =>
      hostname === "evil.test" ? [{ address: "93.184.216.34", family: 4 }] : [{ address: "169.254.169.254", family: 4 }]
    );
    const transport: Transport = vi.fn(async () =>
      new Response(null, { status: 302, headers: { location: "http://metadata.internal/" } })
    );

    await expect(safeFetch("https://evil.test/robots.txt", {}, transport)).rejects.toBeInstanceOf(SsrfError);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("returns the response for an allowed public host", async () => {
    lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    const transport: Transport = vi.fn(async () => new Response("ok", { status: 200 }));

    const response = await safeFetch("https://example.com/robots.txt", {}, transport);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ok");
  });
});
