import { ParallaxLogo } from "@/components/ParallaxLogo";
import { QueryError } from "@/components/QueryError";
import { useAuthStatus } from "@/hooks/useAuthStatus";
import { AuthPage } from "./AuthPage";

/**
 * Wraps the whole app. Shows the app when authentication is off or the visitor is signed in,
 * the setup page when no account exists yet, and the login page otherwise. The page behind
 * the gate is never rendered (so none of its requests, streams or players start) until the
 * visitor is in, and it unmounts the moment a 401 flips the status.
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const status = useAuthStatus();

  if (status.isPending) {
    return (
      <div
        className="flex min-h-dvh items-center justify-center bg-background"
        role="status"
        aria-label="Loading"
      >
        <ParallaxLogo className="h-9 w-9 animate-pulse" />
      </div>
    );
  }

  if (!status.data) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background p-6">
        <div className="w-full max-w-sm">
          <QueryError
            error={status.error}
            title="Can't reach Parallax"
            onRetry={() => void status.refetch()}
          />
        </div>
      </div>
    );
  }

  const { enabled, authenticated, configured } = status.data;
  if (!enabled || authenticated) return <>{children}</>;
  return <AuthPage mode={configured ? "login" : "setup"} />;
}
