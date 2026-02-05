import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_STORE = {
  shifts: [],
  points: [],
};

export async function loadStore(filePath) {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return structuredClone(DEFAULT_STORE);
    if (!Array.isArray(parsed.shifts)) parsed.shifts = [];
    if (!Array.isArray(parsed.points)) parsed.points = [];
    return parsed;
  } catch (e) {
    if (e && typeof e === "object" && "code" in e && e.code === "ENOENT") {
      return structuredClone(DEFAULT_STORE);
    }
    throw e;
  }
}

export function createSaveQueue({ filePath, getState }) {
  let saveTimer = null;
  let saving = false;
  let needsSave = false;

  async function saveNow() {
    if (saving) {
      needsSave = true;
      return;
    }
    saving = true;
    needsSave = false;
    try {
      await mkdir(path.dirname(filePath), { recursive: true });
      const tmpPath = `${filePath}.tmp`;
      await writeFile(tmpPath, JSON.stringify(getState(), null, 2), "utf8");
      await rename(tmpPath, filePath);
    } finally {
      saving = false;
      if (needsSave) void saveNow();
    }
  }

  function queueSave() {
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      void saveNow();
    }, 150);
  }

  return { queueSave, saveNow };
}

