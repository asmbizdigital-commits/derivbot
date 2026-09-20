import type { CopyEngine } from "./engine";
import * as fileStore from "./file-store";
import { mysqlOptions, mysqlStore } from "./mysql-store";

function provider() {
  const value = process.env.COPYTRADING_STORAGE || "file";
  if (value !== "file" && value !== "mysql") throw new Error("COPYTRADING_STORAGE doit être file ou mysql");
  return value;
}

export function copyStorageInfo() {
  if (provider() === "file") return { provider: "file", ...fileStore.copyStorageInfo() };
  let configured = true;
  try { mysqlOptions(); } catch { configured = false; }
  return { provider: "mysql", configured, persistent: configured };
}

export async function copyTransaction<T>(operation: (engine: CopyEngine) => T): Promise<T> {
  if (provider() === "mysql") return mysqlStore().transaction(operation);
  return fileStore.copyTransaction(operation);
}

export async function copySnapshot() {
  if (provider() === "mysql") return mysqlStore().snapshot();
  return fileStore.copySnapshot();
}
