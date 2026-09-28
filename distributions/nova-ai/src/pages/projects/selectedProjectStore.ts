import { useSyncExternalStore } from 'react';

const STORAGE_KEY = 'nova-ai.selectedProject';

const readStoredProject = (): string => {
  try {
    return sessionStorage.getItem(STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
};

let current = readStoredProject();
const listeners = new Set<() => void>();

export const getSelectedProject = (): string => current;

export const setSelectedProject = (name: string): void => {
  if (current === name) {
    return;
  }
  current = name;
  try {
    if (name) {
      sessionStorage.setItem(STORAGE_KEY, name);
    } else {
      sessionStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // Session storage can be unavailable. The in-memory value still applies.
  }
  listeners.forEach((listener) => listener());
};

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const useSelectedProject = (): string =>
  useSyncExternalStore(subscribe, getSelectedProject, getSelectedProject);
