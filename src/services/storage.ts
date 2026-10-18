import type { Note } from "../../shared/note";
const dbName = "paper-commons-v1";
async function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("records");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function getRecord<T>(key: string): Promise<T | undefined> {
  const database = await db();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction("records", "readonly");
    const request = transaction.objectStore("records").get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => database.close();
  });
}
export async function setRecord(key: string, value: unknown): Promise<void> {
  const database = await db();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction("records", "readwrite");
    transaction
      .objectStore("records")
      .put(JSON.parse(JSON.stringify(value)), key);
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => reject(transaction.error);
  });
}
export async function removeRecord(key: string): Promise<void> {
  const database = await db();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction("records", "readwrite");
    transaction.objectStore("records").delete(key);
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => reject(transaction.error);
  });
}
export async function localNotes(): Promise<Note[]> {
  return (await getRecord<Note[]>("local-notes")) ?? [];
}
export async function saveLocalNote(note: Note) {
  const notes = await localNotes();
  await setRecord("local-notes", [
    note,
    ...notes.filter((n) => n.id !== note.id),
  ]);
}
export async function removeLocalNote(id: string) {
  await setRecord(
    "local-notes",
    (await localNotes()).filter((n) => n.id !== id),
  );
}
