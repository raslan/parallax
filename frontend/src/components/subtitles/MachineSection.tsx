import { useState } from "react";
import { Link } from "react-router";
import { Languages, Loader2, Mic } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RadioToggle } from "@/components/RadioToggle";
import { SectionHeader } from "@/components/SectionHeader";
import { SETTINGS_LINK } from "@/lib/subtitleCoverage";
import type { ScanFile, TranslateSource } from "@/types/subtitle";
import type { SubtitlePack } from "@/types/subtitlePack";

const videos = (n: number) => `${n} ${n === 1 ? "video" : "videos"}`;

/** Whether a video has an English subtitle Translate can start from (any kind but a backup). */
const hasEnglish = (f: ScanFile) =>
  f.subtitles.some((s) => s.language.toLowerCase() === "en" && s.kind !== "original");

function Reason({ text }: { text: string }) {
  return (
    <Link
      to={SETTINGS_LINK}
      className="text-3xs text-muted-foreground underline hover:text-foreground"
    >
      {text}
    </Link>
  );
}

/**
 * The "Generated and translated" section: rough subtitles made on this computer, kept apart
 * from real downloads and only ever started by a click. Translate takes every installed
 * language pack as a target (also a language that already has a real subtitle) and the
 * video's main English file, or for one video a file the user picks; Generate uses the
 * speech model from Settings unless another installed one is picked. A control is greyed
 * only when it cannot work (no pack, no model, no English file to start from), with the
 * reason. Keep existing applies here too (off overwrites the earlier generated or
 * translated file of that language). Props-in/callbacks-out; the choices are view state.
 */
export function MachineSection({
  files,
  packs,
  models,
  blocked,
  keepExisting,
  onKeepExistingChange,
  sources,
  translating,
  generating,
  onTranslate,
  onGenerate,
}: {
  files: ScanFile[];
  /** Language packs, or null while they are not known. */
  packs: SubtitlePack[] | null;
  /** Speech models, or null while they are not known. */
  models: SubtitlePack[] | null;
  blocked: { translate: string | null; generate: string | null };
  keepExisting: boolean;
  /** Shows the section's own Keep existing tickbox (when no dock holds one). */
  onKeepExistingChange?: (v: boolean) => void;
  /** The English files of the one video in scope, for "Choose a file…" (null: not known). */
  sources: TranslateSource[] | null;
  translating: boolean;
  generating: boolean;
  onTranslate: (req: { language: string; files: string[]; source: string | undefined }) => void;
  onGenerate: (req: { files: string[]; model: string | undefined }) => void;
}) {
  const installed = (packs ?? []).filter((p) => p.installed);
  const speech = (models ?? []).filter((m) => m.installed);
  const activeModel = speech.find((m) => m.active)?.lang;
  const [target, setTarget] = useState<string | null>(null);
  const [mode, setMode] = useState<"main" | "choose">("main");
  const [source, setSource] = useState<string | null>(null);
  const [model, setModel] = useState<string | null>(null);

  const language = target ?? installed[0]?.lang ?? null;
  const single = files.length === 1;
  const choosing = mode === "choose" && single;
  const eligible = choosing ? files : files.filter(hasEnglish);
  const pickedModel = model ?? activeModel ?? null;
  // The videos that will actually be translated: with a chosen source file, only once one is
  // picked (it applies to a single video).
  const chosen = choosing ? (source === null ? [] : files) : eligible;
  const translateBlocked =
    blocked.translate ??
    (files.length === 0
      ? "Select a video"
      : eligible.length === 0
        ? "None of these videos has an English subtitle to translate from"
        : null);

  return (
    <section className="space-y-3 rounded-lg border border-border bg-card p-4">
      <div>
        <SectionHeader>Generated and translated subtitles</SectionHeader>
        <p className="mt-1 text-xs text-muted-foreground">
          Optional and rough: made on this computer, saved as .generated and .translated, and never
          counted as a real subtitle.
        </p>
      </div>

      {onKeepExistingChange ? (
        <label className="flex items-center gap-1.5 text-xs">
          <Checkbox
            checked={keepExisting}
            onCheckedChange={(v) => onKeepExistingChange(v === true)}
            aria-label="Keep existing subtitles"
          />
          Keep existing subtitles
          <span className="text-muted-foreground">
            · off replaces the earlier generated or translated file of that language
          </span>
        </label>
      ) : (
        <p className="text-3xs text-muted-foreground">
          Keep existing subtitles is {keepExisting ? "on" : "off"} (in the dock):{" "}
          {keepExisting
            ? "a new file is saved beside the earlier one."
            : "the earlier generated or translated file of that language is replaced."}
        </p>
      )}

      <div className="space-y-2 border-t border-border/60 pt-3">
        <p className="flex items-center gap-1.5 text-sm font-medium">
          <Languages className="h-4 w-4" />
          Translate from English
        </p>
        {packs === null ? (
          <p className="text-xs text-muted-foreground">Reading the language packs…</p>
        ) : installed.length > 0 ? (
          <div role="group" aria-label="Translate into" className="space-y-1">
            <p className="text-3xs text-muted-foreground">Into</p>
            <RadioToggle
              value={language ?? ""}
              onChange={setTarget}
              options={installed.map((p) => ({ id: p.lang, label: p.name }))}
            />
          </div>
        ) : null}
        <div className="space-y-1">
          <p className="text-3xs text-muted-foreground">From</p>
          <RadioToggle
            value={choosing ? "choose" : "main"}
            onChange={setMode}
            options={[
              { id: "main", label: "Main English file" },
              {
                id: "choose",
                label: "Choose a file…",
                disabled: !single,
                detail: single ? undefined : "A chosen source file applies to one video",
              },
            ]}
          />
          {choosing &&
            (sources === null ? (
              <p className="text-xs text-muted-foreground">Reading the English files…</p>
            ) : sources.length === 0 ? (
              <p className="text-xs text-muted-foreground">This video has no English subtitle.</p>
            ) : (
              <RadioToggle
                value={source ?? ""}
                onChange={setSource}
                options={sources.map((s) => ({
                  id: s.path,
                  label: s.filename,
                  detail: s.machine_made ? "generated" : s.hearing_impaired ? "HI" : undefined,
                }))}
              />
            ))}
        </div>
        {!choosing && eligible.length > 0 && eligible.length < files.length && (
          <p className="text-3xs text-muted-foreground">
            {eligible.length} of {videos(files.length)} have an English subtitle to start from.
          </p>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Button
            size="sm"
            variant="outline"
            disabled={
              !!translateBlocked || !language || translating || (choosing && source === null)
            }
            onClick={() =>
              language &&
              onTranslate({
                language,
                files: eligible.map((f) => f.path),
                source: choosing ? (source ?? undefined) : undefined,
              })
            }
          >
            {translating && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            Translate {videos(chosen.length)}
          </Button>
          {blocked.translate ? (
            <Reason text={blocked.translate} />
          ) : translateBlocked ? (
            <span className="text-3xs text-muted-foreground">{translateBlocked}</span>
          ) : (
            choosing &&
            source === null && (
              <span className="text-3xs text-muted-foreground">Choose a source file first</span>
            )
          )}
        </div>
      </div>

      <div className="space-y-2 border-t border-border/60 pt-3">
        <p className="flex items-center gap-1.5 text-sm font-medium">
          <Mic className="h-4 w-4" />
          Generate English from the audio
        </p>
        {speech.length > 1 && (
          <Select value={pickedModel ?? ""} onValueChange={setModel}>
            <SelectTrigger aria-label="Speech model" className="h-8 w-56 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {speech.map((m) => (
                <SelectItem key={m.lang} value={m.lang}>
                  {m.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {speech.length === 1 && (
          <p className="text-xs text-muted-foreground">Model: {speech[0]?.name}</p>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Button
            size="sm"
            variant="outline"
            disabled={!!blocked.generate || generating || files.length === 0}
            onClick={() =>
              onGenerate({
                files: files.map((f) => f.path),
                model:
                  pickedModel && pickedModel !== activeModel
                    ? pickedModel.replace(/^whisper-/, "")
                    : undefined,
              })
            }
          >
            {generating && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            Generate {videos(files.length)}
          </Button>
          {blocked.generate && <Reason text={blocked.generate} />}
        </div>
      </div>
    </section>
  );
}
