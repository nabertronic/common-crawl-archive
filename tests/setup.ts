import { vi } from "vitest";

// Client components in the focused UI tests are rendered without the app's
// root layout. Provide the one Clerk client action used by the shared menu.
vi.mock("@clerk/nextjs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@clerk/nextjs")>();
  return {
    ...actual,
    useClerk: () => ({ signOut: vi.fn() }),
    useReverification: <T extends (...args: never[]) => unknown>(callback: T) => callback,
    useUser: () => ({
      isLoaded: true,
      isSignedIn: true,
      user: {
        firstName: "Test",
        lastName: "User",
        primaryEmailAddress: { emailAddress: "tester@example.com" },
        emailAddresses: [],
        createEmailAddress: vi.fn(),
        delete: vi.fn(),
        reload: vi.fn(),
        update: vi.fn(),
        updatePassword: vi.fn()
      }
    })
  };
});

// Route tests exercise the app's own authorization calls without requiring a
// real Clerk instance. Clerk itself validates the session in production.
const clerk = vi.hoisted(() => {
  const state = { isAuthenticated: true };
  const signedIn = {
    isAuthenticated: true,
    userId: "user_test"
  };
  const signedOut = {
    isAuthenticated: false,
    userId: null,
    redirectToSignIn: ({ returnBackUrl }: { returnBackUrl?: string }) =>
      Response.redirect(new URL("/sign-in", returnBackUrl ?? "https://app.test/").toString())
  };
  const auth = Object.assign(vi.fn(async () => (state.isAuthenticated ? signedIn : signedOut)), {
    protect: vi.fn(async () => (state.isAuthenticated ? signedIn : signedOut))
  });
  return { auth, state };
});

export const clerkTestState = clerk.state;

vi.mock("@clerk/nextjs/server", () => ({
  auth: clerk.auth,
  clerkMiddleware: (handler: (auth: typeof clerk.auth, request: unknown, event: unknown) => unknown) =>
    async (request: unknown, event: unknown) => handler(clerk.auth, request, event)
}));
