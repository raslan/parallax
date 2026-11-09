import { useId, useState } from "react";
import { useForm } from "react-hook-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { ParallaxLogo } from "@/components/ParallaxLogo";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authApi, type AuthStatus } from "@/lib/api/auth";
import { errorDetail, httpStatus } from "@/lib/api/client";
import { qk } from "@/lib/api/queryKeys";
import { loginSchema, setupSchema, PASSWORD_MAX, PASSWORD_MIN } from "@/lib/schemas/auth";
import { zodResolver } from "@/lib/zodResolver";
import { AuthBackdrop } from "./AuthBackdrop";

type Mode = "login" | "setup";

interface FormValues {
  username: string;
  password: string;
  confirm: string;
}

const COPY = {
  login: {
    title: "Sign in to Parallax",
    lead: "Your libraries are private to this server.",
    submit: "Sign in",
    busy: "Signing in",
  },
  setup: {
    title: "Create your account",
    lead: "This is the only account on this server. Whoever opens this page first creates it.",
    submit: "Create account",
    busy: "Creating account",
  },
} as const;

function Field({
  id,
  label,
  error,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error && (
        <p id={`${id}-error`} className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

/** One page for both modes: same card, same height, so nothing jumps between them. */
export function AuthPage({ mode }: { mode: Mode }) {
  const qc = useQueryClient();
  const uid = useId();
  const [showPassword, setShowPassword] = useState(false);
  const copy = COPY[mode];

  const form = useForm<FormValues>({
    resolver: zodResolver(mode === "setup" ? setupSchema : loginSchema) as never,
    defaultValues: { username: "", password: "", confirm: "" },
  });
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = form;

  const signIn = useMutation({
    mutationFn: (v: FormValues) =>
      (mode === "setup" ? authApi.setup : authApi.login)({
        username: v.username.trim(),
        password: v.password,
      }),
    // The form shows the message itself, so the global error toast would say it twice.
    meta: { skipErrorToast: true },
    onSuccess: (status: AuthStatus) => {
      // Drop whatever an earlier session (or a 401) left in the cache, then let the gate in.
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== qk.auth()[0] });
      qc.setQueryData(qk.auth(), status);
    },
    onError: (e) => {
      // Someone else created the account first: re-read the status so this page becomes the
      // sign-in page instead of staying on a setup form that can no longer work.
      if (httpStatus(e) === 409) void qc.invalidateQueries({ queryKey: qk.auth() });
    },
  });

  const pending = signIn.isPending;
  const serverError = signIn.error
    ? errorDetail(signIn.error, "Could not reach the server. Try again.")
    : null;

  const ids = {
    username: `${uid}-username`,
    password: `${uid}-password`,
    confirm: `${uid}-confirm`,
  };
  const passwordType = showPassword ? "text" : "password";

  return (
    <main className="relative flex min-h-dvh items-center justify-center bg-background px-4 py-10">
      <AuthBackdrop />
      <Card className="relative z-10 w-full max-w-sm bg-card/95 shadow-xl backdrop-blur-sm">
        <CardHeader className="space-y-3 pb-4">
          <ParallaxLogo className="h-9 w-9" />
          <div className="space-y-1.5">
            <CardTitle className="text-xl font-semibold tracking-tight">{copy.title}</CardTitle>
            <p className="min-h-[2.5rem] text-sm text-muted-foreground">{copy.lead}</p>
          </div>
        </CardHeader>
        <CardContent>
          <form
            noValidate
            onSubmit={handleSubmit((v) => signIn.mutate(v))}
            className="space-y-4"
            aria-label={copy.title}
          >
            <Field id={ids.username} label="Username" error={errors.username?.message}>
              <Input
                id={ids.username}
                autoComplete="username"
                autoFocus
                autoCapitalize="none"
                spellCheck={false}
                aria-invalid={!!errors.username}
                aria-describedby={errors.username ? `${ids.username}-error` : undefined}
                {...register("username")}
              />
            </Field>

            <Field id={ids.password} label="Password" error={errors.password?.message}>
              <div className="relative">
                <Input
                  id={ids.password}
                  type={passwordType}
                  autoComplete={mode === "setup" ? "new-password" : "current-password"}
                  className="pr-10"
                  aria-invalid={!!errors.password}
                  aria-describedby={
                    errors.password
                      ? `${ids.password}-error`
                      : mode === "setup"
                        ? `${ids.password}-hint`
                        : undefined
                  }
                  {...register("password")}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((s) => !s)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  aria-pressed={showPassword}
                  className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-md text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {mode === "setup" && !errors.password && (
                <p id={`${ids.password}-hint`} className="text-xs text-muted-foreground">
                  {PASSWORD_MIN} to {PASSWORD_MAX} characters. A few plain words work well.
                </p>
              )}
            </Field>

            {/* Same height in both modes: setup's confirm field, or login's reset hint. */}
            <div className="min-h-[4.25rem]">
              {mode === "setup" ? (
                <Field id={ids.confirm} label="Confirm password" error={errors.confirm?.message}>
                  <Input
                    id={ids.confirm}
                    type={passwordType}
                    autoComplete="new-password"
                    aria-invalid={!!errors.confirm}
                    aria-describedby={errors.confirm ? `${ids.confirm}-error` : undefined}
                    {...register("confirm")}
                  />
                </Field>
              ) : (
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Forgot your password? On the server, run{" "}
                  <code className="rounded bg-muted px-1 py-0.5 font-mono text-2xs">
                    docker exec -it parallax python -m app.reset_password
                  </code>
                </p>
              )}
            </div>

            <div className="min-h-5" aria-live="polite">
              {serverError && (
                <p role="alert" className="text-sm text-destructive">
                  {serverError}
                </p>
              )}
            </div>

            <Button type="submit" className="w-full" disabled={pending}>
              {pending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {copy.busy}
                </>
              ) : (
                copy.submit
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
