import AsyncStorage from "@react-native-async-storage/async-storage";

export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

export type LogEntry = {
  id: string;
  ts: number;
  level: LogLevel;
  tag: string;
  msg: string;
};

const ENABLE_LOGCAT = true; // Temporary debugging aid; safe to remove later.
const STORAGE_KEY = "debug.logcat.v1";
const MAX_ENTRIES = 1500;

let entries: LogEntry[] = [];
let loaded = false;
let loadingPromise: Promise<void> | null = null;
let lastPersistAt = 0;
let persistTimer: any = null;

type Subscriber = (next: LogEntry[]) => void;
const subs = new Set<Subscriber>();

function nowId() {
  // Unique enough for debugging UI; keeps ordering stable.
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function safeStringify(v: any): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function formatMessage(msg: string, data?: any) {
  if (data === undefined) return msg;
  const suffix = typeof data === "string" ? data : safeStringify(data);
  return `${msg} ${suffix}`;
}

async function ensureLoaded() {
  if (!ENABLE_LOGCAT) return;
  if (loaded) return;
  if (!loadingPromise) {
    loadingPromise = (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) entries = parsed as LogEntry[];
        }
      } catch {
        // ignore
      } finally {
        loaded = true;
      }
    })();
  }
  await loadingPromise;
}

function notify() {
  for (const fn of subs) fn(entries);
}

async function persistSoon() {
  if (!ENABLE_LOGCAT) return;
  const now = Date.now();
  // Throttle persistence to avoid hammering AsyncStorage during frequent location updates.
  if (now - lastPersistAt < 2_000) {
    if (persistTimer) return;
    persistTimer = setTimeout(() => {
      persistTimer = null;
      persistSoon().catch(() => null);
    }, 2_000);
    return;
  }
  lastPersistAt = now;
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // ignore
  }
}

export async function getLogcatEntries(): Promise<LogEntry[]> {
  await ensureLoaded();
  return entries;
}

export function subscribeLogcat(fn: Subscriber) {
  subs.add(fn);
  // fire immediately with current state (may be empty until loaded)
  fn(entries);
  return () => subs.delete(fn);
}

export async function clearLogcat() {
  if (!ENABLE_LOGCAT) return;
  entries = [];
  notify();
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function logcat(level: LogLevel, tag: string, msg: string, data?: any) {
  if (!ENABLE_LOGCAT) return;

  const entry: LogEntry = {
    id: nowId(),
    ts: Date.now(),
    level,
    tag,
    msg: formatMessage(msg, data),
  };

  entries = [...entries, entry].slice(-MAX_ENTRIES);
  notify();
  persistSoon().catch(() => null);
}

export const logD = (tag: string, msg: string, data?: any) => logcat("DEBUG", tag, msg, data);
export const logI = (tag: string, msg: string, data?: any) => logcat("INFO", tag, msg, data);
export const logW = (tag: string, msg: string, data?: any) => logcat("WARN", tag, msg, data);
export const logE = (tag: string, msg: string, data?: any) => logcat("ERROR", tag, msg, data);

