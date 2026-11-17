import type { Candidate } from "@/types/subtitle";

/** A small tag on a candidate that is a season pack, not one episode. Nothing for any other. */
export function SeasonPackTag({ candidate }: { candidate: Pick<Candidate, "release_kind"> }) {
  if (candidate.release_kind !== "season_pack") return null;
  return (
    <span
      title="A season pack: only this episode's file is used"
      className="shrink-0 rounded-sm border border-amber-500/50 px-1 text-3xs font-medium text-amber-500"
    >
      season pack
    </span>
  );
}
