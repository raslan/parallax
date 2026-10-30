import * as React from "react";
import { cn } from "@/lib/utils";

const Label = ({
  ref,
  className,
  ...props
}: React.LabelHTMLAttributes<HTMLLabelElement> & React.RefAttributes<HTMLLabelElement>) => (
  <label
    ref={ref}
    className={cn(
      "text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70",
      className,
    )}
    {...props}
  />
);
Label.displayName = "Label";

export { Label };
