import { ArrowLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type WorkflowStage = "titles" | "plan" | "run" | "machine";

const STEPS: { id: Exclude<WorkflowStage, "machine">; label: string }[] = [
  { id: "titles", label: "Titles" },
  { id: "plan", label: "Plan" },
  { id: "run", label: "Run" },
];

/**
 * The slim bar over a temporary Subtitles workflow (Find subtitles: Titles, Plan, Run; or
 * the Generated and translated section on its own): where it is, a way back to Titles from
 * the plan, and Back to folder. The page stays the folder; this is not a wizard.
 * Props-in/callbacks-out.
 */
export function WorkflowBar({
  stage,
  onTitles,
  onBack,
}: {
  stage: WorkflowStage;
  /** Returns from the plan to the titles; omitted where that makes no sense. */
  onTitles?: () => void;
  onBack: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-border bg-card px-3 py-2 text-xs">
      {stage === "machine" ? (
        <span className="font-medium">Generated and translated subtitles</span>
      ) : (
        <ol className="flex items-center gap-1" aria-label="Find subtitles">
          {STEPS.map((s, i) => {
            const current = s.id === stage;
            const back = s.id === "titles" && stage === "plan" && onTitles;
            return (
              <li key={s.id} className="flex items-center gap-1">
                {i > 0 && <ChevronRight className="h-3 w-3 text-muted-foreground" />}
                {back ? (
                  <button
                    type="button"
                    onClick={onTitles}
                    className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                  >
                    {s.label}
                  </button>
                ) : (
                  <span
                    aria-current={current ? "step" : undefined}
                    className={cn(current ? "font-medium text-primary" : "text-muted-foreground")}
                  >
                    {s.label}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      )}
      <span className="text-muted-foreground">
        {stage === "run"
          ? "The run carries on if you leave; it shows under Activity."
          : "Temporary view. Nothing is changed until you approve."}
      </span>
      <Button size="sm" variant="ghost" className="ml-auto h-7" onClick={onBack}>
        <ArrowLeft className="mr-1 h-3.5 w-3.5" />
        Back to folder
      </Button>
    </div>
  );
}
