import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

export type ConfirmOptions = {
  title?: string;
  description: ReactNode;
  confirmText?: string;
  cancelText?: string;
  /** Style the confirm button as destructive (red). */
  destructive?: boolean;
  /**
   * A second step for irreversible actions: renders a checkbox with this label
   * ("I'm sure") that must be ticked before the confirm button enables. It starts
   * unticked on every open.
   */
  acknowledge?: string;
};

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

/** Promise-based replacement for window.confirm(), rendered via the shadcn AlertDialog. */
export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm must be used within <ConfirmProvider>");
  return ctx;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const resolverRef = useRef<((v: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((options) => {
    setAcknowledged(false);
    setOpts(options);
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
    });
  }, []);

  const settle = (result: boolean) => {
    resolverRef.current?.(result);
    resolverRef.current = null;
    setOpts(null);
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <AlertDialog open={opts !== null} onOpenChange={(open: boolean) => !open && settle(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{opts?.title ?? "Are you sure?"}</AlertDialogTitle>
            {typeof opts?.description === "string" || opts?.description == null ? (
              <AlertDialogDescription>{opts?.description}</AlertDialogDescription>
            ) : (
              // Rich content (lists, several paragraphs) can't sit inside a <p>.
              <AlertDialogDescription asChild>
                <div>{opts.description}</div>
              </AlertDialogDescription>
            )}
          </AlertDialogHeader>
          {opts?.acknowledge && (
            <label className="flex cursor-pointer items-center gap-2 rounded-md border bg-px-surface px-3 py-2.5 text-sm transition-colors duration-100 hover:border-primary/40">
              <Checkbox
                checked={acknowledged}
                onCheckedChange={(v) => setAcknowledged(v === true)}
                aria-label={opts.acknowledge}
              />
              <span>{opts.acknowledge}</span>
            </label>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => settle(false)}>
              {opts?.cancelText ?? "Cancel"}
            </AlertDialogCancel>
            <AlertDialogAction
              className={cn(opts?.destructive && buttonVariants({ variant: "destructive" }))}
              disabled={!!opts?.acknowledge && !acknowledged}
              onClick={() => settle(true)}
            >
              {opts?.confirmText ?? "Confirm"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ConfirmContext.Provider>
  );
}
