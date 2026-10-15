import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { HtmlPrivacyWarningDialog } from "@/components/html-privacy-warning-dialog";

describe("HtmlPrivacyWarningDialog", () => {
  const callbacks = { onCancel: vi.fn(), onContinue: vi.fn() };

  it("warns that raw downloads can run scripts and request remote assets", () => {
    render(<HtmlPrivacyWarningDialog open actionLabel="Download HTML" {...callbacks} />);

    expect(screen.getByRole("alertdialog")).toHaveTextContent(
      "its scripts may run and remote assets may be requested"
    );
    expect(screen.getByRole("alertdialog")).not.toHaveTextContent("carries a content policy");
  });

  it("explains the policy on protected downloads and retains the copied HTML warning", () => {
    const { rerender } = render(
      <HtmlPrivacyWarningDialog open actionLabel="Download HTML" protectedDownload {...callbacks} />
    );
    expect(screen.getByRole("alertdialog")).toHaveTextContent(
      "The downloaded file carries a content policy that blocks scripts and remote requests"
    );
    expect(screen.getByRole("alertdialog")).toHaveTextContent("Copied HTML has no such policy.");

    rerender(<HtmlPrivacyWarningDialog open actionLabel="Copy HTML" {...callbacks} />);
    expect(screen.getByRole("alertdialog")).toHaveTextContent(
      "its scripts may run and remote assets may be requested"
    );
    expect(screen.getByRole("alertdialog")).not.toHaveTextContent("carries a content policy");
  });
});
