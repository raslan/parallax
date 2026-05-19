import { useEffect, useState } from "react";
import { Loader2, ArrowLeft, Folder, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";

interface DirPickerProps {
  onSelect: (path: string) => void;
  onClose: () => void;
}

export function DirPicker({ onSelect, onClose }: DirPickerProps) {
  const [currentPath, setCurrentPath] = useState("/media");
  const [dirs, setDirs] = useState<string[]>([]);
  const [parent, setParent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [manualPath, setManualPath] = useState("");

  const browse = async (path: string) => {
    setLoading(true);
    setError("");
    try {
      const res = await api.fsBrowse(path);
      setCurrentPath(res.path);
      setDirs(res.dirs);
      setParent(res.parent);
      setManualPath("");
    } catch (e: any) {
      setError(e.message || "Cannot open directory");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { browse("/media"); }, []);

  const handleManualGo = () => {
    if (manualPath.trim()) browse(manualPath.trim());
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          disabled={!parent || loading}
          onClick={() => parent && browse(parent)}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <span className="text-sm font-mono text-muted-foreground truncate flex-1" title={currentPath}>
          {currentPath}
        </span>
      </div>

      <div className="border border-border rounded-md overflow-hidden">
        <div className="max-h-48 overflow-y-auto">
          {loading && (
            <div className="flex justify-center py-6">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          )}
          {!loading && error && (
            <p className="text-xs text-destructive px-3 py-2">{error}</p>
          )}
          {!loading && !error && dirs.length === 0 && (
            <p className="text-xs text-muted-foreground px-3 py-2">No subdirectories</p>
          )}
          {!loading && dirs.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => browse(`${currentPath}/${d}`)}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-muted/50 transition-colors text-left"
            >
              <Folder className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className="truncate">{d}</span>
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground ml-auto shrink-0" />
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-2">
        <Input
          placeholder="Or type a path…"
          value={manualPath}
          onChange={(e) => setManualPath(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleManualGo(); } }}
          className="text-sm font-mono"
        />
        <Button type="button" variant="outline" size="sm" onClick={handleManualGo} disabled={!manualPath.trim() || loading}>
          Go
        </Button>
      </div>

      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
        <Button type="button" size="sm" onClick={() => onSelect(currentPath)}>
          Select "{currentPath.split("/").pop() || "/"}"
        </Button>
      </div>
    </div>
  );
}
