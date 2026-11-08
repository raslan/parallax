import { useState } from "react";
import { PercentSlider } from "@/components/QueryBuilder";
import { UnitInput } from "@/components/UnitInput";
import {
  MAX_STRETCH_SECONDS,
  SIMILARITY_MAX_PCT,
  SIMILARITY_MIN_PCT,
  clampSimilarityPct,
  parseStretchSeconds,
} from "@/lib/sharedAudio";

/** The three shared-audio settings, as stored on both duplicate pages' criteria. */
export interface SharedAudioSettings {
  audio_threshold: number;
  audio_similarity: number;
  audio_min_stretch: number;
}

/**
 * The popover body of the "Shared audio" chip, shared by the video and audio Duplicates
 * pages. "Min shared" re-groups instantly in the browser; the other two change what the
 * server measures, so they only take effect on the next Extract / Find duplicates.
 */
export function SharedAudioEditor({
  settings,
  runLabel,
  onChange,
}: {
  settings: SharedAudioSettings;
  /** The name of the page's button that runs the server scan ("Extract", "Find duplicates"). */
  runLabel: string;
  onChange: (patch: Partial<SharedAudioSettings>) => void;
}) {
  // What is being typed in the seconds field, so clearing it to type a new number does not
  // snap to 0 and a too-big number is shown as typed until the field loses focus.
  const [stretchDraft, setStretchDraft] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <PercentSlider
        leading={<span className="text-xs text-muted-foreground">Sounds alike</span>}
        value={Math.round(settings.audio_similarity * 100)}
        min={SIMILARITY_MIN_PCT}
        max={SIMILARITY_MAX_PCT}
        onChange={(v) => onChange({ audio_similarity: clampSimilarityPct(v) / 100 })}
      />
      <p className="-mt-2 text-2xs text-muted-foreground/70">
        How closely a stretch of audio must match to count. Raise it for strict matches. Lower it a
        little for copies with worse sound; near the bottom of its range, unrelated tracks can start
        to match.
      </p>
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="text-xs text-muted-foreground">Shared for at least</span>
        <UnitInput
          aria-label="Shared for at least, in seconds"
          min={0}
          max={MAX_STRETCH_SECONDS}
          step={1}
          value={stretchDraft ?? String(settings.audio_min_stretch)}
          onChange={(e) => {
            setStretchDraft(e.target.value);
            const seconds = parseStretchSeconds(e.target.value);
            if (seconds != null) onChange({ audio_min_stretch: seconds });
          }}
          onBlur={() => setStretchDraft(null)}
          unit="seconds"
          className="w-28"
        />
      </div>
      <p className="-mt-2 text-2xs text-muted-foreground/70">
        Matching audio only counts if it runs this long without a break. Raise it to ignore short
        snippets that merely sound similar. A clip shorter than this must match whole.
      </p>
      <PercentSlider
        leading={<span className="text-xs text-muted-foreground">Min shared</span>}
        value={Math.round(settings.audio_threshold * 100)}
        onChange={(v) => onChange({ audio_threshold: v / 100 })}
      />
      <p className="-mt-2 text-2xs text-muted-foreground/70">
        How much of the shorter file must be found in the other.
      </p>
      <p className="border-t pt-2 text-2xs text-muted-foreground/70">
        Changing Sounds alike or Shared for at least takes effect the next time you press {runLabel}
        .
      </p>
    </div>
  );
}
