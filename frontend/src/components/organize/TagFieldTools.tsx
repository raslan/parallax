import { useMemo, useState } from "react";
import { Replace } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tip } from "@/components/Tip";
import type { TagEdits } from "@/hooks/useOrganizeTagEdits";
import { compileFindReplace } from "@/lib/findReplace";
import { effectiveValue, type FieldOp } from "@/lib/organizeTagEdits";
import { toastStageResult } from "@/lib/organizeToast";
import type { OrganizeFile, OrganizeTagInfo } from "@/types/organize";

type Infos = Record<string, OrganizeTagInfo | null | undefined>;

function ToolsBody({
  field,
  files,
  infos,
  edits,
  done,
}: {
  field: string;
  files: OrganizeFile[];
  infos: Infos;
  edits: TagEdits;
  done: () => void;
}) {
  const [find, setFind] = useState("");
  const [replace, setReplace] = useState("");
  const [regex, setRegex] = useState(false);
  const [text, setText] = useState("");

  const rule = useMemo(() => compileFindReplace({ find, replace, regex }), [find, replace, regex]);
  // What each file would read as, counting edits already staged (operations chain).
  const changed = useMemo(() => {
    if (!find || rule.error) return 0;
    return files.filter((f) => {
      const value = effectiveValue(infos[f.path], edits.staged[f.path], field);
      return value !== undefined && rule.apply(value) !== value;
    }).length;
  }, [find, rule, files, infos, edits.staged, field]);

  const run = async (op: FieldOp) => {
    done();
    toastStageResult(await edits.stage(field, op));
  };

  return (
    <div className="space-y-4 p-3">
      <section className="space-y-2">
        <h4 className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
          Find and replace
        </h4>
        <div className="space-y-1">
          <Label htmlFor={`find-${field}`} className="text-xs">
            Find
          </Label>
          <Input id={`find-${field}`} value={find} onChange={(e) => setFind(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`replace-${field}`} className="text-xs">
            Replace with
          </Label>
          <Input
            id={`replace-${field}`}
            value={replace}
            onChange={(e) => setReplace(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-2">
          <Checkbox
            id={`regex-${field}`}
            checked={regex}
            onCheckedChange={(v) => setRegex(v === true)}
          />
          <Label htmlFor={`regex-${field}`} className="text-xs">
            Regular expression
          </Label>
        </div>
        {rule.error ? (
          <p role="alert" className="text-xs text-destructive">
            {rule.error}
          </p>
        ) : (
          find && (
            <p className="text-xs text-muted-foreground">
              {changed} of {files.length} {files.length === 1 ? "file changes" : "files change"}
            </p>
          )
        )}
        <Button
          size="sm"
          className="w-full"
          disabled={!find || !!rule.error || changed === 0}
          onClick={() => void run({ op: "replace", rule: { find, replace, regex } })}
        >
          Replace
        </Button>
      </section>

      <section className="space-y-2 border-t border-border pt-3">
        <h4 className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
          Add text
        </h4>
        <div className="space-y-1">
          <Label htmlFor={`add-${field}`} className="text-xs">
            Text to add
          </Label>
          <Input id={`add-${field}`} value={text} onChange={(e) => setText(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={!text}
            onClick={() => void run({ op: "prepend", text })}
          >
            At the start
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!text}
            onClick={() => void run({ op: "append", text })}
          >
            At the end
          </Button>
        </div>
      </section>
    </div>
  );
}

/** The find-and-replace and add-text tools of one field, in a popover. */
export function TagFieldTools({
  field,
  label,
  files,
  infos,
  edits,
}: {
  field: string;
  label: string;
  files: OrganizeFile[];
  infos: Infos;
  edits: TagEdits;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tip label={`Find and replace, or add text, in ${label}`}>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="icon" className="h-6 w-6" aria-label={`Edit ${label} text`}>
            <Replace className="h-3.5 w-3.5" />
          </Button>
        </PopoverTrigger>
      </Tip>
      <PopoverContent aria-label={`Edit ${label} text`}>
        <ToolsBody
          field={field}
          files={files}
          infos={infos}
          edits={edits}
          done={() => setOpen(false)}
        />
      </PopoverContent>
    </Popover>
  );
}
