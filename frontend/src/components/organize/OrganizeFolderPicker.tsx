import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DirPicker } from "@/components/DirPicker";

/** Modal wrapper around `DirPicker` for choosing the folder Organize works in. */
export function OrganizeFolderPicker({
  open,
  onOpenChange,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (path: string) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onClose={() => onOpenChange(false)}>
        <DialogHeader>
          <DialogTitle>Choose a folder to organize</DialogTitle>
        </DialogHeader>
        <DirPicker
          onSelect={(path) => {
            onOpenChange(false);
            onSelect(path);
          }}
          onClose={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
