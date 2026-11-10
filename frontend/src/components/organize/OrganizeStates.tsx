import { Link } from "react-router";
import { CornerLeftUp, FolderOpen, FolderTree, FolderX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/EmptyState";

/** No root folder chosen yet. */
export function NoRootState({ onChoose }: { onChoose: () => void }) {
  return (
    <EmptyState
      icon={FolderTree}
      title="Choose a folder to organize"
      description="Pick any folder and Organize will map it and count what is inside, so you can find files, look at their tags, move or rename them and delete what you do not need."
      action={
        <Button onClick={onChoose}>
          <FolderOpen className="mr-1.5 h-3.5 w-3.5" />
          Choose folder
        </Button>
      }
    />
  );
}

/** The saved root can no longer be read (moved, deleted, unmounted). */
export function UnavailableState({ onChangeFolder }: { onChangeFolder: () => void }) {
  return (
    <EmptyState
      icon={FolderX}
      title="This folder is no longer available"
      description="It may have been moved, deleted or unmounted. Choose another folder to continue."
      action={
        <Button onClick={onChangeFolder}>
          <FolderOpen className="mr-1.5 h-3.5 w-3.5" />
          Change folder
        </Button>
      }
    />
  );
}

/** The open folder no longer exists, or the link points outside the root. */
export function GoneState() {
  return (
    <EmptyState
      icon={FolderX}
      title="This folder is gone"
      description="It was moved or deleted since the last scan, or the link points outside the chosen folder. Head back up, or rescan to refresh the tree."
      action={
        // Replaces the dead entry, so Back never lands on the gone folder again.
        <Button asChild>
          <Link to={{ search: "" }} replace>
            <CornerLeftUp className="mr-1.5 h-3.5 w-3.5" />
            Back to the top folder
          </Link>
        </Button>
      }
    />
  );
}
