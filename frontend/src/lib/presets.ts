export const PRESETS = [
  { value: "high", label: "High", shortLabel: "H", title: "High quality (CRF 18)" },
  { value: "medium", label: "Medium", shortLabel: "M", title: "Medium quality (CRF 23)" },
  { value: "low", label: "Low", shortLabel: "L", title: "Low quality (CRF 28)" },
] as const;

export type Preset = typeof PRESETS[number]["value"];
