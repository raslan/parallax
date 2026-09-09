import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Loader2, Settings2, ShieldCheck } from "lucide-react";
import { api, qk } from "@/lib/api";
import { getErrorMessage } from "@/lib/api/client";
import { useEventSource } from "@/hooks/useEventSource";
import { useGalleryDlStatus } from "@/hooks/useGalleryDlStatus";
import { zodResolver } from "@/lib/zodResolver";
import { galleryOptionsSchema, GALLERY_OPTIONS_DEFAULTS } from "@/lib/schemas/gallery";
import type { GalleryOptions } from "@/lib/schemas/gallery";
import type { GalleryDownload } from "@/types/gallery";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CookiesModal } from "@/components/downloads-common/CookiesModal";
import { GalleryQueue } from "@/components/galleries/GalleryQueue";
import { GalleryOptionsPanel } from "@/components/galleries/GalleryOptionsPanel";
import { UrlInput } from "@/components/galleries/UrlInput";
import { GalleryDlBanner } from "@/components/galleries/GalleryDlBanner";

type Filter = "all" | "active" | "done" | "failed";

export function Galleries() {
  const qc = useQueryClient();
  const gdl = useGalleryDlStatus();

  const [rows, setRows] = useState<GalleryDownload[]>([]);
  const [pasteInput, setPasteInput] = useState("");
  const [fileInput, setFileInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<Filter>("all");
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [showCookies, setShowCookies] = useState(false);
  const [activeCookies, setActiveCookies] = useState(
    () => sessionStorage.getItem("gdl_cookies") ?? "",
  );

  useEffect(() => {
    if (activeCookies) sessionStorage.setItem("gdl_cookies", activeCookies);
    else sessionStorage.removeItem("gdl_cookies");
  }, [activeCookies]);

  useEventSource<GalleryDownload[]>(api.galleriesSseUrl(), setRows);

  // ── Options form: seed-once, then debounced PUT on change ──────────────────
  const form = useForm<GalleryOptions>({
    resolver: zodResolver(galleryOptionsSchema),
    defaultValues: GALLERY_OPTIONS_DEFAULTS,
  });
  const { data: fetchedOptions } = useQuery({
    queryKey: qk.galleryOptions(),
    queryFn: () => api.getGalleryOptions(),
  });
  // `seeded` ref guards the effect body; `isSeeded` state delays the options
  // panel's mount to one render past the seed so its `showMin` (a mount-time
  // useState) initialises from the real saved blob, not the empty defaults.
  const seeded = useRef(false);
  const [isSeeded, setIsSeeded] = useState(false);
  useEffect(() => {
    if (!fetchedOptions || seeded.current) return;
    form.reset(galleryOptionsSchema.parse(fetchedOptions));
    seeded.current = true;
    setIsSeeded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchedOptions]);

  const putOptions = useMutation({
    mutationFn: (opts: GalleryOptions) => api.putGalleryOptions(opts),
  });
  useEffect(() => {
    if (!isSeeded) return;
    let t: ReturnType<typeof setTimeout>;
    // form.watch trips the React Compiler lint (known false positive — rhf
    // mutates refs the compiler can't track). Same as OptionsPanel on /downloads.
    const sub = form.watch((v) => {
      clearTimeout(t);
      t = setTimeout(() => {
        const parsed = galleryOptionsSchema.safeParse(v);
        if (parsed.success) putOptions.mutate(parsed.data);
      }, 600);
    });
    return () => {
      clearTimeout(t);
      sub.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, isSeeded]);

  // ── File-mode URL file ────────────────────────────────────────────────────
  const inputMode = form.watch("inputMode");
  const { data: urlfile } = useQuery({
    queryKey: qk.galleryUrlfile(),
    queryFn: () => api.getGalleryUrlfile(),
    enabled: inputMode === "file",
  });
  const fileSeeded = useRef(false);
  useEffect(() => {
    if (urlfile && !fileSeeded.current) {
      setFileInput(urlfile.text);
      fileSeeded.current = true;
    }
  }, [urlfile]);
  const saveFile = useMutation({
    mutationFn: (text: string) => api.putGalleryUrlfile(text),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.galleryUrlfile() }),
  });

  // ── Submit ───────────────────────────────────────────────────────────────
  const doSubmit = async () => {
    setSubmitError(null);
    const baseDir = form.getValues("baseDir").trim();
    if (!baseDir) {
      setSubmitError("Pick a base directory in options first →");
      return;
    }
    const urls =
      inputMode === "file"
        ? []
        : pasteInput
            .split("\n")
            .map((l) => l.trim())
            .filter(Boolean);
    if (inputMode === "paste" && urls.length === 0) return;
    setSubmitting(true);
    try {
      await api.enqueueGalleries({ urls, cookies: activeCookies });
      if (inputMode === "paste") setPasteInput("");
    } catch (e) {
      setSubmitError(getErrorMessage(e));
    } finally {
      setSubmitting(false);
    }
  };

  const removeRow = async (id: number) => {
    await api.deleteGallery(id).catch(() => {});
    setRows((prev) => prev.filter((r) => r.id !== id));
  };

  return (
    <div className="p-4 md:p-8">
      {/* Two-column layout: left = header + input + queue, right = options
          (options card sits in its own grid column so it top-aligns with the title) */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-6 items-start">
        <div className="space-y-6 min-w-0">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Galleries</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Download image &amp; video galleries with gallery-dl.
            </p>
          </div>

          {gdl.missing && !bannerDismissed && (
            <GalleryDlBanner onDismiss={() => setBannerDismissed(true)} />
          )}

          <div className="space-y-4">
            <UrlInput
              mode={inputMode}
              onModeChange={(m) => form.setValue("inputMode", m, { shouldDirty: true })}
              pasteValue={pasteInput}
              onPasteChange={setPasteInput}
              fileValue={fileInput}
              onFileChange={setFileInput}
              onFileSave={() => saveFile.mutate(fileInput)}
              fileSaving={saveFile.isPending}
              onSubmit={doSubmit}
            />
            <div className="flex items-center gap-3">
              <Button
                onClick={doSubmit}
                disabled={submitting || (inputMode === "paste" && !pasteInput.trim())}
                className="gap-2"
              >
                {submitting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Download className="h-3.5 w-3.5" />
                )}
                {submitting ? "Adding…" : "Fetch"}
              </Button>
              <span className="text-[10px] text-muted-foreground/40">Ctrl+Enter to submit</span>
              {submitError && <span className="text-xs text-red-400 ml-auto">{submitError}</span>}
            </div>

            <GalleryQueue
              rows={rows}
              statusFilter={statusFilter}
              onStatusFilterChange={setStatusFilter}
              onStop={removeRow}
              onRemove={removeRow}
              onRetry={() => {
                // per-row retry = retry-all-failed (no per-row endpoint in v1)
                void api.retryFailedGalleries().catch(() => {});
              }}
              onStopAll={async () => {
                await api.stopAllGalleries().catch(() => {});
                setRows((prev) =>
                  prev.filter((r) => r.status !== "pending" && r.status !== "running"),
                );
              }}
              onRetryAllFailed={() => void api.retryFailedGalleries().catch(() => {})}
              onClearCompleted={async () => {
                await api.clearGalleries(["completed"]).catch(() => {});
                setRows((prev) => prev.filter((r) => r.status !== "completed"));
              }}
              onClearAll={async () => {
                await api.clearGalleries(["completed", "failed", "cancelled"]).catch(() => {});
                setRows((prev) =>
                  prev.filter((r) => r.status === "pending" || r.status === "running"),
                );
              }}
            />
          </div>
        </div>

        <Card className="overflow-hidden border-border/50 sticky top-6">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border/30">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Settings2 className="h-3.5 w-3.5 text-muted-foreground/60" />
              Options
            </div>
            <button
              onClick={() => setShowCookies(true)}
              className={cn(
                "relative flex items-center gap-1.5 px-2.5 py-1 rounded text-xs border transition-colors",
                activeCookies
                  ? "border-amber-500/50 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20"
                  : "border-border/50 text-muted-foreground/60 hover:text-foreground hover:border-border",
              )}
            >
              <ShieldCheck className="h-3 w-3" />
              Cookies
            </button>
          </div>
          <div className="px-4 pb-4 pt-3">
            {isSeeded ? (
              <GalleryOptionsPanel form={form} />
            ) : (
              <div className="flex justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            )}
          </div>
        </Card>
      </div>

      <CookiesModal
        open={showCookies}
        value={activeCookies}
        onApply={setActiveCookies}
        onClear={() => setActiveCookies("")}
        onClose={() => setShowCookies(false)}
      />
    </div>
  );
}
