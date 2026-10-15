import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({ pathname: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname }));

import { SiteFooter } from "@/components/site-footer";

describe("SiteFooter route scroll reset", () => {
  beforeEach(() => {
    nav.pathname = "/";
    window.history.replaceState(null, "", "/");
    window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  });

  it("scrolls to the top when the route changes", () => {
    const { rerender } = render(<SiteFooter />);
    expect(window.scrollTo).not.toHaveBeenCalled();
    nav.pathname = "/privacy";
    rerender(<SiteFooter />);
    expect(window.scrollTo).toHaveBeenCalledWith(0, 0);
  });

  it("leaves hash navigations to the browser so they keep smooth-scrolling", () => {
    const { rerender } = render(<SiteFooter />);
    window.history.replaceState(null, "", "/#faq");
    nav.pathname = "/";
    rerender(<SiteFooter />);
    expect(window.scrollTo).not.toHaveBeenCalled();
  });
});
