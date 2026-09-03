import { useState } from "react";
import { Controller } from "react-hook-form";
import { Download, FolderOpen, Loader2 } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, qk } from "@/lib/api";
import { DirPicker } from "@/components/DirPicker";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { downloadsSettingsSchema, seedDownloads } from "@/lib/schemas/settings";
import { SaveButton } from "./SaveButton";
import { useSettingsForm } from "./useSettingsForm";

export function DownloadsTab() {
  const { form, save } = useSettingsForm(downloadsSettingsSchema, seedDownloads, (v) => ({
    download_dir: v.downloadDir,
    max_concurrent_downloads: v.maxConcurrentDownloads,
    ytdlp_channel: v.ytdlpChannel,
  }));
  const [showDirPicker, setShowDirPicker] = useState(false);

  const qc = useQueryClient();
  const { data: ytdlpInfo } = useQuery({
    queryKey: qk.ytdlpInfo(),
    queryFn: () => api.ytdlpInfo(),
  });
  const update = useMutation({
    mutationFn: () => api.ytdlpUpdate(),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.ytdlpInfo() }),
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-6 space-y-4">
          <div>
            <p className="text-sm font-medium mb-1">Default download directory</p>
            <p className="text-xs text-muted-foreground mb-3">
              Where downloaded files are saved. Can be overridden per download.
            </p>
            <Controller
              control={form.control}
              name="downloadDir"
              render={({ field, fieldState }) =>
                showDirPicker ? (
                  <DirPicker
                    onSelect={(p) => {
                      field.onChange(p);
                      setShowDirPicker(false);
                    }}
                    onClose={() => setShowDirPicker(false)}
                  />
                ) : (
                  <>
                    <div className="flex gap-2 items-center">
                      <code className="text-xs bg-muted px-2 py-1 rounded flex-1 truncate">
                        {field.value}
                      </code>
                      <Button size="sm" variant="outline" onClick={() => setShowDirPicker(true)}>
                        <FolderOpen className="h-3.5 w-3.5 mr-1.5" />
                        Browse
                      </Button>
                    </div>
                    {fieldState.error && (
                      <p className="text-xs text-destructive mt-1">{fieldState.error.message}</p>
                    )}
                  </>
                )
              }
            />
          </div>
          <Controller
            control={form.control}
            name="maxConcurrentDownloads"
            render={({ field }) => (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-medium">Max concurrent downloads</p>
                  <span className="text-sm font-mono">{field.value}</span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={5}
                  step={1}
                  value={field.value ?? 1}
                  onChange={(e) => field.onChange(Number(e.target.value))}
                  className="w-48 accent-primary"
                />
                <div className="flex justify-between text-xs text-muted-foreground w-48 mt-1">
                  <span>1</span>
                  <span>5</span>
                </div>
              </div>
            )}
          />
        </CardContent>
      </Card>

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
          <Controller
            control={form.control}
            name="ytdlpChannel"
            render={({ field }) => (
              <div>
                <p className="text-xs text-muted-foreground mb-2">Release channel</p>
                <div className="flex gap-1">
                  {(["stable", "nightly"] as const).map((ch) => (
                    <button
                      key={ch}
                      type="button"
                      onClick={() => field.onChange(ch)}
                      className={`px-3 py-1 rounded text-xs border transition-colors capitalize ${
                        field.value === ch
                          ? "bg-primary text-primary-foreground border-primary"
                          : "border-border hover:bg-accent"
                      }`}
                    >
                      {ch}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground mt-1.5">
                  {field.value === "nightly"
                    ? "Built nightly from master — latest fixes, may be unstable."
                    : "Latest tagged release — tested and stable."}
                </p>
              </div>
            )}
          />
          <Button
            size="sm"
            variant="outline"
            disabled={update.isPending}
            onClick={() => update.mutate()}
          >
            {update.isPending ? (
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
