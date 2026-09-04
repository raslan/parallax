import { Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface SaveState {
  saving: boolean;
  saved: boolean;
  dirty: boolean;
  onSave: () => void;
}

export function SaveButton({ saving, saved, dirty, onSave }: SaveState) {
  return (
    <Button onClick={onSave} disabled={saving || !dirty} size="sm">
      {saving && <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />}
      {saved && <Check className="h-3.5 w-3.5 mr-2 text-green-400" />}
      {saved ? "Saved" : "Save changes"}
    </Button>
  );
}
