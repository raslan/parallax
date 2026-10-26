import { type KeyboardEvent } from "react";
import { FilePen, FilePlus, Link as LinkIcon } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { UrlListInfo } from "@/types/gallery";

const PREVIEW_LINES = 5;

export function UrlInput({
  mode,
  onModeChange,
  pasteValue,
  onPasteChange,
  lists,
  listName,
  onListChange,
  listPreview,
  onEditList,
  onNewList,
  onSubmit,
}: {
  mode: "paste" | "file";
  onModeChange: (m: "paste" | "file") => void;
  pasteValue: string;
  onPasteChange: (v: string) => void;
  /** undefined while loading */
  lists: UrlListInfo[] | undefined;
  listName: string;
  onListChange: (name: string) => void;
  /** saved text of the selected list, for the read-only preview */
  listPreview: string;
  onEditList: () => void;
  onNewList: () => void;
  onSubmit: () => void;
}) {
  const submitOnCtrlEnter = (e: KeyboardEvent) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      onSubmit();
    }
  };

  const selected = lists?.find((l) => l.name === listName);
  const previewLines = listPreview.split("\n").filter((l) => l.trim() !== "");

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
          {lists && lists.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-md border border-dashed border-border/60 px-4 py-6 text-center">
              <p className="text-xs text-muted-foreground">
                No URL lists yet. A list is a saved set of URLs you can re-fetch any time.
              </p>
              <button
                type="button"
                onClick={onNewList}
                className="inline-flex items-center gap-1.5 rounded border border-border/50 px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-border hover:text-foreground"
              >
                <FilePlus className="h-3 w-3" />
                Create a list
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Select value={selected ? listName : undefined} onValueChange={onListChange}>
                  <SelectTrigger className="h-8 w-64 max-w-full text-xs">
                    <SelectValue placeholder={lists ? "Pick a list" : "Loading…"} />
                  </SelectTrigger>
                  <SelectContent>
                    {(lists ?? []).map((l) => (
                      <SelectItem key={l.name} value={l.name}>
                        {l.name}
                        <span className="ml-2 font-mono text-[10px] text-muted-foreground/50">
                          {l.count}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <button
                  type="button"
                  onClick={onEditList}
                  disabled={!selected}
                  className="inline-flex items-center gap-1.5 rounded border border-border/50 px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:border-border hover:text-foreground disabled:opacity-40"
                >
                  <FilePen className="h-3 w-3" />
                  Edit
                </button>
                <button
                  type="button"
                  onClick={onNewList}
                  className="inline-flex items-center gap-1.5 rounded border border-border/50 px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:border-border hover:text-foreground"
                >
                  <FilePlus className="h-3 w-3" />
                  New list
                </button>
                {selected && (
                  <span className="text-[10px] text-muted-foreground/50">
                    {selected.count} URL{selected.count === 1 ? "" : "s"}
                  </span>
                )}
              </div>
              {selected && (
                <button
                  type="button"
                  onClick={onEditList}
                  title="Click to edit"
                  className="block w-full rounded-md border border-input bg-background/50 px-3 py-2 text-left font-mono text-xs text-muted-foreground transition-colors hover:border-border"
                >
                  {previewLines.length === 0 ? (
                    <span className="text-muted-foreground/40">Empty list — click to add URLs</span>
                  ) : (
                    <>
                      {previewLines.slice(0, PREVIEW_LINES).map((l, i) => (
                        <span key={i} className="block truncate">
                          {l}
                        </span>
                      ))}
                      {previewLines.length > PREVIEW_LINES && (
                        <span className="block text-muted-foreground/40">
                          … {previewLines.length - PREVIEW_LINES} more
                        </span>
                      )}
                    </>
                  )}
                </button>
              )}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
