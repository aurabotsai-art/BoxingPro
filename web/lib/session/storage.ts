/**
 * On-device persistence: summary history + PB in localStorage, session
 * keypoint archives in IndexedDB (localStorage is too small — a 30-min
 * archive is ~18MB). All best-effort: private mode / quota errors never
 * break the session flow.
 */

import type { Summary } from "./model";

export const STANCE_KEY = "boxingpro.stance.v1";
export const SOUND_KEY = "boxingpro.sound.v1";
export const PB_KEY = "boxingpro.pb.v1";
export const ONBOARDED_KEY = "boxingpro.onboarded.v1";
const HISTORY_KEY = "boxingpro.sessions.v1";

const IDB_NAME = "boxingpro";
const IDB_STORE = "archives";
export const IDB_KEEP = 5;

function idbOpen(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(IDB_STORE)) {
        req.result.createObjectStore(IDB_STORE, { keyPath: "at" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function idbSaveArchive(at: number, archive: string): Promise<void> {
  const db = await idbOpen();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).put({ at, archive });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  // Prune oldest beyond the keep limit.
  const keys = await new Promise<IDBValidKey[]>((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readonly");
    const req = tx.objectStore(IDB_STORE).getAllKeys();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const excess = (keys as number[])
    .sort((a, b) => a - b)
    .slice(0, Math.max(0, keys.length - IDB_KEEP));
  if (excess.length) {
    await new Promise<void>((resolve) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      for (const k of excess) tx.objectStore(IDB_STORE).delete(k);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  }
  db.close();
}

export async function idbArchiveKeys(): Promise<number[]> {
  const db = await idbOpen();
  const keys = await new Promise<IDBValidKey[]>((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readonly");
    const req = tx.objectStore(IDB_STORE).getAllKeys();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return (keys as number[]).sort((a, b) => b - a);
}

export async function idbGetArchive(at: number): Promise<string | null> {
  const db = await idbOpen();
  const rec = await new Promise<{ archive?: string } | undefined>((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readonly");
    const req = tx.objectStore(IDB_STORE).get(at);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return rec?.archive ?? null;
}

export function loadPb(): number | null {
  try {
    const v = Number(localStorage.getItem(PB_KEY));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

export function loadHistory(): Summary[] {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]") as Summary[];
  } catch {
    return [];
  }
}

export function saveToHistory(s: Summary): Summary[] {
  const all = [s, ...loadHistory()].slice(0, 20);
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(all));
  } catch { /* quota/private mode: history is best-effort */ }
  return all;
}
