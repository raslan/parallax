import { Toaster as Sonner } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

export function Toaster({ ...props }: ToasterProps) {
  return <Sonner theme="dark" richColors position="bottom-right" {...props} />;
}
