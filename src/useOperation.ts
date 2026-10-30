import {useCallback, useEffect, useRef, useState} from 'react';
import type {Progress} from './StatusBar.js';

export function useOperation() {
  const [progress, setProgress] = useState<Progress | null>(null);
  const current = useRef<{cancelled: boolean; finish: () => void} | null>(null);
  useEffect(
    () => () => {
      if (current.current) current.current.cancelled = true;
      current.current = null;
    },
    [],
  );
  const begin = useCallback((label: string) => {
    if (current.current) return null;
    let lastUpdate = 0;
    const task = {
      cancelled: false,
      get active() {
        return current.current === task;
      },
      update(completed: number, extra: Partial<Progress> = {}) {
        if (!task.active || Date.now() - lastUpdate < 120) return false;
        lastUpdate = Date.now();
        setProgress({label, completed, ...extra, cancelling: task.cancelled});
        return true;
      },
      finish() {
        if (task.active) {
          current.current = null;
          setProgress(null);
        }
      },
    };
    current.current = task;
    setProgress({label});
    return task;
  }, []);
  const cancel = useCallback(() => {
    if (!current.current) return;
    current.current.cancelled = true;
    setProgress((previous) => previous && {...previous, cancelling: true});
  }, []);
  return {progress, current, begin, cancel};
}
