import { Controller } from "react-hook-form";
import { Loader2 } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { qk, speechModelsApi, subtitlePacksApi } from "@/lib/api";
import { COMMON_LANGS } from "@/lib/subtitle-langs";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { seedSubtitles, subtitlesSchema } from "@/lib/schemas/settings";
import { SaveButton } from "./SaveButton";
import { useSettingsForm } from "./useSettingsForm";
import { LanguagePackCard } from "./LanguagePackCard";

const CHIP = "px-2.5 py-1 rounded-md text-xs font-medium transition-colors border";
const CHIP_ON = "bg-primary/15 border-primary/40 text-primary";
const CHIP_OFF =
  "bg-transparent border-border text-muted-foreground hover:border-border/80 hover:text-foreground";

export function SubtitlesTab() {
  const { form, isLoading, save } = useSettingsForm(subtitlesSchema, seedSubtitles, (v) => ({
    subtitle_languages: v.subtitleLangs.join(","),
    subtitle_sync_engine: v.subtitleSyncEngine,
    subtitle_auto_sync: v.subtitleAutoSync,
    subtitle_translate_drop_hi: v.translateDropHi,
  }));

  const qc = useQueryClient();
  const { data: packs = [], isLoading: packsLoading } = useQuery({
    queryKey: qk.subtitlePacks(),
    queryFn: () => subtitlePacksApi.list(),
  });
  const reloadPacks = () => qc.invalidateQueries({ queryKey: qk.subtitlePacks() });
  const { data: speech = [], isLoading: speechLoading } = useQuery({
    queryKey: qk.speechModels(),
    queryFn: () => speechModelsApi.list(),
  });
  const reloadSpeech = () => qc.invalidateQueries({ queryKey: qk.speechModels() });

  return (
    <div className="space-y-6">
      {isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading…
        </div>
      ) : (
        <>
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
                          {COMMON_LANGS.map(({ code, label }) => (
                            <button
                              key={code}
                              type="button"
                              onClick={() => toggle(code)}
                              className={`${CHIP} ${field.value?.includes(code) ? CHIP_ON : CHIP_OFF}`}
                            >
                              {label}
                            </button>
                          ))}
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
                  {(["alass", "ffsubsync"] as const).map((code) => (
                    <button
                      key={code}
                      type="button"
                      onClick={() =>
                        form.setValue("subtitleSyncEngine", code, { shouldDirty: true })
                      }
                      className={`${CHIP} ${form.watch("subtitleSyncEngine") === code ? CHIP_ON : CHIP_OFF}`}
                    >
                      {code}
                    </button>
                  ))}
                </div>
              </div>
              <label className="flex items-start gap-3 cursor-pointer select-none group">
                <Checkbox
                  checked={form.watch("subtitleAutoSync")}
                  onCheckedChange={(c) =>
                    form.setValue("subtitleAutoSync", c === true, { shouldDirty: true })
                  }
                  className="mt-0.5"
                />
                <div>
                  <p className="text-sm text-foreground group-hover:text-foreground/90 transition-colors">
                    Auto-sync downloaded subtitles
                  </p>
                  <p className="text-xs text-muted-foreground/70">
                    Runs automatically after a subtitle finishes downloading (bulk or single
                    search).
                  </p>
                </div>
              </label>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <label className="flex items-start gap-3 cursor-pointer select-none group">
                <Checkbox
                  checked={form.watch("translateDropHi")}
                  onCheckedChange={(c) =>
                    form.setValue("translateDropHi", c === true, { shouldDirty: true })
                  }
                  className="mt-0.5"
                />
                <div>
                  <p className="text-sm text-foreground">
                    Leave out sound notes and speaker names when translating
                  </p>
                  <p className="text-xs text-muted-foreground/70">
                    Subtitles for the hard of hearing include lines like [DISTANT EXPLOSION] and
                    names like FURY:. They are translated and kept unless you tick this.
                  </p>
                </div>
              </label>
            </CardContent>
          </Card>

          <SaveButton {...save} />
        </>
      )}

      <Card>
        <CardContent className="pt-6 space-y-3">
          <div>
            <p className="text-sm font-medium">Language packs</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Translate an English subtitle into another language without leaving your computer.
              Install a pack once, then use Translate on the Subtitles page. Nothing is sent
              anywhere. The result is saved as a machine-made subtitle next to the video.
            </p>
          </div>
          {packsLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading…
            </div>
          ) : (
            <div className="space-y-2">
              {packs.map((p) => (
                <LanguagePackCard
                  key={p.lang}
                  pack={p}
                  onChange={reloadPacks}
                  actions={subtitlePacksApi}
                  blurb={`Translates English subtitles into ${p.name}, on this computer.`}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6 space-y-3">
          <div>
            <p className="text-sm font-medium">Speech-to-text models</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              For a video that has no subtitle yet: Parallax listens to the English speech and
              writes a rough subtitle, on this computer, as a stopgap until a real one appears.
              Small is the one to start with; medium is slower and gets names right more often.
              Install the ones you want, then click <strong>Use</strong> on the one to generate
              with. It applies everywhere.
            </p>
          </div>
          {speechLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading…
            </div>
          ) : (
            <div className="space-y-2">
              {speech.map((m) => (
                <LanguagePackCard
                  key={m.lang}
                  pack={m}
                  onChange={reloadSpeech}
                  actions={speechModelsApi}
                  noun="speech model"
                  blurb="Turns English speech into a subtitle."
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
