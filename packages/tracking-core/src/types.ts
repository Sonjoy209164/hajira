export type TrackingMode = "OFF_DUTY" | "TRACKING" | "PAUSED" | "ERROR";

export type TrackingIssueType = "MOCK_LOCATION";
export type TrackingIssue = {
  type: TrackingIssueType;
  message: string;
  at: number; // epoch ms
};

export type TrackingPointUpload = {
  pointId: string;
  ts: number;
  queuedAt?: number | null;
  latitude: number;
  longitude: number;
  accuracyM?: number | null;
  speedMps?: number | null;
  bearingDeg?: number | null;
  isMock?: boolean | null;
};

export type TrackingPoint = {
  pointId: string;
  ts: number | null;
  latitude: number;
  longitude: number;
  accuracyM?: number | null;
  speedMps?: number | null;
  bearingDeg?: number | null;
  isMock?: boolean | null;
  receivedAt?: number | null;
};

export type TrackingShiftSummary = {
  shiftId: string;
  employeeId: number | string;
  workspaceId: number | string;
  deviceId: string;
  startTime: number | null;
  endTime: number | null;
};

export type TrackingStartShiftRequest = {
  employeeId: string;
  workspaceId: string;
  deviceId: string;
};

export type TrackingStartShiftResponse =
  | { success: true; shiftId: string }
  | { success: false; error: string };

export type TrackingEndShiftRequest = {
  shiftId: string;
  employeeId: string;
  workspaceId: string;
  deviceId: string;
};

export type TrackingEndShiftResponse =
  | { success: true }
  | { success: false; error: string };

export type TrackingUploadPointsBatchRequest = {
  shiftId: string;
  employeeId: string;
  workspaceId: string;
  deviceId: string;
  batchStartLocalId: number;
  batchEndLocalId: number;
  points: TrackingPointUpload[];
};

export type TrackingUploadPointsBatchResponse =
  | { success: true; inserted: number; ackUpToLocalId: number | null }
  | { success: false; error: string };

export type TrackingListShiftsRequest = {
  employeeId: string;
  workspaceId?: string | null;
  fromTs?: number | null;
  toTs?: number | null;
  limit?: number;
};

export type TrackingListShiftsResponse =
  | { success: true; count: number; shifts: TrackingShiftSummary[] }
  | { success: false; error: string };

export type TrackingGetShiftPointsRequest = {
  shiftId: string;
  fromTs?: number | null;
  toTs?: number | null;
  limit?: number;
};

export type TrackingGetShiftPointsResponse =
  | { success: true; shiftId: string; count: number; points: TrackingPoint[] }
  | { success: false; error: string };

export type TrackingApiClient = {
  startShift: (params: TrackingStartShiftRequest) => Promise<TrackingStartShiftResponse>;
  endShift: (params: TrackingEndShiftRequest) => Promise<TrackingEndShiftResponse>;
  uploadPointsBatch: (
    params: TrackingUploadPointsBatchRequest,
  ) => Promise<TrackingUploadPointsBatchResponse>;
  listShifts: (params: TrackingListShiftsRequest) => Promise<TrackingListShiftsResponse>;
  getShiftPoints: (params: TrackingGetShiftPointsRequest) => Promise<TrackingGetShiftPointsResponse>;
};

export type TrackingFetchClientConfig = {
  baseUrl: string;
  apiKey?: string | null;
  apiKeyHeaderName?: string;
  defaultHeaders?: Record<string, string>;
  getHeaders?: () => Promise<Record<string, string> | undefined> | Record<string, string> | undefined;
  fetchImpl?: typeof fetch;
};

