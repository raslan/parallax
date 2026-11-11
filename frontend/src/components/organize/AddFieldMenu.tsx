import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { fieldLabel, standardFieldFor } from "@/lib/organizeTagEdits";

const MAX_NAME = 100;

/** An error for a custom tag name that would not be accepted, else null. */
function nameProblem(name: string): string | null {
  if (name === "") return "Enter a tag name.";
  if (name.length > MAX_NAME) return `Use at most ${MAX_NAME} characters.`;
  if ([...name].some((c) => c < " " || c === "\u007f")) {
    return "A tag name can't contain line breaks or control characters.";
  }
  const standard = standardFieldFor(name);
  return standard ? `Use the ${fieldLabel(standard)} field.` : null;
}

/**
 * "Add field…": the standard fields the selected files can take that are not shown yet,
 * and "Other tag…" for any other tag name (only where a file can hold one).
 */
export function AddFieldMenu({
  offered,
  canAddRaw,
  onAdd,
  onAddRaw,
}: {
  offered: string[];
  canAddRaw: boolean;
  onAdd: (field: string) => void;
  onAddRaw: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [other, setOther] = useState(false);
  const [name, setName] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  const close = (next: boolean) => {
    setOpen(next);
    if (!next) {
      setOther(false);
      setName("");
      setProblem(null);
    }
  };

  const addTag = () => {
    const trimmed = name.trim();
    const found = nameProblem(trimmed);
    if (found) {
      setProblem(found);
      return;
    }
    onAddRaw(trimmed);
    close(false);
  };

  return (
    <Popover open={open} onOpenChange={close}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="w-full">
          <Plus className="mr-1 h-3.5 w-3.5" />
          Add field…
        </Button>
      </PopoverTrigger>
      <PopoverContent aria-label="Add field" align="start" className="p-2">
        {other ? (
          <div className="space-y-2 p-1">
            <Label htmlFor="other-tag-name" className="text-xs">
              Tag name
            </Label>
            <Input
              id="other-tag-name"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setProblem(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") addTag();
              }}
            />
            {problem && (
              <p role="alert" className="text-xs text-destructive">
                {problem}
              </p>
            )}
            <Button size="sm" className="w-full" onClick={addTag}>
              Add tag
            </Button>
          </div>
        ) : (
          <ul className="space-y-0.5">
            {offered.map((field) => (
              <li key={field}>
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start"
                  onClick={() => {
                    onAdd(field);
                    close(false);
                  }}
                >
                  {fieldLabel(field)}
                </Button>
              </li>
            ))}
            {canAddRaw && (
              <li>
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start"
                  onClick={() => setOther(true)}
                >
                  Other tag…
                </Button>
              </li>
            )}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
