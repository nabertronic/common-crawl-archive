import { beforeEach, describe, expect, it, vi } from "vitest";

const permanentRedirect = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ permanentRedirect }));

import HowItWorksRedirectPage from "@/app/how-it-works/page";

describe("/how-it-works redirect", () => {
  beforeEach(() => permanentRedirect.mockClear());

  it("permanently redirects to the landing page section", () => {
    HowItWorksRedirectPage();
    expect(permanentRedirect).toHaveBeenCalledWith("/#how-it-works");
  });
});
