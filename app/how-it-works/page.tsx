import { permanentRedirect } from "next/navigation";

// The guide now lives on the landing page; keep the old URL redirecting there.
export default function HowItWorksRedirectPage() {
  permanentRedirect("/#how-it-works");
}
