import { DEFAULT_THEME } from "@/lib/themes.generated";

/**
 * The capture tool films each landing shot once per theme: the default look keeps the plain id, the others
 * get the theme id as a suffix (`landing/beats/cleanup.rose`).
 */
export function themedId(id: string, theme: string): string {
  return theme === DEFAULT_THEME ? id : `${id}.${theme}`;
}
