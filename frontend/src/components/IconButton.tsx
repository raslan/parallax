import type { ButtonHTMLAttributes } from "react";
import { Tip } from "@/components/Tip";

/**
 * A plain `<button>` for an icon-only control: `label` becomes both the
 * accessible name and a themed tooltip (shown on hover and keyboard focus),
 * replacing the native `title` attribute. Style it with `className` as usual.
 */
export function IconButton({
  label,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <Tip label={label}>
      <button type={type} aria-label={label} {...props} />
    </Tip>
  );
}
