import * as React from "react";
import { DayPicker } from "react-day-picker";
import "react-day-picker/style.css";

import { cn } from "@/lib/utils";

/**
 * react-day-picker with its stock stylesheet, re-coloured from the theme tokens
 * (`--px-accent*`) so the calendar follows whichever theme is active.
 */
function Calendar({ className, style, ...props }: React.ComponentProps<typeof DayPicker>) {
  return (
    <DayPicker
      showOutsideDays
      className={cn("p-2 text-sm", className)}
      style={
        {
          "--rdp-accent-color": "var(--px-accent)",
          "--rdp-accent-background-color": "var(--px-accent-dim)",
          "--rdp-day-height": "34px",
          "--rdp-day-width": "34px",
          "--rdp-day_button-height": "32px",
          "--rdp-day_button-width": "32px",
          "--rdp-day_button-border-radius": "var(--radius)",
          ...style,
        } as React.CSSProperties
      }
      {...props}
    />
  );
}

export { Calendar };
