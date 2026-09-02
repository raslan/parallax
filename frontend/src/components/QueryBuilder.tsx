import { useEffect, useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import type { Clause, FieldDef, Operator } from "@/hooks/useQueryBuilder";
import { cn } from "@/lib/utils";

const CATEGORY_COLOR: Record<string, string> = {
  numeric: "#38bdf8",
  label: "#a78bfa",
  search: "#fbbf24",
};

const CATEGORY_LABEL: Record<string, string> = {
  numeric: "File Properties",
  label: "Detection Labels",
  search: "Search",
};

const OPERATOR_LABEL: Record<Operator, string> = {
  gt: ">",
  lt: "<",
  gte: "≥",
  lte: "≤",
  eq: "=",
  contains: "contains",
  not_contains: "doesn't contain",
  fuzzy_contains: "~contains",
};

function OperatorSelect<T>({
  field,
  value,
  onChange,
}: {
  field: FieldDef<T>;
  value: Operator;
  onChange: (op: Operator) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as Operator)}
      className="rounded border border-border bg-background px-1.5 py-1 text-xs"
    >
      {field.operators.map((op) => (
        <option key={op} value={op}>
          {OPERATOR_LABEL[op]}
        </option>
      ))}
    </select>
  );
}

function PercentSlider({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex w-full min-w-[220px] flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-muted-foreground">{label}</span>
        <span className="text-xs font-mono font-semibold" style={{ color: "var(--px-accent)" }}>
          {value}%
        </span>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-primary"
      />
    </div>
  );
}

function PresetChips<T>({
  field,
  value,
  onChange,
}: {
  field: FieldDef<T>;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  if (!field.presets) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {field.presets.map((p) => (
        <button
          key={p.label}
          type="button"
          onClick={() => onChange(p.value)}
          className={cn(
            "rounded px-2 py-0.5 text-[11px] font-medium transition-colors border",
            value === p.value
              ? "border-primary bg-primary/15 text-primary"
              : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground",
          )}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}

function ValueEditor<T>({
  field,
  operator,
  value,
  onChange,
}: {
  field: FieldDef<T>;
  operator: Operator;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  if (field.valueType === "number") {
    return (
      <div className="flex flex-col gap-1.5">
        <PresetChips field={field} value={value} onChange={onChange} />
        <input
          type="number"
          value={(value as number) ?? ""}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-20 rounded border border-border bg-background px-1.5 py-1 text-xs"
        />
      </div>
    );
  }
  if (field.valueType === "percent") {
    return <PercentSlider label="Threshold" value={(value as number) ?? 0} onChange={onChange} />;
  }
  if (field.valueType === "date_offset") {
    const v = (value as { n: number; unit: "days" | "weeks" | "months" }) ?? {
      n: 30,
      unit: "days",
    };
    return (
      <div className="flex items-center gap-1">
        <input
          type="number"
          value={v.n}
          onChange={(e) => onChange({ ...v, n: Number(e.target.value) })}
          className="w-14 rounded border border-border bg-background px-1.5 py-1 text-xs"
        />
        <select
          value={v.unit}
          onChange={(e) => onChange({ ...v, unit: e.target.value })}
          className="rounded border border-border bg-background px-1.5 py-1 text-xs"
        >
          <option value="days">days</option>
          <option value="weeks">weeks</option>
          <option value="months">months</option>
        </select>
      </div>
    );
  }
  // "text"
  const v = (value as { text: string; threshold?: number }) ?? { text: "" };
  return (
    <div className="flex flex-col gap-2">
      <input
        type="text"
        value={v.text}
        onChange={(e) => onChange({ ...v, text: e.target.value })}
        className="w-full rounded border border-border bg-background px-1.5 py-1 text-xs"
      />
      {(operator === "fuzzy_contains" || field.showThreshold) && (
        <PercentSlider
          label="Similarity"
          value={v.threshold ?? 40}
          onChange={(threshold) => onChange({ ...v, threshold })}
        />
      )}
    </div>
  );
}

function formatValue<T>(field: FieldDef<T>, operator: Operator, value: unknown): string {
  if (field.valueType === "number") return String(value);
  if (field.valueType === "percent") return `${value}%`;
  if (field.valueType === "date_offset") {
    const v = value as { n: number; unit: string };
    return `${v.n} ${v.unit}`;
  }
  const v = value as { text: string; threshold?: number };
  return operator === "fuzzy_contains" ? `"${v.text}" ~${v.threshold ?? 40}%` : `"${v.text}"`;
}

function ExpandedClause<T>({
  field,
  clause,
  onUpdate,
  onCollapse,
}: {
  field: FieldDef<T>;
  clause: Clause;
  onUpdate: (id: string, patch: Partial<Clause>) => void;
  onCollapse: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onCollapse();
      }
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" || e.key === "Enter") {
        onCollapse();
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onCollapse]);

  return (
    <div
      ref={ref}
      className="flex min-w-[240px] flex-col gap-2.5 rounded-md border-2 p-3"
      style={{
        borderColor: "var(--px-accent)",
        boxShadow: "0 0 0 4px var(--px-accent-dim, rgba(139,92,246,0.16))",
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold">{field.label}</span>
        <div className="flex items-center gap-1.5">
          <OperatorSelect
            field={field}
            value={clause.operator}
            onChange={(op) => onUpdate(clause.id, { operator: op })}
          />
          <button
            type="button"
            onClick={() => onCollapse()}
            className="rounded px-2 py-1 text-xs font-semibold text-primary-foreground"
            style={{ background: "var(--px-accent)" }}
          >
            Done
          </button>
        </div>
      </div>
      <ValueEditor
        field={field}
        operator={clause.operator}
        value={clause.value}
        onChange={(v) => onUpdate(clause.id, { value: v })}
      />
    </div>
  );
}

function JoinerSwitch({ value, onToggle }: { value: "AND" | "OR"; onToggle: () => void }) {
  const isOr = value === "OR";
  return (
    <button
      type="button"
      onClick={onToggle}
      className="relative flex h-[34px] w-[88px] shrink-0 items-center rounded-full border border-border p-[3px]"
      style={{
        background: "var(--px-bg-elevated, #1e1e24)",
      }}
    >
      <span
        className="absolute top-[3px] h-[26px] w-[41px] rounded-full transition-all"
        style={{
          left: isOr ? "44px" : "3px",
          background: isOr ? "#fbbf24" : "var(--px-accent)",
        }}
      />
      <span
        className="relative z-10 flex-1 text-center text-[11px] font-bold"
        style={{ color: isOr ? undefined : "#0a0a0f" }}
      >
        AND
      </span>
      <span
        className="relative z-10 flex-1 text-center text-[11px] font-bold"
        style={{ color: isOr ? "#0a0a0f" : undefined }}
      >
        OR
      </span>
    </button>
  );
}

export function QueryBuilder<T>({
  registry,
  clauses,
  fieldsByKey,
  onAdd,
  onRemove,
  onUpdate,
}: {
  registry: FieldDef<T>[];
  clauses: Clause[];
  fieldsByKey: Record<string, FieldDef<T>>;
  onAdd: (fieldKey: string) => string | null;
  onRemove: (id: string) => void;
  onUpdate: (id: string, patch: Partial<Clause>) => void;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuFilter, setMenuFilter] = useState("");
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [menuOpen]);

  const sectionColor: Record<string, string> = {};
  const grouped = registry.reduce<Record<string, FieldDef<T>[]>>((acc, f) => {
    if (menuFilter && !f.label.toLowerCase().includes(menuFilter.toLowerCase())) return acc;
    const section = f.group ?? CATEGORY_LABEL[f.category] ?? f.category;
    sectionColor[section] = CATEGORY_COLOR[f.category];
    (acc[section] ??= []).push(f);
    return acc;
  }, {});

  function handleAdd(fieldKey: string) {
    const newId = onAdd(fieldKey);
    setMenuOpen(false);
    setMenuFilter("");
    setExpandedId(newId);
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      {clauses.map((clause, i) => {
        const field = fieldsByKey[clause.fieldKey];
        if (!field) return null;
        const isExpanded = expandedId === clause.id;
        return (
          <div key={clause.id} className="flex items-center gap-3">
            {isExpanded ? (
              <ExpandedClause
                field={field}
                clause={clause}
                onUpdate={onUpdate}
                onCollapse={() => setExpandedId(null)}
              />
            ) : (
              <div
                onClick={() => setExpandedId(clause.id)}
                className="flex cursor-pointer items-stretch overflow-hidden rounded-md border text-sm"
                style={{ borderLeft: `3px solid ${CATEGORY_COLOR[field.category]}` }}
              >
                <span className="px-3 py-2 font-semibold">{field.label}</span>
                <span className="border-l px-3 py-2 text-muted-foreground">
                  {OPERATOR_LABEL[clause.operator]}
                </span>
                <span className="border-l px-3 py-2 font-mono">
                  {formatValue(field, clause.operator, clause.value)}
                </span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemove(clause.id);
                  }}
                  className="flex w-9 items-center justify-center border-l text-muted-foreground hover:bg-destructive/20 hover:text-destructive"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
            {i < clauses.length - 1 && (
              <JoinerSwitch
                value={clause.joinToNext}
                onToggle={() =>
                  onUpdate(clause.id, { joinToNext: clause.joinToNext === "AND" ? "OR" : "AND" })
                }
              />
            )}
          </div>
        );
      })}

      <div className="relative" ref={menuRef}>
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          className="flex items-center gap-1.5 rounded-md border border-dashed border-border px-3 py-2 text-sm text-muted-foreground hover:border-solid"
        >
          <Plus className="h-3.5 w-3.5" />
          Add filter
        </button>
        {menuOpen && (
          <div
            className="absolute top-full z-20 mt-2 w-[560px] max-w-[90vw] rounded-lg border border-border shadow-2xl"
            style={{ background: "var(--px-bg-elevated, #1e1e24)" }}
          >
            <div className="border-b border-border p-3.5">
              <input
                autoFocus
                type="text"
                placeholder="Search fields…"
                value={menuFilter}
                onChange={(e) => setMenuFilter(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-3 py-2.5 text-sm"
              />
            </div>
            <div className="max-h-[380px] overflow-y-auto p-3.5">
              {Object.entries(grouped).map(([section, fields], idx) => (
                <div key={section} className={idx > 0 ? "mt-4" : undefined}>
                  <div className="mb-2 flex items-center gap-2">
                    <span
                      className="h-2 w-2 rounded-sm"
                      style={{ background: sectionColor[section] }}
                    />
                    <span className="text-[11px] font-extrabold uppercase tracking-wide text-muted-foreground">
                      {section}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {fields.map((f) => (
                      <div
                        key={f.key}
                        onClick={() => handleAdd(f.key)}
                        className="flex cursor-pointer items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-2 text-xs font-semibold transition-all hover:-translate-y-px hover:border-primary hover:text-primary"
                        style={{ background: "var(--px-bg-surface, transparent)" }}
                      >
                        <span
                          className="h-1.5 w-1.5 shrink-0 rounded-full"
                          style={{ background: CATEGORY_COLOR[f.category] }}
                        />
                        <span className="truncate">{f.label}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
