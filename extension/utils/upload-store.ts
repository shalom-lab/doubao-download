import type { UploadInput } from "./github-upload";
export type UploadJob = {
  id: string; fingerprint: string; repo: string; branch: string; input: UploadInput;
  savedAt: string; status: "queued" | "running" | "failed" | "done";
  files: { path: string; key: string; uploaded: boolean }[];
  prepared: boolean; attempts: number; nextAttempt: number; message: string;
};
let connection: Promise<IDBDatabase> | undefined;
function database() {
  return connection ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("doubao-uploads", 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("jobs", { keyPath: "id" });
      request.result.createObjectStore("files");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { connection = undefined; reject(request.error); };
  });
}
async function operation<T>(store: string, mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const request = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(request.result);
    tx.onabort = () => reject(tx.error || new Error("本地任务保存失败"));
    tx.onerror = () => reject(tx.error);
  });
}
export const listJobs = () => operation("jobs", "readonly", (s) => s.getAll()) as Promise<UploadJob[]>;
export const saveJob = (job: UploadJob) => operation("jobs", "readwrite", (s) => s.put(job));
export const deleteJob = (id: string) => operation("jobs", "readwrite", (s) => s.delete(id));
export const getFile = (key: string) => operation("files", "readonly", (s) => s.get(key)) as Promise<Blob | undefined>;
export const saveFile = (key: string, blob: Blob) => operation("files", "readwrite", (s) => s.put(blob, key));
export const deleteFile = (key: string) => operation("files", "readwrite", (s) => s.delete(key));
