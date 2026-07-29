import * as Location from "expo-location";

export type GpsFixOptions = {
  attempts?: number;
  timeoutMs?: number;
  accuracy?: number;
  maximumAgeMs?: number;
  requiredAccuracyM?: number;
  allowLastKnown?: boolean;
  rejectMocked?: boolean;
  onFix?: (fix: Location.LocationObject, attempt: number) => void | Promise<void>;
};

export type GpsFixResult =
  | { success: true; fix: Location.LocationObject; source: "fresh" | "last-known"; attempts: number }
  | { success: false; reason: "SERVICES_DISABLED" | "MOCKED" | "UNAVAILABLE"; attempts: number };

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Location request timed out")), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function acceptable(fix: Location.LocationObject | null, options: GpsFixOptions): boolean {
  if (!fix) return false;
  if (options.rejectMocked !== false && fix.mocked === true) return false;
  const required = options.requiredAccuracyM;
  return required == null || (fix.coords.accuracy != null && fix.coords.accuracy <= required);
}

export async function acquireGpsFix(options: GpsFixOptions = {}): Promise<GpsFixResult> {
  const attempts = Math.max(1, Math.min(options.attempts ?? 3, 10));
  const timeoutMs = Math.max(1_000, options.timeoutMs ?? 12_000);
  const servicesEnabled = await Location.hasServicesEnabledAsync().catch(() => false);
  if (!servicesEnabled) return { success: false, reason: "SERVICES_DISABLED", attempts: 0 };

  let sawMocked = false;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const fix = await withTimeout(
      Location.getCurrentPositionAsync({
        accuracy: options.accuracy ?? Location.Accuracy.High,
      }),
      timeoutMs,
    ).catch(() => null);
    if (fix?.mocked === true) sawMocked = true;
    if (!acceptable(fix, options)) continue;
    await options.onFix?.(fix!, attempt);
    return { success: true, fix: fix!, source: "fresh", attempts: attempt };
  }

  if (options.allowLastKnown !== false) {
    const fix = await Location.getLastKnownPositionAsync({
      maxAge: options.maximumAgeMs ?? 2 * 60_000,
      requiredAccuracy: options.requiredAccuracyM,
    }).catch(() => null);
    if (fix?.mocked === true) sawMocked = true;
    if (acceptable(fix, options)) {
      await options.onFix?.(fix!, attempts);
      return { success: true, fix: fix!, source: "last-known", attempts };
    }
  }

  return { success: false, reason: sawMocked ? "MOCKED" : "UNAVAILABLE", attempts };
}
