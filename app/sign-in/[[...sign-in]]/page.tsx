import { SignInForm } from "@/components/sign-in-form";

export const metadata = {
  title: "Sign in · Crawlback",
  robots: {
    index: false,
    follow: false
  }
};

/** The only public application page. Clerk Restricted Mode hides sign-up. */
export default function SignInPage() {
  return <SignInForm />;
}
