import { Loader2 } from "lucide-react";
import { MachineSection } from "@/components/subtitles/MachineSection";
import { MatchesView } from "@/components/subtitles/MatchesView";
import { RunView } from "@/components/subtitles/RunView";
import { TitlesStep } from "@/components/subtitles/TitlesStep";
import { WorkflowBar } from "@/components/subtitles/WorkflowBar";
import type { SubtitleWorkflow } from "@/hooks/useSubtitleWorkflow";
import type { MatchRowState, RunItem } from "@/types/subtitle";
import type { SubtitlePack } from "@/types/subtitlePack";

/**
 * The open temporary workflow of the Subtitles page (Titles, Matches, Run, or the Generated
 * and translated section), under its slim bar. Composition only: the state is the page's
 * `useSubtitleWorkflow`, handed in whole like Organize's tag edits. Props-in/callbacks-out.
 */
export function WorkflowView({
  w,
  hasTmdbKey,
  settingsEngine,
  packs,
  models,
  blocked,
  titleOf,
  queuePosition,
  cancelling,
  onCancel,
  onCompareRow,
  onCompareItem,
  comparingItem,
}: {
  w: SubtitleWorkflow;
  hasTmdbKey: boolean;
  settingsEngine: string;
  packs: SubtitlePack[] | null;
  models: SubtitlePack[] | null;
  blocked: { translate: string | null; generate: string | null };
  titleOf: (videoPath: string) => { key: string; name: string };
  queuePosition: number | null;
  cancelling: boolean;
  onCancel: (jobId: number) => void;
  onCompareRow: (row: MatchRowState) => void;
  onCompareItem: (item: RunItem) => void;
  /** The failed item whose "Pick another" search is running. */
  comparingItem: RunItem | null;
}) {
  const { wf } = w;
  if (!wf) return null;

  const machine = (keepExisting: boolean, onKeepExistingChange?: (v: boolean) => void) => (
    <MachineSection
      files={w.machineFiles}
      packs={packs}
      models={models}
      blocked={blocked}
      keepExisting={keepExisting}
      onKeepExistingChange={onKeepExistingChange}
      sources={w.translateSources}
      translating={w.translating}
      generating={w.generating}
      onTranslate={(r) => w.translate({ ...r, keepExisting })}
      onGenerate={(r) => w.generate({ ...r, keepExisting })}
    />
  );

  const body = () => {
    if (wf.stage === "titles")
      return (
        <TitlesStep
          titles={w.choices}
          scope={w.scope}
          onScopeChange={w.setScope}
          hasTmdbKey={hasTmdbKey}
          onIdentity={w.setIdentity}
          onToggleSkip={w.toggleSkip}
          onSearch={w.toMatches}
        />
      );
    if (wf.stage === "matches")
      return (
        <MatchesView
          titles={w.choices
            .filter((c) => !c.skipped)
            .map((c) => ({
              key: c.key,
              name: c.identity.year ? `${c.identity.title} (${c.identity.year})` : c.identity.title,
            }))}
          rows={w.matches.rows}
          wanted={w.matchesWanted}
          progress={w.matches.progress}
          checks={w.matches.checks}
          paused={w.matches.paused}
          checksSkipped={w.matches.checksSkipped}
          errors={w.matches.errors}
          notes={w.matches.notes}
          onPause={w.matches.pause}
          onResume={w.matches.resume}
          onSkipChecks={w.matches.skipChecks}
          onRetrySearch={w.matches.retry}
          onToggleUse={w.matches.toggleUse}
          onApproveAllClean={w.matches.approveAllClean}
          unconfirmed={w.unconfirmed}
          onPickTitle={w.toTitles}
          onFindAnother={w.matches.findAnother}
          onCompare={onCompareRow}
          settingsEngine={settingsEngine}
          downloading={w.downloading}
          onDownload={w.download}
          renderMachine={(keep) => machine(keep)}
        />
      );
    if (wf.stage === "run" && w.runJob.id === null && !w.runJob.loaded)
      return (
        <p className="text-sm text-muted-foreground" role="status">
          This run could not be read. Its record may have been cleared; the Jobs page lists what
          ran.
        </p>
      );
    if (wf.stage === "run")
      return w.runJob.loaded ? (
        <RunView
          entries={w.entries}
          titleOf={titleOf}
          status={w.runJob.status}
          currentFile={w.runJob.currentFile}
          queuePosition={queuePosition}
          error={w.runJob.error}
          cancelling={cancelling}
          retrying={w.downloading}
          onCancel={() => w.runJob.id != null && onCancel(w.runJob.id)}
          onRetry={w.retry}
          onCompare={onCompareItem}
          comparing={comparingItem}
        />
      ) : (
        <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <Loader2 className="h-4 w-4 animate-spin" />
          Reading the run…
        </p>
      );
    return machine(w.machineKeep, w.setMachineKeep);
  };

  return (
    <div className="space-y-4">
      <WorkflowBar
        stage={wf.stage}
        onTitles={wf.stage === "matches" ? w.toTitles : undefined}
        onBack={w.close}
      />
      {body()}
    </div>
  );
}
