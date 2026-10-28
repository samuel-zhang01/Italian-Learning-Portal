import type { Progress } from "./types.ts";

export type ProfileBase = { username: string; revision: number; progress: Progress };
export type ProfileRecovery = { date: string; username: string; local: Progress; remote?: Progress };
export interface ProfileStore {
  base(username: string): Promise<ProfileBase | undefined>;
  saveBase(value: ProfileBase): Promise<void>;
  recover(value: ProfileRecovery): Promise<void>;
  recovery(): Promise<ProfileRecovery | undefined>;
  clear(username: string): Promise<void>;
}

// A separate IndexedDB snapshot avoids doubling the existing localStorage
// record. Neither the PIN nor the opaque session cookie is stored here.
export function browserProfileStore(): ProfileStore {
  const access = <T,>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> => new Promise((resolve, reject) => {
    const open = indexedDB.open("parliamo-profile-sync-v1", 1);
    open.onupgradeneeded = () => open.result.createObjectStore("state");
    open.onerror = () => reject(new Error("device-storage"));
    open.onblocked = () => reject(new Error("device-storage"));
    open.onsuccess = () => {
      const db = open.result;
      const transaction = db.transaction("state", mode);
      const request = action(transaction.objectStore("state"));
      transaction.oncomplete = () => { const value = request.result; db.close(); resolve(value); };
      transaction.onerror = transaction.onabort = () => { db.close(); reject(new Error("device-storage")); };
    };
  });
  return {
    base: (username) => access("readonly", store => store.get(`base:${username.toLowerCase()}`)),
    saveBase: async (value) => { await access("readwrite", store => store.put(value, `base:${value.username.toLowerCase()}`)); },
    recover: async (value) => { await access("readwrite", store => store.put(value, "recovery")); },
    recovery: () => access("readonly", store => store.get("recovery")),
    clear: async (username) => { await access("readwrite", store => store.delete(`base:${username.toLowerCase()}`)); },
  };
}
