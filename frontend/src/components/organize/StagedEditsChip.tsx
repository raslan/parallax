import { PencilLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tip } from "@/components/Tip";

/**
 * "Review N staged": always reachable at the top of the page while any file has a staged
 * tag edit, in any folder and with nothing selected, so an edit staged somewhere else is
 * never forgotten. Renders nothing when there are none.
 */
export function StagedEditsChip({
  count,
  onReview,
  disabled = false,
}: {
  count: number;
  onReview: () => void;
  disabled?: boolean;
}) {
  if (count === 0) return null;
  return (
    <Tip label="Tag edits are written only after you review them">
      <Button
        size="sm"
        variant="outline"
        className="border-amber-400/50 text-amber-400 hover:text-amber-300"
        disabled={disabled}
        onClick={onReview}
      >
        <PencilLine className="mr-1.5 h-3.5 w-3.5" />
        Review {count} staged
      </Button>
    </Tip>
  );
}
