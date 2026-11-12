import { useState } from "react";
import { Controller } from "react-hook-form";
import { AlertCircle, CheckCircle2, Download, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { hardwareApi, qk } from "@/lib/api";
import { errorDetail } from "@/lib/api/client";
import { formatSize } from "@/lib/format";
import { hardwareSchema, seedHardware } from "@/lib/schemas/settings";
import { useJobPoll } from "@/hooks/useJobPoll";
import type { GpuCheck } from "@/types/hardware";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { ProgressBar } from "@/components/ProgressBar";
import { SaveButton } from "./SaveButton";
import { useSettingsForm } from "./useSettingsForm";

export function HardwareTab() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: qk.hardware(),
    queryFn: () => hardwareApi.get(),
  });
  const reload = () => qc.invalidateQueries({ queryKey: qk.hardware() });

  const { form, save } = useSettingsForm(hardwareSchema, seedHardware, (v) => ({
    gpu_accel_enabled: v.gpuEnabled,
    gpu_accel_count: v.gpuCount,
  }));

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [check, setCheck] = useState<GpuCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [resumedFor, setResumedFor] = useState<number | null>(null);

  const poll = useJobPoll({
    onTerminal: (job) => {
      setBusy(false);
      if (job.status === "failed") setError(job.error ?? "Install failed");
      reload();
    },
  });

  // Pick an install that is already running back up after a reload or navigation.
  const installingId = data?.nvidia.installing_job_id ?? null;
  if (installingId != null && resumedFor !== installingId) {
    setResumedFor(installingId);
    setBusy(true);
    poll.start(installingId);
  }

  const pkg = data?.nvidia;
  const installing = busy && poll.jobId != null;

  const install = async () => {
    setBusy(true);
    setError(null);
    setCheck(null);
    try {
      const res = await hardwareApi.installNvidia();
      poll.start(res.job_id);
    } catch (e) {
      setError(errorDetail(e, "Could not start the install"));
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setError(null);
    setCheck(null);
    try {
      await hardwareApi.removeNvidia();
      reload();
    } catch (e) {
      setError(errorDetail(e, "Could not remove the package"));
    } finally {
      setBusy(false);
    }
  };

  const runCheck = async () => {
    setChecking(true);
    setError(null);
    try {
      setCheck(await hardwareApi.checkNvidia());
    } catch (e) {
      setError(errorDetail(e, "The test could not run"));
    } finally {
      setChecking(false);
    }
  };

  const cards = pkg?.nvidia_gpus ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Hardware acceleration</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Graphics cards Parallax found, and an optional download that lets translation and
          speech-to-text use an NVIDIA card.
        </p>
      </div>

      <Card>
        <CardContent className="pt-6 space-y-2">
          <p className="text-sm font-medium">Detected graphics cards</p>
          {isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : data && data.gpus.length > 0 ? (
            <ul className="text-sm text-muted-foreground space-y-1">
              {data.gpus.map((g, i) => (
                <li key={`${g.label}-${i}`}>
                  {g.label} <span className="text-xs">({g.vendor})</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">
              No graphics card was found. Everything runs on the processor.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium">NVIDIA acceleration package</span>
                <span className="text-3xs text-muted-foreground font-mono">
                  {formatSize(pkg?.installed ? pkg.installed_bytes : (pkg?.expected_bytes ?? 0))}
                </span>
                {pkg?.installed && (
                  <span className="text-3xs font-semibold px-1.5 py-0.5 rounded bg-primary text-primary-foreground">
                    Installed
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                The NVIDIA CUDA libraries (cuBLAS and cuDNN). Translation and speech-to-text then
                run on your NVIDIA card, much faster than on the processor. Downloaded once from
                NVIDIA's package index. Only for NVIDIA cards.
              </p>
              {installing && (
                <div className="mt-2 space-y-1">
                  <div className="flex justify-end text-2xs text-muted-foreground">
                    {Math.round(poll.progress)}%
                  </div>
                  <ProgressBar value={poll.progress} label="NVIDIA package download progress" />
                </div>
              )}
              {error && (
                <p className="text-xs text-destructive mt-1 flex items-center gap-1">
                  <AlertCircle className="h-3 w-3 shrink-0" />
                  {error}
                </p>
              )}
              {check && (
                <p
                  className={`text-xs mt-1 flex items-start gap-1 ${check.ok ? "text-green-500" : "text-destructive"}`}
                >
                  {check.ok ? (
                    <CheckCircle2 className="h-3 w-3 shrink-0 mt-0.5" />
                  ) : (
                    <AlertCircle className="h-3 w-3 shrink-0 mt-0.5" />
                  )}
                  {check.message}
                </p>
              )}
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {!pkg?.installed && !installing && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs gap-1"
                  onClick={install}
                  disabled={busy || isLoading}
                >
                  <Download className="h-3 w-3" />
                  Install
                </Button>
              )}
              {installing && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
              {pkg?.installed && !installing && (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs gap-1"
                    onClick={runCheck}
                    disabled={checking || busy}
                  >
                    {checking ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                    Check
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs gap-1"
                    onClick={install}
                    disabled={busy}
                  >
                    <RefreshCw className="h-3 w-3" />
                    Update
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                    onClick={remove}
                    disabled={busy}
                    aria-label="Remove the NVIDIA acceleration package"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {pkg?.installed && (
        <Card>
          <CardContent className="pt-6 space-y-5">
            <Controller
              control={form.control}
              name="gpuEnabled"
              render={({ field }) => (
                <label className="flex items-start justify-between gap-3 cursor-pointer">
                  <div>
                    <p className="text-sm">Use GPU for translation and speech-to-text</p>
                    <p className="text-xs text-muted-foreground/70">
                      {pkg.gpus_in_use > 0
                        ? `On. Jobs use ${pkg.gpus_in_use} card${pkg.gpus_in_use === 1 ? "" : "s"}.`
                        : "Jobs run on the processor. A card that fails is skipped and the file runs on the processor."}
                    </p>
                  </div>
                  <Switch checked={field.value} onCheckedChange={field.onChange} />
                </label>
              )}
            />

            {cards > 0 && (
              <Controller
                control={form.control}
                name="gpuCount"
                render={({ field }) => {
                  const shown = field.value === 0 ? cards : Math.min(field.value, cards);
                  return (
                    <div className="space-y-2">
                      <p className="text-sm">GPUs to use</p>
                      {cards === 1 ? (
                        <p className="text-xs text-muted-foreground">1 (the only NVIDIA card)</p>
                      ) : (
                        <div className="flex items-center gap-4">
                          <Slider
                            min={1}
                            max={cards}
                            value={[shown]}
                            onValueChange={([v]) => field.onChange(v === cards ? 0 : (v ?? cards))}
                            className="w-48"
                            aria-label="GPUs to use"
                          />
                          <span className="text-sm font-mono w-12">
                            {shown} of {cards}
                          </span>
                        </div>
                      )}
                      <p className="text-xs text-muted-foreground/70">
                        Each file runs on one card, never split across cards. With several files
                        queued, every card you allow works on a different one.
                      </p>
                    </div>
                  );
                }}
              />
            )}
            <SaveButton {...save} />
          </CardContent>
        </Card>
      )}

      <p className="text-xs text-muted-foreground">
        This only affects translation and speech-to-text. Video encoding with the graphics card (see
        the Transcoder tab) and the content-detection model are not changed by it.
      </p>
    </div>
  );
}
