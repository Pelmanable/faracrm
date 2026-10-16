/**
 * Скрытие шапки приложения (AppShell.Header в ModernLayout) страницей:
 * пока страница просит, шапка свёрнута, а основная область поднимается на
 * её место. Так открытый чат на телефоне занимает весь экран.
 */
import { useEffect, useSyncExternalStore } from 'react';

let hidden = false;
const listeners = new Set<() => void>();

function setHidden(next: boolean) {
  hidden = next;
  listeners.forEach(listener => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** ModernLayout: свёрнута ли шапка. */
export function useLayoutHeaderHidden(): boolean {
  return useSyncExternalStore(subscribe, () => hidden);
}

/** Страница: свернуть шапку, пока `hide` истинно и страница смонтирована. */
export function useHideLayoutHeader(hide: boolean): void {
  useEffect(() => {
    if (!hide) return;
    setHidden(true);
    return () => setHidden(false);
  }, [hide]);
}
