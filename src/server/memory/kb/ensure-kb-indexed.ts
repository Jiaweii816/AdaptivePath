import type { FtsStore } from "@/server/memory/store/fts-store";
import { buildKbDocuments } from "./kb-catalog";

const indexedStores = new WeakSet<FtsStore>();

export function ensureKbIndexed(ftsStore: FtsStore) {
  if (indexedStores.has(ftsStore)) {
    return;
  }

  for (const doc of buildKbDocuments()) {
    ftsStore.indexMemoryDocument({
      kind: "kb",
      refId: doc.refId,
      content: doc.content,
    });
  }

  indexedStores.add(ftsStore);
}
