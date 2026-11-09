import { useId } from "react";
import { useForm } from "react-hook-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuthStatus } from "@/hooks/useAuthStatus";
import { useSignOut } from "@/hooks/useSignOut";
import { authApi, type AccountUpdate } from "@/lib/api/auth";
import { errorDetail } from "@/lib/api/client";
import { qk } from "@/lib/api/queryKeys";
import { accountSchema, type AccountForm } from "@/lib/schemas/auth";
import { zodResolver } from "@/lib/zodResolver";

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

/** Settings → General → Account. Hidden when the server runs with authentication off. */
export function AccountCard() {
  const qc = useQueryClient();
  const uid = useId();
  const { data } = useAuthStatus();
  const signOutEverywhere = useSignOut(true);

  const form = useForm<AccountForm>({
    resolver: zodResolver(accountSchema),
    defaultValues: { currentPassword: "", newUsername: "", newPassword: "", confirm: "" },
  });
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = form;

  const save = useMutation({
    mutationFn: (v: AccountForm) => {
      const body: AccountUpdate = { current_password: v.currentPassword };
      if (v.newUsername) body.new_username = v.newUsername;
      if (v.newPassword) body.new_password = v.newPassword;
      return authApi.updateAccount(body);
    },
    // Shown under the form (e.g. "Current password is incorrect"), so no second toast.
    meta: { skipErrorToast: true },
    onSuccess: (status, v) => {
      qc.setQueryData(qk.auth(), status);
      reset();
      toast.success(
        v.newPassword ? "Account updated. Other browsers were signed out." : "Account updated",
      );
    },
  });

  if (!data?.enabled || !data.authenticated) return null;

  const ids = {
    current: `${uid}-current`,
    username: `${uid}-username`,
    password: `${uid}-password`,
    confirm: `${uid}-confirm`,
  };

  return (
    <Card className="max-w-xl">
      <CardContent className="space-y-5 pt-6">
        <div>
          <p className="text-sm font-medium">Account</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Signed in as <span className="font-medium text-foreground">{data.username}</span>.
            Change your username, your password, or both. Changing the password signs every other
            browser out.
          </p>
        </div>

        <form
          noValidate
          onSubmit={handleSubmit((v) => save.mutate(v))}
          className="max-w-sm space-y-4"
          aria-label="Change account details"
        >
          {/* Lets a password manager tie the new password to this account. */}
          <input
            type="text"
            name="username"
            value={data.username ?? ""}
            autoComplete="username"
            readOnly
            hidden
          />
          <Field id={ids.username} label="New username" error={errors.newUsername?.message}>
            <Input
              id={ids.username}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              placeholder={data.username ?? ""}
              aria-invalid={!!errors.newUsername}
              aria-describedby={errors.newUsername ? `${ids.username}-error` : undefined}
              {...register("newUsername")}
            />
          </Field>
          <Field id={ids.password} label="New password" error={errors.newPassword?.message}>
            <Input
              id={ids.password}
              type="password"
              autoComplete="new-password"
              aria-invalid={!!errors.newPassword}
              aria-describedby={errors.newPassword ? `${ids.password}-error` : undefined}
              {...register("newPassword")}
            />
          </Field>
          <Field id={ids.confirm} label="Confirm new password" error={errors.confirm?.message}>
            <Input
              id={ids.confirm}
              type="password"
              autoComplete="new-password"
              aria-invalid={!!errors.confirm}
              aria-describedby={errors.confirm ? `${ids.confirm}-error` : undefined}
              {...register("confirm")}
            />
          </Field>
          <Field id={ids.current} label="Current password" error={errors.currentPassword?.message}>
            <Input
              id={ids.current}
              type="password"
              autoComplete="current-password"
              aria-invalid={!!errors.currentPassword}
              aria-describedby={errors.currentPassword ? `${ids.current}-error` : undefined}
              {...register("currentPassword")}
            />
          </Field>

          <div className="min-h-5" aria-live="polite">
            {save.error && (
              <p role="alert" className="text-sm text-destructive">
                {errorDetail(save.error, "Could not save. Try again.")}
              </p>
            )}
          </div>

          <Button type="submit" disabled={save.isPending}>
            {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save changes
          </Button>
        </form>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
          <p className="max-w-md text-xs text-muted-foreground">
            Signs out every browser that is signed in to this server, including this one.
          </p>
          <Button
            variant="outline"
            size="sm"
            disabled={signOutEverywhere.isPending}
            onClick={() => signOutEverywhere.mutate()}
          >
            Sign out everywhere
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
