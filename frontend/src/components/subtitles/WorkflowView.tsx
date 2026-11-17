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
  cancellingSearch,
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
  /** Jobs whose Cancel is being sent (a search's, here). */
  cancellingSearch: ReadonlySet<number>;
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
          busy={w.starting}
          checkLengths={w.checkLengths}
          onCheckLengthsChange={w.setCheckLengths}
          autoSave={w.autoSave}
          onAutoSaveChange={w.setAutoSave}
          saveOptions={w.saveOptions}
          onSaveOptionsChange={w.setSaveOptions}
        />
      );
    if (wf.stage === "matches")
      return !w.matches.loaded ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <Loader2 className="h-4 w-4 animate-spin" />
          Reading the search…
        </p>
      ) : (
        <MatchesView
          titles={w.matches.titles}
          rows={w.matches.rows}
          wanted={w.matchesWanted}
          progress={w.matches.progress}
          checks={w.matches.checks}
          running={w.matches.running}
          jobStatus={w.matches.jobStatus}
          jobError={w.matches.jobError}
          cancelling={w.matches.jobId != null && cancellingSearch.has(w.matches.jobId)}
          onCancel={() => w.matches.jobId != null && onCancel(w.matches.jobId)}
          checksSkipped={w.matches.checksSkipped}
          errors={w.matches.errors}
          notes={w.matches.notes}
          onToggleUse={w.matches.toggleUse}
          onApproveAllClean={w.matches.approveAllClean}
          unconfirmed={w.matchesUnconfirmed}
          onPickTitle={w.choices.length > 0 ? w.toTitles : undefined}
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
