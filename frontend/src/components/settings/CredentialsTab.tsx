import { Controller } from "react-hook-form";
import { Loader2 } from "lucide-react";
import { COMMON_LANGS } from "@/lib/subtitle-langs";
import { Card, CardContent } from "@/components/ui/card";
import { credentialsSchema, seedCredentials } from "@/lib/schemas/settings";
import { SaveButton } from "./SaveButton";
import { useSettingsForm } from "./useSettingsForm";

export function CredentialsTab() {
  const { form, isLoading, save } = useSettingsForm(credentialsSchema, seedCredentials, (v) => ({
    tmdb_api_key: v.tmdbKey,
    subtitle_languages: v.subtitleLangs.join(","),
    subtitle_sync_engine: v.subtitleSyncEngine,
    subtitle_auto_sync: v.subtitleAutoSync,
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
                className="w-full max-w-sm rounded-md border border-input bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6 space-y-4">
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">
                  Default subtitle languages
                </p>
                <Controller
                  control={form.control}
                  name="subtitleLangs"
                  render={({ field, fieldState }) => {
                    const toggle = (code: string) => {
                      const has = field.value.includes(code);
                      if (has && field.value.length === 1) return;
                      field.onChange(
                        has ? field.value.filter((c) => c !== code) : [...field.value, code],
                      );
                    };
                    return (
                      <>
                        <div className="flex flex-wrap gap-1.5">
                          {COMMON_LANGS.map(({ code, label }) => {
                            const active = field.value?.includes(code);
                            return (
                              <button
                                key={code}
                                type="button"
                                onClick={() => toggle(code)}
                                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors border ${
                                  active
                                    ? "bg-primary/15 border-primary/40 text-primary"
                                    : "bg-transparent border-border text-muted-foreground hover:border-border/80 hover:text-foreground"
                                }`}
                              >
                                {label}
                              </button>
                            );
                          })}
                        </div>
                        {fieldState.error && (
                          <p className="text-xs text-destructive">{fieldState.error.message}</p>
                        )}
                      </>
                    );
                  }}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6 space-y-4">
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">Subtitle sync engine</p>
                <p className="text-xs text-muted-foreground/70">
                  Re-times subtitles against the video's audio (offset/framerate drift). Works
                  regardless of subtitle language. alass also handles inserted/removed sections
                  (e.g. ad breaks); ffsubsync doesn't.
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {(
                    [
                      { code: "alass", label: "alass" },
                      { code: "ffsubsync", label: "ffsubsync" },
                    ] as const
                  ).map(({ code, label }) => {
                    const active = form.watch("subtitleSyncEngine") === code;
                    return (
                      <button
                        key={code}
                        type="button"
                        onClick={() =>
                          form.setValue("subtitleSyncEngine", code, { shouldDirty: true })
                        }
                        className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors border ${
                          active
                            ? "bg-primary/15 border-primary/40 text-primary"
                            : "bg-transparent border-border text-muted-foreground hover:border-border/80 hover:text-foreground"
                        }`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <label className="flex items-start gap-3 cursor-pointer select-none group">
                <input
                  type="checkbox"
                  {...form.register("subtitleAutoSync")}
                  className="accent-primary h-4 w-4 mt-0.5"
                />
                <div>
                  <p className="text-sm text-foreground group-hover:text-foreground/90 transition-colors">
                    Auto-sync downloaded subtitles
                  </p>
                  <p className="text-xs text-muted-foreground/70">
                    Runs automatically after a subtitle finishes downloading (bulk or single
                    search). Whisper-generated subtitles are already audio-aligned and are
                    unaffected — sync them manually if needed.
                  </p>
                </div>
              </label>
            </CardContent>
          </Card>

          <SaveButton {...save} />
        </>
      )}
    </div>
  );
}
