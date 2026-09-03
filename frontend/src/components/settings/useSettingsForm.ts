import { useEffect } from "react";
import { useForm, type DefaultValues, type FieldValues } from "react-hook-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ZodType } from "zod";
import { api, qk } from "@/lib/api";
import { zodResolver } from "@/lib/zodResolver";
import type { Settings, UpdateSettingsBody } from "@/types/settings";
import type { SaveState } from "./SaveButton";

/**
 * One Settings tab's form. Owns its own `qk.settings()` read (react-query
 * dedupes across tabs), seeds the form from it via `form.reset` — rhf's
 * sanctioned fetch→form sync, no `setState`-in-effect — and PATCHes only this
 * tab's slice of the settings body on submit. `formState.isDirty` drives Save.
 */
export function useSettingsForm<T extends FieldValues>(
  schema: ZodType<T>,
  seed: (s: Settings) => T,
  toBody: (v: T) => UpdateSettingsBody,
) {
  const qc = useQueryClient();
  const { data: settings, isLoading } = useQuery({
    queryKey: qk.settings(),
    queryFn: () => api.getSettings(),
  });

  const form = useForm<T>({
    resolver: zodResolver(schema),
    defaultValues: {} as DefaultValues<T>,
  });

  useEffect(() => {
    if (settings) form.reset(seed(settings));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings]);

  const mutation = useMutation({
    mutationFn: (v: T) => api.updateSettings(toBody(v)),
    onSuccess: (_res, v) => {
      qc.invalidateQueries({ queryKey: qk.settings() });
      form.reset(v);
    },
  });

  const save: SaveState = {
    saving: mutation.isPending,
    saved: mutation.isSuccess && !form.formState.isDirty,
    dirty: form.formState.isDirty,
    onSave: form.handleSubmit((v) => mutation.mutate(v)),
  };

  return { form, settings, isLoading, save };
}
