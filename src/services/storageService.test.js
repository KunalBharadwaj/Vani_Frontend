import { describe, it, expect, beforeEach } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import {
  initializeStorage,
  uploadFile,
  listFiles,
  getPublicUrl,
  deleteFile,
} from "./storageService";

// Swap in a fresh in-memory IndexedDB before each test. storageService opens a
// new connection on every call, so replacing the global factory fully isolates
// tests without fighting the service's un-closed connections.
beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

const textBlob = (s) => new Blob([s], { type: "text/plain" });

describe("storageService (IndexedDB)", () => {
  it("initializes the database", async () => {
    const res = await initializeStorage();
    expect(res.success).toBe(true);
  });

  it("stores a file and returns a data URL", async () => {
    const res = await uploadFile(textBlob("hello"), "greeting.txt");
    expect(res.success).toBe(true);
    expect(res.url).toMatch(/^data:/);
    expect(res.path).toBe("greeting.txt");
  });

  it("lists stored files", async () => {
    await uploadFile(textBlob("a"), "a.txt");
    await uploadFile(textBlob("b"), "b.txt");
    const res = await listFiles();
    expect(res.success).toBe(true);
    const names = res.files.map((f) => f.name).sort();
    expect(names).toEqual(["a.txt", "b.txt"]);
  });

  it("retrieves a stored file's data URL by name", async () => {
    await uploadFile(textBlob("x"), "x.txt");
    const url = await getPublicUrl("x.txt");
    expect(url).toMatch(/^data:/);
  });

  it("returns an empty string for a missing file", async () => {
    expect(await getPublicUrl("does-not-exist.txt")).toBe("");
  });

  it("deletes a file", async () => {
    await uploadFile(textBlob("z"), "z.txt");
    const del = await deleteFile("z.txt");
    expect(del.success).toBe(true);
    const res = await listFiles();
    expect(res.files.find((f) => f.name === "z.txt")).toBeUndefined();
  });
});
