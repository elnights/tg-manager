import {useEffect, useRef, useState} from 'react';
import type {Progress} from './StatusBar.js';

export function useOperation() {
  const [progress, setProgress] = useState<Progress | null>(null);
  const current = useRef<{cancelled: boolean; finish: () => void} | null>(null);
  useEffect(() => () => {if (current.current) current.current.cancelled = true; current.current = null;}, []);
  function begin(label: string) {
    if (current.current) return null;
    let lastUpdate = 0;
    const task = {
      cancelled: false,
      update(completed: number, extra: Partial<Progress> = {}) {
        if (current.current !== task || task.cancelled || Date.now() - lastUpdate < 120) return false;
        lastUpdate = Date.now();
        setProgress({label, completed, ...extra});
        return true;
      },
      finish() {if (current.current === task) {current.current = null; setProgress(null);}},
    };
    current.current = task;
    setProgress({label});
    return task;
  }
  function cancel() {
    if (!current.current) return;
    current.current.cancelled = true;
    setProgress(previous => previous && {...previous, cancelling: true});
  }
  return {progress, current, begin, cancel};
}
