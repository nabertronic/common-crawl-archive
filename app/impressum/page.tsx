import { redirect } from "next/navigation";

// Legacy German path kept as a redirect so old links still reach /imprint.
export default function LegacyImprintRedirectPage() {
  redirect("/imprint");
}
