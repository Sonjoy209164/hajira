import AsyncStorage from "@react-native-async-storage/async-storage";

import { STORAGE_DEVICE_ID_KEY } from "./trackingConstants.js";

function createPseudoUuid() {
  const rand = Math.random().toString(16).slice(2);
  const ts = Date.now().toString(16);
  return `dev_${ts}_${rand}`;
}

export async function getOrCreateDeviceId(): Promise<string> {
  const existing = await AsyncStorage.getItem(STORAGE_DEVICE_ID_KEY);
  if (existing) return existing;
  const id = createPseudoUuid();
  await AsyncStorage.setItem(STORAGE_DEVICE_ID_KEY, id);
  return id;
}
