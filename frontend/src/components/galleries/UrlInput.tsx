import { type KeyboardEvent } from "react";
import { Link as LinkIcon, Loader2, Save } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

export function UrlInput({
  mode,
  onModeChange,
  pasteValue,
  onPasteChange,
  fileValue,
  onFileChange,
  onFileSave,
  fileSaving,
  onSubmit,
}: {
  mode: "paste" | "file";
  onModeChange: (m: "paste" | "file") => void;
  pasteValue: string;
  onPasteChange: (v: string) => void;
  fileValue: string;
  onFileChange: (v: string) => void;
  onFileSave: () => void;
  fileSaving: boolean;
  onSubmit: () => void;
}) {
  const submitOnCtrlEnter = (e: KeyboardEvent) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      onSubmit();
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <LinkIcon className="h-3.5 w-3.5 text-muted-foreground/50" />
        <label className="text-xs font-medium text-muted-foreground">Gallery URLs</label>
      </div>
      <Tabs value={mode} onValueChange={(v) => onModeChange(v as "paste" | "file")}>
        <TabsList>
          <TabsTrigger value="paste">Paste</TabsTrigger>
          <TabsTrigger value="file">File</TabsTrigger>
        </TabsList>

        <TabsContent value="paste">
          <textarea
            value={pasteValue}
            onChange={(e) => onPasteChange(e.target.value)}
            onKeyDown={submitOnCtrlEnter}
            placeholder={"One gallery URL per line\nhttps://…"}
            rows={4}
            className="w-full rounded-md border border-input bg-background px-3 py-2.5 text-sm font-mono resize-none focus:outline-none focus:ring-2 focus:ring-ring placeholder:text-muted-foreground/30 placeholder:font-sans"
          />
        </TabsContent>

        <TabsContent value="file">
          <textarea
            value={fileValue}
            onChange={(e) => onFileChange(e.target.value)}
            onKeyDown={submitOnCtrlEnter}
            placeholder={"One gallery URL per line — saved to gallery-dl/urls.txt"}
            rows={4}
            className="w-full rounded-md border border-input bg-background px-3 py-2.5 text-sm font-mono resize-none focus:outline-none focus:ring-2 focus:ring-ring placeholder:text-muted-foreground/30 placeholder:font-sans"
          />
          <div className="flex items-center gap-2 mt-1.5">
            <button
              type="button"
              onClick={onFileSave}
              disabled={fileSaving}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded border border-border/50 text-xs text-muted-foreground hover:text-foreground hover:border-border transition-colors"
            >
              {fileSaving ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Save className="h-3 w-3" />
              )}
              Save
            </button>
            <span className="text-[10px] text-muted-foreground/40">
              Edits persist across restarts
            </span>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
