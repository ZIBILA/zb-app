"use client";

import { useMemo } from "react";
import { GripVertical } from "lucide-react";
import { Reorder } from "framer-motion";

type Collection = {
  id: string | number;
  handle: string;
  title: string;
};

function norm(handle: string) {
  return String(handle || "").trim().toLowerCase();
}

export function CollectionPlacementEditor({
  collections,
  value,
  onChange,
}: {
  collections: Collection[];
  value: string;
  onChange: (json: string) => void;
}) {
  const selectedHandles = useMemo(() => {
    if (!value) return [] as string[];
    if (Array.isArray(value)) return (value as unknown as string[]).map(String);
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }, [value]);

  const byHandle = useMemo(() => {
    const map = new Map<string, Collection>();
    for (const c of collections) {
      map.set(norm(c.handle), c);
    }
    return map;
  }, [collections]);

  const selected = useMemo(
    () =>
      selectedHandles
        .map((h) => byHandle.get(norm(h)))
        .filter((c): c is Collection => !!c),
    [selectedHandles, byHandle]
  );

  const selectedSet = useMemo(
    () => new Set(selected.map((c) => norm(c.handle))),
    [selected]
  );

  const available = useMemo(
    () => collections.filter((c) => !selectedSet.has(norm(c.handle))),
    [collections, selectedSet]
  );

  const commit = (next: Collection[]) => {
    onChange(JSON.stringify(next.map((c) => c.handle)));
  };

  const toggle = (collection: Collection) => {
    if (selectedSet.has(norm(collection.handle))) {
      commit(selected.filter((c) => norm(c.handle) !== norm(collection.handle)));
    } else {
      commit([...selected, collection]);
    }
  };

  return (
    <div className="space-y-3">
      {selected.length > 0 ? (
        <Reorder.Group
          axis="y"
          values={selected}
          onReorder={commit}
          className="space-y-1.5 rounded-lg border border-foreground/[0.05] bg-foreground/[0.01] p-2"
        >
          {selected.map((collection, index) => (
            <Reorder.Item
              key={collection.id}
              value={collection}
              className="flex items-center gap-3 rounded-md border border-foreground/[0.04] bg-background px-3 py-2 shadow-sm select-none"
            >
              <div className="cursor-grab active:cursor-grabbing py-1 px-0.5 text-foreground/30 hover:text-foreground/50">
                <GripVertical className="h-3.5 w-3.5" />
              </div>
              <span className="w-5 shrink-0 text-[9px] font-mono text-foreground/40">
                {index + 1}
              </span>
              <span className="min-w-0 flex-1 truncate text-[11px] font-semibold uppercase tracking-widest text-foreground">
                {collection.title}
              </span>
              <button
                type="button"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => toggle(collection)}
                className="rounded px-2 py-1 text-[10px] font-semibold text-red-500 hover:bg-red-500/5"
              >
                Remove
              </button>
            </Reorder.Item>
          ))}
        </Reorder.Group>
      ) : (
        <p className="rounded-lg border border-dashed border-foreground/[0.08] bg-foreground/[0.01] px-3 py-4 text-center text-[11px] text-foreground/45">
          No collections selected. Tap a heading below to add it.
        </p>
      )}

      {available.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {available.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => toggle(c)}
              className="rounded-md border border-foreground/[0.05] bg-background px-3 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-foreground/50 transition-colors hover:border-foreground/20"
            >
              {c.title}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
