import { Children, type ReactNode } from "react";
import { useDefaultLayout } from "react-resizable-panels";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { useMediaQuery } from "@/hooks/useMediaQuery";

/**
 * Main column + a settings column. From `lg` up the divider is draggable and the
 * split is remembered (per `id`); below `lg` the two stack, as before.
 * Pass exactly two children: the main content, then the side panel.
 */
export function TwoColumnShell({
  id,
  children,
  sideDefaultPx = 300,
}: {
  id: string;
  children: ReactNode;
  sideDefaultPx?: number;
}) {
  const wide = useMediaQuery("(min-width: 1024px)");
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({ id });
  const [main, side] = Children.toArray(children);

  if (!wide) {
    return <div className="grid grid-cols-1 items-start gap-6">{children}</div>;
  }
  return (
    <ResizablePanelGroup
      id={id}
      orientation="horizontal"
      defaultLayout={defaultLayout}
      onLayoutChanged={onLayoutChanged}
    >
      <ResizablePanel id="main" minSize={400}>
        <div className="min-w-0 pr-2">{main}</div>
      </ResizablePanel>
      <ResizableHandle />
      <ResizablePanel id="side" defaultSize={sideDefaultPx} minSize={260} maxSize={560}>
        <div className="pl-2">{side}</div>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
