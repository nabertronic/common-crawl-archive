import "@testing-library/jest-dom/vitest";
import { act, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const workerMocks = vi.hoisted(() => ({ register: vi.fn() }));
vi.mock("@/lib/background-scan", () => ({ registerScanServiceWorker: workerMocks.register }));

import { ServiceWorkerRegistrar } from "@/components/service-worker-registrar";
import { grantStorageConsent, resetStorageConsentSession, revokeStorageConsent } from "@/lib/website-preferences";

describe("ServiceWorkerRegistrar consent race", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    const values = new Map<string, string>();
    Object.defineProperty(window, "localStorage", { configurable: true, value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key), clear: () => values.clear()
    } });
    resetStorageConsentSession();
    grantStorageConsent();
  });

  it("does not grant a late registration after consent is revoked", async () => {
    vi.stubEnv("NODE_ENV", "production");
    let resolveRegistration!: (value: any) => void;
    workerMocks.register.mockReturnValue(new Promise((resolve) => { resolveRegistration = resolve; }));
    const postMessage = vi.fn();
    const registration = { active: { postMessage, scriptURL: `${location.origin}/sw.js` }, unregister: vi.fn() };
    vi.stubGlobal("navigator", { serviceWorker: { controller: { postMessage }, getRegistrations: async () => [registration] } });
    render(<ServiceWorkerRegistrar />);
    await waitFor(() => expect(workerMocks.register).toHaveBeenCalled());
    revokeStorageConsent();
    await act(async () => resolveRegistration(registration));
    await waitFor(() => expect(registration.unregister).toHaveBeenCalled());
    expect(postMessage).not.toHaveBeenCalledWith({ type: "consent:grant" });
  });
});
