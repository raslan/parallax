import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import type { VideoFile } from "@/types/file";
import type { SplicePreflightFile } from "@/types/splice";
import { MergeOrderRow } from "./MergeOrderRow";

export function MergeOrderList({
  files,
  info,
  referenceId,
  showReferencePick,
  onReorder,
  onRemove,
  onPickReference,
}: {
  files: VideoFile[];
  info: Map<number, SplicePreflightFile>;
  referenceId: number | null;
  showReferencePick: boolean;
  onReorder: (from: number, to: number) => void;
  onRemove: (id: number) => void;
  onPickReference: (id: number) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = files.findIndex((f) => f.id === active.id);
    const to = files.findIndex((f) => f.id === over.id);
    if (from >= 0 && to >= 0) onReorder(from, to);
  }

  return (
    <div className="max-h-80 shrink-0 overflow-y-auto rounded-md border border-border">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={files.map((f) => f.id)} strategy={verticalListSortingStrategy}>
          {files.map((f, i) => (
            <MergeOrderRow
              key={f.id}
              file={f}
              position={i + 1}
              info={info.get(f.id)}
              isReference={f.id === referenceId}
              showReferencePick={showReferencePick}
              onRemove={() => onRemove(f.id)}
              onPickReference={() => onPickReference(f.id)}
            />
          ))}
        </SortableContext>
      </DndContext>
    </div>
  );
}
