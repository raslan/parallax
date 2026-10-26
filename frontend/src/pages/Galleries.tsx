import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Download, Loader2, MonitorPlay, Settings2, ShieldCheck } from "lucide-react";
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
import { UrlListEditorDialog } from "@/components/galleries/UrlListEditorDialog";
import { useConfirm } from "@/components/ConfirmProvider";
import { YtdlOptionsSheet } from "@/components/galleries/YtdlOptionsSheet";
import { ytdlSummary } from "@/lib/galleryYtdl";
import { GalleryDlBanner } from "@/components/galleries/GalleryDlBanner";

type Filter = "all" | "active" | "done" | "failed";

/** Draft of the URL-list editor dialog (`originalName` = the list as saved on disk). */
type ListEditor = {
  isNew: boolean;
  originalName: string;
  name: string;
  text: string;
  initialText: string;
  error: string | null;
};

export function Galleries() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const gdl = useGalleryDlStatus();

  const [rows, setRows] = useState<GalleryDownload[]>([]);
  const [pasteInput, setPasteInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<Filter>("all");
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [showCookies, setShowCookies] = useState(false);
  const [showYtdl, setShowYtdl] = useState(false);
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
    // the archive shown is whatever the *saved* options resolve to (custom path / on-off)
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.galleryArchive() }),
  });

  // ── Download archive: entry count + reset ──────────────────────────────────
  const { data: archive } = useQuery({
    queryKey: qk.galleryArchive(),
    queryFn: () => api.getGalleryArchive(),
    enabled: isSeeded,
  });
  const resetArchive = async () => {
    const ok = await confirm({
      title: "Reset download archive?",
      description: `Forgets all ${archive?.entries?.toLocaleString() ?? ""} downloaded-item records, so a re-run will fetch them again. Files already on disk are not touched.`,
      confirmText: "Reset archive",
      destructive: true,
    });
    if (!ok) return;
    try {
      await api.resetGalleryArchive();
      await qc.invalidateQueries({ queryKey: qk.galleryArchive() });
    } catch (e) {
      setSubmitError(getErrorMessage(e));
    }
  };
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

  // ── File-mode URL lists ───────────────────────────────────────────────────
  const inputMode = form.watch("inputMode");
  const urlList = form.watch("urlList");
  const { data: listsData } = useQuery({
    queryKey: qk.galleryUrlLists(),
    queryFn: () => api.getGalleryUrlLists(),
    enabled: inputMode === "file",
  });
  const lists = listsData?.lists;
  const selectedExists = !!lists?.some((l) => l.name === urlList);
  // The persisted selection can point at a list that no longer exists (never created, deleted,
  // renamed elsewhere) — repoint it so a Fetch never 400s on a stale name.
  useEffect(() => {
    const first = lists?.[0];
    if (!isSeeded || !first || selectedExists) return;
    form.setValue("urlList", first.name, { shouldDirty: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lists, selectedExists, isSeeded]);
  const { data: listText } = useQuery({
    queryKey: qk.galleryUrlList(urlList),
    queryFn: () => api.getGalleryUrlList(urlList),
    enabled: inputMode === "file" && selectedExists,
  });

  const [editor, setEditor] = useState<ListEditor | null>(null);
  const [savingList, setSavingList] = useState(false);
  const editorDirty =
    !!editor &&
    (editor.isNew
      ? editor.name.trim() !== "" || editor.text.trim() !== ""
      : editor.text !== editor.initialText || editor.name.trim() !== editor.originalName);
  const patchEditor = (p: Partial<ListEditor>) => setEditor((e) => (e ? { ...e, ...p } : e));

  const openNewList = () =>
    setEditor({ isNew: true, originalName: "", name: "", text: "", initialText: "", error: null });
  const openEditList = async () => {
    if (!selectedExists) return;
    try {
      // fresh read, not the cached preview — the editor must start from what is on disk
      const res = await api.getGalleryUrlList(urlList);
      setEditor({
        isNew: false,
        originalName: urlList,
        name: urlList,
        text: res.text,
        initialText: res.text,
        error: null,
      });
    } catch (e) {
      setSubmitError(getErrorMessage(e));
    }
  };
  const closeEditor = async () => {
    if (editorDirty) {
      const discard = await confirm({
        title: "Discard changes?",
        description: "This list has unsaved changes.",
        confirmText: "Discard",
        destructive: true,
      });
      if (!discard) return;
    }
    setEditor(null);
  };
  const saveEditor = async () => {
    if (!editor) return;
    const name = editor.name.trim();
    if (editor.isNew && lists?.some((l) => l.name.toLowerCase() === name.toLowerCase())) {
      patchEditor({ error: `A list named “${name}” already exists` });
      return;
    }
    setSavingList(true);
    patchEditor({ error: null });
    try {
      let finalName = name;
      if (editor.isNew) {
        await api.putGalleryUrlList(name, editor.text);
      } else {
        await api.putGalleryUrlList(editor.originalName, editor.text);
        if (name !== editor.originalName) {
          finalName = (await api.renameGalleryUrlList(editor.originalName, name)).name;
        }
      }
      form.setValue("urlList", finalName, { shouldDirty: true });
      // prefix-invalidates the lists index and every cached list body
      await qc.invalidateQueries({ queryKey: qk.galleryUrlLists() });
      setEditor(null);
    } catch (e) {
      patchEditor({ error: getErrorMessage(e) });
    } finally {
      setSavingList(false);
    }
  };
  const deleteEditorList = async () => {
    if (!editor || editor.isNew) return;
    const ok = await confirm({
      title: "Delete URL list?",
      description: `“${editor.originalName}” will be permanently deleted.`,
      confirmText: "Delete",
      destructive: true,
    });
    if (!ok) return;
    try {
      await api.deleteGalleryUrlList(editor.originalName);
      await qc.invalidateQueries({ queryKey: qk.galleryUrlLists() });
      setEditor(null);
    } catch (e) {
      patchEditor({ error: getErrorMessage(e) });
    }
  };

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
              lists={lists}
              listName={urlList}
              onListChange={(n) => form.setValue("urlList", n, { shouldDirty: true })}
              listPreview={selectedExists ? (listText?.text ?? "") : ""}
              onEditList={() => void openEditList()}
              onNewList={openNewList}
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
              <button
                type="button"
                onClick={() => setShowYtdl(true)}
                className="flex items-center gap-1.5 rounded border border-border/50 px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:border-border hover:text-foreground"
              >
                <MonitorPlay className="h-3.5 w-3.5" />
                YouTube options
                {isSeeded && (
                  <span className="font-mono text-[10px] text-muted-foreground/50">
                    {ytdlSummary(form.watch())}
                  </span>
                )}
                <ChevronRight className="h-3 w-3 text-muted-foreground/50" />
              </button>
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
              <GalleryOptionsPanel
                form={form}
                archive={archive}
                onResetArchive={() => void resetArchive()}
              />
            ) : (
              <div className="flex justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            )}
          </div>
        </Card>
      </div>

      {isSeeded && (
        <YtdlOptionsSheet
          open={showYtdl}
          onOpenChange={setShowYtdl}
          form={form}
          impersonateTargets={gdl.impersonateTargets}
        />
      )}

      <UrlListEditorDialog
        open={editor !== null}
        isNew={editor?.isNew ?? true}
        name={editor?.name ?? ""}
        onNameChange={(name) => patchEditor({ name })}
        text={editor?.text ?? ""}
        onTextChange={(text) => patchEditor({ text })}
        saving={savingList}
        error={editor?.error ?? null}
        onSave={() => void saveEditor()}
        onDelete={() => void deleteEditorList()}
        onClose={() => void closeEditor()}
      />

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
