import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { QueryBuilder } from "@/components/QueryBuilder";
import { SmartSelect, type SmartSelectOption } from "@/components/SmartSelect";
import { Tip } from "@/components/Tip";
import { NameGroupChips } from "@/components/organize/NameGroupChips";
import type { useOrganizeFilters } from "@/hooks/useOrganizeFilters";
import { organizeFields } from "@/lib/organizeSearch";

type Filters = ReturnType<typeof useOrganizeFilters>;

/**
 * The bordered card above the file list: the filter query builder, the "still loading"
 * note while enriched clauses wait on details, the shared-name chips, quick selection,
 * Invert and Clear.
 */
export function OrganizeFilterCard({
  clauses,
  fieldsByKey,
  onAdd,
  onRemove,
  onUpdate,
  stillLoading,
  redact,
  fileNames,
  onPickName,
  smartOptions,
  visibleCount,
  hasSelection,
  onInvert,
  onClear,
}: {
  clauses: Filters["clauses"];
  fieldsByKey: Filters["fieldsByKey"];
  onAdd: Filters["addClause"];
  onRemove: Filters["removeClause"];
  onUpdate: Filters["updateClause"];
  stillLoading: number;
  redact: boolean;
  fileNames: string[];
  onPickName: (text: string) => void;
  smartOptions: SmartSelectOption[];
  /** How many files the filters currently show. */
  visibleCount: number;
  hasSelection: boolean;
  onInvert: () => void;
  onClear: () => void;
}) {
  return (
    <div className="space-y-3 rounded-lg border bg-card p-4">
      <QueryBuilder
        registry={organizeFields}
        clauses={clauses}
        fieldsByKey={fieldsByKey}
        onAdd={onAdd}
        onRemove={onRemove}
        onUpdate={onUpdate}
      />
      {stillLoading > 0 && (
        <p
          role="status"
          className="flex animate-fade-in items-center gap-1.5 text-xs text-muted-foreground"
        >
          <Loader2 className="h-3 w-3 animate-spin" />
          <span className="tabular-nums">{stillLoading.toLocaleString()}</span> still loading,
          matches may grow as file details arrive
        </p>
      )}
      {!redact && <NameGroupChips names={fileNames} onPick={onPickName} />}
      <div className="flex flex-wrap items-stretch gap-2">
        <SmartSelect options={smartOptions} />
        <div className="flex items-center gap-1">
          <Tip label="Select the shown files that are not selected, and deselect the rest">
            <Button variant="outline" size="sm" disabled={visibleCount === 0} onClick={onInvert}>
              Invert
            </Button>
          </Tip>
          <Button variant="ghost" size="sm" disabled={!hasSelection} onClick={onClear}>
            Clear
          </Button>
        </div>
      </div>
    </div>
  );
}
