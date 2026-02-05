import AsyncStorage from "@react-native-async-storage/async-storage";
import type { LocationObject } from "expo-location";

/**
 * NOTE:
 * You already have a SQLite-backed queue in trackingDb (getPendingBatch/markAckedAndPrune).
 * Keep this file ONLY if you want a lightweight AsyncStorage queue for quick foreground tests.
 * It does NOT replace your SQLite queue unless you wire it in.
 */

const QUEUE_KEY_PREFIX = "tracking_point_queue_v1:";

export type QueuedPoint = {
  ts: number;
  latitude: number;
  longitude: number;
  accuracyM: number | null;
  speedMps: number | null;
  bearingDeg: number | null;
  isMock: boolean;
};

function key(shiftId?: string) {
  return `${QUEUE_KEY_PREFIX}${shiftId ?? "global"}`;
}

export async function enqueueTrackingPoint(location: LocationObject, shiftId?: string) {
  const coords = location.coords;

  const point: QueuedPoint = {
    ts: (location as any).timestamp ?? Date.now(),
    latitude: coords.latitude,
    longitude: coords.longitude,
    accuracyM: coords.accuracy ?? null,
    speedMps: coords.speed ?? null,
    bearingDeg: coords.heading ?? null,
    isMock: Boolean((location as any).mocked),
  };

  const raw = await AsyncStorage.getItem(key(shiftId));
  const list: QueuedPoint[] = raw ? JSON.parse(raw) : [];
  list.push(point);

  await AsyncStorage.setItem(key(shiftId), JSON.stringify(list));
}

export async function readQueuedPoints(shiftId?: string): Promise<QueuedPoint[]> {
  const raw = await AsyncStorage.getItem(key(shiftId));
  return raw ? JSON.parse(raw) : [];
}

export async function clearQueuedPoints(shiftId?: string) {
  await AsyncStorage.removeItem(key(shiftId));
}

