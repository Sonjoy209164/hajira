import type {
  TrackingApiClient,
  TrackingEndShiftRequest,
  TrackingEndShiftResponse,
  TrackingFetchClientConfig,
  TrackingGetShiftPointsRequest,
  TrackingGetShiftPointsResponse,
  TrackingListShiftsRequest,
  TrackingListShiftsResponse,
  TrackingStartShiftRequest,
  TrackingStartShiftResponse,
  TrackingUploadPointsBatchRequest,
  TrackingUploadPointsBatchResponse,
} from "./types";

function joinUrl(baseUrl: string, path: string) {
  const base = baseUrl.replace(/\/+$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${base}${p}`;
}

function toQuery(params: Record<string, string | number | null | undefined>) {
  const qp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    qp.set(k, String(v));
  }
  const s = qp.toString();
  return s ? `?${s}` : "";
}

async function safeReadJson(res: Response): Promise<any> {
  const text = await res.text().catch(() => "");
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { success: false, error: text };
  }
}

export function createTrackingFetchClient(config: TrackingFetchClientConfig): TrackingApiClient {
  const fetchImpl = config.fetchImpl ?? fetch;
  const apiKeyHeaderName = config.apiKeyHeaderName ?? "X-CM-API-KEY";

  const baseUrl = config.baseUrl;
  if (!baseUrl || !String(baseUrl).trim()) {
    throw new Error("Tracking API baseUrl is required");
  }

  async function getHeaders() {
    const extra =
      typeof config.getHeaders === "function" ? await config.getHeaders() : undefined;
    return {
      ...(config.defaultHeaders ?? {}),
      ...(config.apiKey ? { [apiKeyHeaderName]: String(config.apiKey) } : {}),
      ...(extra ?? {}),
    } as Record<string, string>;
  }

  async function postJson<T>(path: string, body: any): Promise<T> {
    const res = await fetchImpl(joinUrl(baseUrl, path), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(await getHeaders()),
      },
      body: JSON.stringify(body ?? {}),
    });

    const json = await safeReadJson(res);
    if (json && typeof json === "object") return json as T;

    return { success: false, error: `Invalid response (${res.status})` } as any;
  }

  async function getJson<T>(path: string, query: Record<string, any>): Promise<T> {
    const res = await fetchImpl(joinUrl(baseUrl, `${path}${toQuery(query)}`), {
      method: "GET",
      headers: await getHeaders(),
    });

    const json = await safeReadJson(res);
    if (json && typeof json === "object") return json as T;

    return { success: false, error: `Invalid response (${res.status})` } as any;
  }

  return {
    startShift: (params: TrackingStartShiftRequest): Promise<TrackingStartShiftResponse> =>
      postJson("/tracking/shifts/start", params),

    endShift: (params: TrackingEndShiftRequest): Promise<TrackingEndShiftResponse> =>
      postJson("/tracking/shifts/end", params),

    uploadPointsBatch: (
      params: TrackingUploadPointsBatchRequest,
    ): Promise<TrackingUploadPointsBatchResponse> => postJson("/tracking/points/batch", params),

    listShifts: (params: TrackingListShiftsRequest): Promise<TrackingListShiftsResponse> =>
      getJson("/tracking/shifts", {
        employeeId: params.employeeId,
        workspaceId: params.workspaceId ?? undefined,
        fromTs: params.fromTs ?? undefined,
        toTs: params.toTs ?? undefined,
        limit: params.limit ?? undefined,
      }),

    getShiftPoints: (
      params: TrackingGetShiftPointsRequest,
    ): Promise<TrackingGetShiftPointsResponse> =>
      getJson(`/tracking/shifts/${params.shiftId}/points`, {
        fromTs: params.fromTs ?? undefined,
        toTs: params.toTs ?? undefined,
        limit: params.limit ?? undefined,
      }),
  };
}

