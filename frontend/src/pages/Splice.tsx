import { Combine } from "lucide-react";
import { MergeTab } from "@/components/splice/MergeTab";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export function Splice() {
  return (
    <div className="p-4 md:p-8 h-full flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Splice</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Join videos into one file. More splice tools will land here as tabs.
        </p>
      </div>
      <Tabs defaultValue="merge" className="flex-1 min-h-0 flex flex-col">
        <TabsList className="self-start">
          <TabsTrigger value="merge">
            <Combine className="h-3.5 w-3.5 mr-1.5" />
            Merge
          </TabsTrigger>
        </TabsList>
        <TabsContent
          value="merge"
          forceMount
          className="flex-1 min-h-0 data-[state=inactive]:hidden"
        >
          <MergeTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
