import type { FieldErrors, FieldValues, Resolver } from "react-hook-form";
import type { ZodType } from "zod";

/**
 * Minimal zod → react-hook-form resolver. `@hookform/resolvers@3` reads
 * `err.errors`, which zod 4 renamed to `err.issues`, and `@hookform/resolvers@5`
 * drags in `@typeschema` with a hard zod-3 peer — neither works here. All forms
 * in this app are flat (no nested field objects), so mapping `issue.path[0]` to
 * a single `{ type, message }` per field is all we need.
 *
 * ponytail: flat-form only. If a nested form appears, join `issue.path` with "."
 * and nest, or reach for a real resolver package that supports zod 4.
 */
export function zodResolver<T extends FieldValues>(schema: ZodType<T>): Resolver<T> {
  return async (values) => {
    const result = schema.safeParse(values);
    if (result.success) return { values: result.data, errors: {} };

    const errors: Record<string, { type: string; message: string }> = {};
    for (const issue of result.error.issues) {
      const key = issue.path[0];
      if (typeof key === "string" && !errors[key]) {
        errors[key] = { type: issue.code, message: issue.message };
      }
    }
    return { values: {}, errors: errors as FieldErrors<T> };
  };
}
