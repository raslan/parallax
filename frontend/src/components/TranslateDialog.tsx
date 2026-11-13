import { useState } from "react";
import { Loader2 } from "lucide-react";
import type { TranslateSource } from "@/types/subtitle";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { RadioToggle } from "@/components/RadioToggle";
import { cn } from "@/lib/utils";

/**
 * Translate one video's subtitle. The user picks which English file to translate and which
 * language to translate it into; nothing is chosen for them (the first file and language are only
 * where the selection starts). `sources` is undefined while it loads.
 */
export function TranslateDialog({
  videoName,
  sources,
  languages,
  error,
  busy,
  onTranslate,
  onClose,
}: {
  videoName: string;
  sources: TranslateSource[] | undefined;
  languages: { code: string; name: string }[];
  error?: string;
  busy: boolean;
  onTranslate: (source: string, language: string) => void;
  onClose: () => void;
}) {
  const [pickedSource, setPickedSource] = useState<string | null>(null);
  const [pickedLang, setPickedLang] = useState<string | null>(null);
  const source = pickedSource ?? sources?.[0]?.path ?? null;
  const language = pickedLang ?? languages[0]?.code ?? null;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent onClose={onClose} aria-label="Translate a subtitle">
        <DialogHeader>
          <DialogTitle>Translate a subtitle</DialogTitle>
          <p className="text-sm text-muted-foreground truncate" title={videoName}>
            {videoName}
          </p>
        </DialogHeader>

        <div className="space-y-5">
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
              Translate this file
            </p>
            {sources === undefined && !error && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Looking for subtitle files…
              </p>
            )}
            {sources?.length === 0 && (
              <p className="text-sm text-muted-foreground">
                This video has no English subtitle file. The translation models translate from
                English only.
              </p>
            )}
            <div className="space-y-1.5" role="group" aria-label="Subtitle file to translate">
              {(sources ?? []).map((s) => {
                const active = s.path === source;
                return (
                  <button
                    key={s.path}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setPickedSource(s.path)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors",
                      active
                        ? "border-primary bg-primary/10"
                        : "border-border hover:bg-muted/50 text-muted-foreground",
                    )}
                  >
                    <span className="flex-1 truncate font-mono" title={s.filename}>
                      {s.filename}
                    </span>
                    {s.machine_made && (
                      <span className="shrink-0 text-2xs uppercase tracking-wide text-amber-500">
                        machine-made
                      </span>
                    )}
                    {s.hearing_impaired && (
                      <span className="shrink-0 text-2xs uppercase tracking-wide text-muted-foreground">
                        hearing impaired
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
              Into
            </p>
            <RadioToggle
              value={language ?? ""}
              onChange={setPickedLang}
              options={languages.map((l) => ({ id: l.code, label: l.name }))}
            />
          </div>

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={busy || !source || !language}
            onClick={() => source && language && onTranslate(source, language)}
          >
            {busy && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
            Translate
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
