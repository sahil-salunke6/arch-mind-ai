import { useCallback, useState } from "react";

/** Undo/redo over immutable snapshots. `replace` edits the present without a new undo step (drags, server echoes). */
export function useHistory<T>(initial: T | null) {
  const [state, setState] = useState<{ past: T[]; present: T | null; future: T[] }>({ past: [], present: initial, future: [] });

  const commit = useCallback((next: T) => {
    setState((s) => (s.present === null ? { past: [], present: next, future: [] } : { past: [...s.past, s.present].slice(-100), present: next, future: [] }));
  }, []);
  const replace = useCallback((next: T) => setState((s) => ({ ...s, present: next })), []);
  const reset = useCallback((next: T | null) => setState({ past: [], present: next, future: [] }), []);
  const undo = useCallback(() => {
    setState((s) => (s.past.length && s.present !== null
      ? { past: s.past.slice(0, -1), present: s.past[s.past.length - 1], future: [s.present, ...s.future] } : s));
  }, []);
  const redo = useCallback(() => {
    setState((s) => (s.future.length && s.present !== null
      ? { past: [...s.past, s.present], present: s.future[0], future: s.future.slice(1) } : s));
  }, []);

  return { present: state.present, commit, replace, reset, undo, redo, canUndo: state.past.length > 0, canRedo: state.future.length > 0 };
}
