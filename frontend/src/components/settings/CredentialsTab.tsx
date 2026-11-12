import { Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { credentialsSchema, seedCredentials } from "@/lib/schemas/settings";
import { SaveButton } from "./SaveButton";
import { useSettingsForm } from "./useSettingsForm";

export function CredentialsTab() {
  const { form, isLoading, save } = useSettingsForm(credentialsSchema, seedCredentials, (v) => ({
    tmdb_api_key: v.tmdbKey,
  }));

  return (
    <div className="space-y-4">
      {isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading…
        </div>
      ) : (
        <>
          <Card>
            <CardContent className="pt-6 space-y-3">
              <div>
                <p className="text-sm font-medium">TMDB API key</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Required for Identify & Rename. Free key at{" "}
                  <a
                    href="https://www.themoviedb.org/settings/api"
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary underline"
                  >
                    themoviedb.org
                  </a>
                  .
                </p>
              </div>
              <input
                type="password"
                {...form.register("tmdbKey")}
                placeholder="Paste your TMDB API key…"
                className="w-full max-w-sm rounded-md border border-input bg-background px-3 py-2 text-sm font-mono focus:outline-hidden focus:ring-1 focus:ring-primary"
              />
            </CardContent>
          </Card>

          <SaveButton {...save} />
        </>
      )}
    </div>
  );
}
