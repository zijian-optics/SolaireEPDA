/**
 * Command pattern: undo / redo stacks for graph operations (mind map shortcuts).
 */
import { create } from "zustand";

export type UndoRedoFrame = {
  undo: () => Promise<void>;
  redo: () => Promise<void>;
};

type GraphUndoState = {
  undoStack: UndoRedoFrame[];
  redoStack: UndoRedoFrame[];
  pushFrame: (f: UndoRedoFrame) => void;
  clear: () => void;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
};

export const useGraphUndoStore = create<GraphUndoState>((set, get) => ({
  undoStack: [],
  redoStack: [],
  pushFrame: (f) =>
    set(() => ({
      undoStack: [...get().undoStack, f],
      redoStack: [],
    })),
  clear: () => set({ undoStack: [], redoStack: [] }),
  undo: async () => {
    const { undoStack, redoStack } = get();
    if (undoStack.length === 0) return;
    const f = undoStack[undoStack.length - 1];
    await f.undo();
    set({
      undoStack: undoStack.slice(0, -1),
      redoStack: [f, ...redoStack],
    });
  },
  redo: async () => {
    const { undoStack, redoStack } = get();
    if (redoStack.length === 0) return;
    const f = redoStack[0];
    await f.redo();
    set({
      redoStack: redoStack.slice(1),
      undoStack: [...undoStack, f],
    });
  },
}));
