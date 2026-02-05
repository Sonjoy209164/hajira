import type {
  TrackingApiClient,
  TrackingGetShiftPointsRequest,
  TrackingGetShiftPointsResponse,
  TrackingListShiftsRequest,
  TrackingListShiftsResponse,
  TrackingStartShiftRequest,
  TrackingStartShiftResponse,
  TrackingEndShiftRequest,
  TrackingEndShiftResponse,
  TrackingUploadPointsBatchRequest,
  TrackingUploadPointsBatchResponse,
} from "@hajira/tracking-core";
import { createTrackingFetchClient, getDefaultTrackingEnvConfig } from "@hajira/tracking-core";

import { logD, logE } from "./logcat";

export type { TrackingPoint, TrackingPointUpload, TrackingShiftSummary } from "@hajira/tracking-core";

let configuredClient: TrackingApiClient | null = null;
let cachedEnvClient: TrackingApiClient | null = null;

export function configureTrackingApiClient(client: TrackingApiClient | null) {
  configuredClient = client;
}

function getClientSafe(): TrackingApiClient | null {
  if (configuredClient) return configuredClient;
  if (cachedEnvClient) return cachedEnvClient;

  const env = getDefaultTrackingEnvConfig();
  if (!env?.baseUrl) return null;

  cachedEnvClient = createTrackingFetchClient({
    baseUrl: env.baseUrl,
    apiKey: env.apiKey ?? undefined,
    apiKeyHeaderName: "X-CM-API-KEY",
  });
  return cachedEnvClient;
}

export async function apiStartShift(
  params: TrackingStartShiftRequest,
): Promise<TrackingStartShiftResponse> {
  logD("TRACKING_API", "POST /tracking/shifts/start", params);
  try {
    const client = getClientSafe();
    if (!client) return { success: false, error: "Tracking API not configured" };
    return await client.startShift(params);
  } catch (e: any) {
    logE("TRACKING_API", "POST /tracking/shifts/start failed", e);
    return { success: false, error: String(e?.message ?? e ?? "Request failed") };
  }
}

export async function apiEndShift(params: TrackingEndShiftRequest): Promise<TrackingEndShiftResponse> {
  logD("TRACKING_API", "POST /tracking/shifts/end", params);
  try {
    const client = getClientSafe();
    if (!client) return { success: false, error: "Tracking API not configured" };
    return await client.endShift(params);
  } catch (e: any) {
    logE("TRACKING_API", "POST /tracking/shifts/end failed", e);
    return { success: false, error: String(e?.message ?? e ?? "Request failed") };
  }
}

export async function apiUploadBreadcrumbBatch(
  params: TrackingUploadPointsBatchRequest,
): Promise<TrackingUploadPointsBatchResponse> {
  logD("TRACKING_API", "POST /tracking/points/batch", {
    shiftId: params.shiftId,
    batchStartLocalId: params.batchStartLocalId,
    batchEndLocalId: params.batchEndLocalId,
    points: params.points.length,
  });

  try {
    const client = getClientSafe();
    if (!client) return { success: false, error: "Tracking API not configured" };
    return await client.uploadPointsBatch(params);
  } catch (e: any) {
    logE("TRACKING_API", "POST /tracking/points/batch failed", e);
    return { success: false, error: String(e?.message ?? e ?? "Request failed") };
  }
}

export async function apiGetShiftPoints(
  params: TrackingGetShiftPointsRequest,
): Promise<TrackingGetShiftPointsResponse> {
  const limit = Math.max(1, Math.min(Number(params.limit ?? 5000), 20000));
  const query = { ...params, limit };

  logD("TRACKING_API", "GET /tracking/shifts/:shiftId/points", query);
  try {
    const client = getClientSafe();
    if (!client) return { success: false, error: "Tracking API not configured" };
    return await client.getShiftPoints({ ...params, limit });
  } catch (e: any) {
    logE("TRACKING_API", "GET /tracking/shifts/:shiftId/points failed", e);
    return { success: false, error: String(e?.message ?? e ?? "Request failed") };
  }
}

export async function apiListTrackingShifts(
  params: TrackingListShiftsRequest,
): Promise<TrackingListShiftsResponse> {
  const limit = Math.max(1, Math.min(Number(params.limit ?? 200), 1000));
  const query = { ...params, limit };

  logD("TRACKING_API", "GET /tracking/shifts", query);
  try {
    const client = getClientSafe();
    if (!client) return { success: false, error: "Tracking API not configured" };
    return await client.listShifts({ ...params, limit });
  } catch (e: any) {
    logE("TRACKING_API", "GET /tracking/shifts failed", e);
    return { success: false, error: String(e?.message ?? e ?? "Request failed") };
  }
}
