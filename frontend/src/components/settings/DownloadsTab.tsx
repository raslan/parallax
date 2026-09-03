import { useState } from "react";
import { Download, FolderOpen, Loader2 } from "lucide-react";
import { DirPicker } from "@/components/DirPicker";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SaveButton, type SaveState } from "./SaveButton";

interface YtdlpInfo {
  installed: boolean;
  version: string | null;
  path: string | null;
}

export function DownloadsTab({
  ytdlpInfo,
  downloadDir,
  onDownloadDirChange,
  maxConcurrentDownloads,
  onMaxConcurrentDownloadsChange,
  ytdlpChannel,
  onYtdlpChannelChange,
  ytdlpUpdating,
  onYtdlpUpdate,
  save,
}: {
  ytdlpInfo: YtdlpInfo | undefined;
  downloadDir: string;
  onDownloadDirChange: (p: string) => void;
  maxConcurrentDownloads: number;
  onMaxConcurrentDownloadsChange: (n: number) => void;
  ytdlpChannel: "stable" | "nightly";
  onYtdlpChannelChange: (ch: "stable" | "nightly") => void;
  ytdlpUpdating: boolean;
  onYtdlpUpdate: () => void;
  save: SaveState;
}) {
  const [showDirPicker, setShowDirPicker] = useState(false);

  return (
    <div className="space-y-4">
      {/* Download Directory */}
      <Card>
        <CardContent className="pt-6 space-y-4">
          <div>
            <p className="text-sm font-medium mb-1">Default download directory</p>
            <p className="text-xs text-muted-foreground mb-3">
              Where downloaded files are saved. Can be overridden per download.
            </p>
            {showDirPicker ? (
              <DirPicker
                onSelect={(p) => {
                  onDownloadDirChange(p);
                  setShowDirPicker(false);
                }}
                onClose={() => setShowDirPicker(false)}
              />
            ) : (
              <div className="flex gap-2 items-center">
                <code className="text-xs bg-muted px-2 py-1 rounded flex-1 truncate">
                  {downloadDir}
                </code>
                <Button size="sm" variant="outline" onClick={() => setShowDirPicker(true)}>
                  <FolderOpen className="h-3.5 w-3.5 mr-1.5" />
                  Browse
                </Button>
              </div>
            )}
          </div>
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium">Max concurrent downloads</p>
              <span className="text-sm font-mono">{maxConcurrentDownloads}</span>
            </div>
            <input
              type="range"
              min={1}
              max={5}
              step={1}
              value={maxConcurrentDownloads}
              onChange={(e) => onMaxConcurrentDownloadsChange(Number(e.target.value))}
              className="w-48 accent-primary"
            />
            <div className="flex justify-between text-xs text-muted-foreground w-48 mt-1">
              <span>1</span>
              <span>5</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* yt-dlp management */}
      <Card>
        <CardContent className="pt-6 space-y-3">
          <p className="text-sm font-medium">yt-dlp</p>
          {!ytdlpInfo ? (
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading…
            </div>
          ) : ytdlpInfo.installed ? (
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">
                Version: <span className="font-mono text-foreground">{ytdlpInfo.version}</span>
              </p>
              <p className="text-xs text-muted-foreground truncate">
                Path: <span className="font-mono text-foreground">{ytdlpInfo.path}</span>
              </p>
            </div>
          ) : (
            <p className="text-sm text-amber-400">Not installed. Click Install to set it up.</p>
          )}
          <div>
            <p className="text-xs text-muted-foreground mb-2">Release channel</p>
            <div className="flex gap-1">
              {(["stable", "nightly"] as const).map((ch) => (
                <button
                  key={ch}
                  onClick={() => onYtdlpChannelChange(ch)}
                  className={`px-3 py-1 rounded text-xs border transition-colors capitalize ${
                    ytdlpChannel === ch
                      ? "bg-primary text-primary-foreground border-primary"
                      : "border-border hover:bg-accent"
                  }`}
                >
                  {ch}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-1.5">
              {ytdlpChannel === "nightly"
                ? "Built nightly from master — latest fixes, may be unstable."
                : "Latest tagged release — tested and stable."}
            </p>
          </div>
          <Button size="sm" variant="outline" disabled={ytdlpUpdating} onClick={onYtdlpUpdate}>
            {ytdlpUpdating ? (
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
            ) : (
              <Download className="h-3.5 w-3.5 mr-1.5" />
            )}
            {ytdlpInfo?.installed ? "Update yt-dlp" : "Install yt-dlp"}
          </Button>
        </CardContent>
      </Card>
      <SaveButton {...save} />
    </div>
  );
}
