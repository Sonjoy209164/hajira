import "@hajiracm/tracking-expo/trackingTask";

import AsyncStorage from "@react-native-async-storage/async-storage";
import { createTrackingFetchClient } from "@hajiracm/tracking-core";
import {
  clearTrackingIssue,
  configureTrackingApiClient,
  flushQueuedPoints,
  getActiveShift,
  getTrackingIssue,
  pauseShiftTracking,
  resumeShiftTracking,
  startShiftTracking,
  stopShiftTracking,
} from "@hajiracm/tracking-expo";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Linking,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";

let NativeMap: {
  MapView: any;
  Marker: any;
  Polyline: any;
} | null = null;
let nativeMapError: string | null = null;

try {
  // react-native-maps is a native module. In Expo Go (and some runtimes) it may not be available.
  // We load it defensively so the app can still run without an embedded map.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const maps = require("react-native-maps");
  NativeMap = {
    MapView: maps?.default ?? maps,
    Marker: maps?.Marker,
    Polyline: maps?.Polyline,
  };
} catch (e: any) {
  NativeMap = null;
  nativeMapError = String(e?.message ?? e ?? "Native map module unavailable");
}

type Tab = "SHARE" | "VIEW";

type ViewerPoint = {
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

const STORAGE = {
  accepted: "jt.accepted.v1",
  baseUrl: "jt.baseUrl.v1",
  apiKey: "jt.apiKey.v1",
  myId: "jt.myId.v1",
  pairCode: "jt.pairCode.v1",
  viewId: "jt.viewId.v1",
  viewPair: "jt.viewPair.v1",
};

function makePairCode() {
  return `JT-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

function trimOrEmpty(v: string) {
  return (v ?? "").trim();
}

function openMaps(lat: number, lng: number) {
  const url = `https://www.google.com/maps?q=${encodeURIComponent(`${lat},${lng}`)}`;
  Linking.openURL(url).catch(() => null);
}

function formatTs(ts: number | null | undefined) {
  if (!ts) return "—";
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return String(ts);
  }
}

function readExpoPublicEnv(key: string): string | null {
  const v = (globalThis as any)?.process?.env?.[key];
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

export default function App() {
  const [tab, setTab] = useState<Tab>("SHARE");
  const [accepted, setAccepted] = useState(false);
  const [consent, setConsent] = useState(false);

  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");

  // Tracker inputs
  const [myId, setMyId] = useState("me");
  const [pairCode, setPairCode] = useState(makePairCode());

  // Viewer inputs
  const [viewId, setViewId] = useState("me");
  const [viewPair, setViewPair] = useState("");

  // Tracker state
  const [activeShift, setActiveShift] = useState<any>(null);
  const [issue, setIssue] = useState<any>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // Viewer state
  const [viewShiftId, setViewShiftId] = useState<string>("");
  const [viewPoints, setViewPoints] = useState<ViewerPoint[]>([]);
  const [viewError, setViewError] = useState<string>("");
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const viewerClient = useMemo(() => {
    const b = trimOrEmpty(baseUrl);
    if (!b) return null;
    return createTrackingFetchClient({ baseUrl: b, apiKey: trimOrEmpty(apiKey) || undefined });
  }, [baseUrl, apiKey]);

  async function saveSettings() {
    await AsyncStorage.multiSet([
      [STORAGE.accepted, accepted ? "1" : "0"],
      [STORAGE.baseUrl, baseUrl],
      [STORAGE.apiKey, apiKey],
      [STORAGE.myId, myId],
      [STORAGE.pairCode, pairCode],
      [STORAGE.viewId, viewId],
      [STORAGE.viewPair, viewPair],
    ]).catch(() => null);
  }

  async function refreshTrackerState() {
    const [a, i] = await Promise.all([getActiveShift(), getTrackingIssue()]);
    setActiveShift(a);
    setIssue(i);
  }

  async function configureBackendOrThrow() {
    const b = trimOrEmpty(baseUrl);
    if (!b) throw new Error("Set API Base URL first.");
    configureTrackingApiClient(
      createTrackingFetchClient({
        baseUrl: b,
        apiKey: trimOrEmpty(apiKey) || undefined,
      }),
    );
  }

  useEffect(() => {
    (async () => {
      const pairs = await AsyncStorage.multiGet([
        STORAGE.accepted,
        STORAGE.baseUrl,
        STORAGE.apiKey,
        STORAGE.myId,
        STORAGE.pairCode,
        STORAGE.viewId,
        STORAGE.viewPair,
      ]).catch(() => []);

      const dict = Object.fromEntries(pairs);
      setAccepted(dict[STORAGE.accepted] === "1");
      if (dict[STORAGE.baseUrl]) setBaseUrl(dict[STORAGE.baseUrl]);
      else {
        const envBaseUrl = readExpoPublicEnv("EXPO_PUBLIC_API_BASE_URL");
        if (envBaseUrl) setBaseUrl(envBaseUrl);
      }
      if (dict[STORAGE.apiKey]) setApiKey(dict[STORAGE.apiKey]);
      else {
        const envKey = readExpoPublicEnv("EXPO_PUBLIC_API_KEY");
        if (envKey) setApiKey(envKey);
      }
      if (dict[STORAGE.myId]) setMyId(dict[STORAGE.myId]);
      if (dict[STORAGE.pairCode]) setPairCode(dict[STORAGE.pairCode]);
      if (dict[STORAGE.viewId]) setViewId(dict[STORAGE.viewId]);
      if (dict[STORAGE.viewPair]) setViewPair(dict[STORAGE.viewPair]);

      await refreshTrackerState();
    })();
  }, []);

  useEffect(() => {
    if (accepted) return;
    Alert.alert(
      "Consent-based only",
      "JamaiTracker is for consensual location sharing. The person being tracked must opt in, see that sharing is ON, and be able to stop anytime.",
      [
        { text: "Not now", style: "cancel" },
        {
          text: "I understand",
          onPress: () => {
            setAccepted(true);
            AsyncStorage.setItem(STORAGE.accepted, "1").catch(() => null);
          },
        },
      ],
    );
  }, [accepted]);

  async function onStart() {
    try {
      setBusy("start");
      await configureBackendOrThrow();
      if (!accepted) throw new Error("Please accept consent notice first.");
      if (!consent) throw new Error("Enable the consent toggle before starting.");

      await saveSettings();
      const res = await startShiftTracking({
        employeeId: trimOrEmpty(myId),
        workspaceId: trimOrEmpty(pairCode),
      });
      setActiveShift(res);
      await refreshTrackerState();
    } catch (e: any) {
      Alert.alert("Start failed", String(e?.message ?? e ?? "Unknown error"));
    } finally {
      setBusy(null);
    }
  }

  async function onPause() {
    try {
      setBusy("pause");
      await pauseShiftTracking();
      await refreshTrackerState();
    } catch (e: any) {
      Alert.alert("Pause failed", String(e?.message ?? e ?? "Unknown error"));
    } finally {
      setBusy(null);
    }
  }

  async function onResume() {
    try {
      setBusy("resume");
      await resumeShiftTracking();
      await refreshTrackerState();
    } catch (e: any) {
      Alert.alert("Resume failed", String(e?.message ?? e ?? "Unknown error"));
    } finally {
      setBusy(null);
    }
  }

  async function onStop() {
    try {
      setBusy("stop");
      await stopShiftTracking();
      await refreshTrackerState();
    } catch (e: any) {
      Alert.alert("Stop failed", String(e?.message ?? e ?? "Unknown error"));
    } finally {
      setBusy(null);
    }
  }

  async function onFlushOnce() {
    try {
      setBusy("flush");
      await flushQueuedPoints({ maxBatches: 1 });
      await refreshTrackerState();
    } catch (e: any) {
      Alert.alert("Flush failed", String(e?.message ?? e ?? "Unknown error"));
    } finally {
      setBusy(null);
    }
  }

  async function onClearIssue() {
    await clearTrackingIssue().catch(() => null);
    await refreshTrackerState();
  }

  async function pollViewerOnce() {
    if (!viewerClient) {
      setViewError("Set API Base URL first.");
      return;
    }
    setViewError("");

    const employeeId = trimOrEmpty(viewId);
    if (!employeeId) {
      setViewError("Partner ID is required.");
      return;
    }

    const workspaceId = trimOrEmpty(viewPair) || null;
    const shifts = await viewerClient.listShifts({ employeeId, workspaceId, limit: 1 });
    if (!shifts.success) {
      setViewError(shifts.error || "Failed to list shifts");
      return;
    }
    const latest = shifts.shifts[0];
    if (!latest) {
      setViewShiftId("");
      setViewPoints([]);
      return;
    }

    setViewShiftId(latest.shiftId);
    const points = await viewerClient.getShiftPoints({ shiftId: latest.shiftId, limit: 2000 });
    if (!points.success) {
      setViewError(points.error || "Failed to fetch points");
      return;
    }
    setViewPoints(points.points as any);
  }

  function startPollingViewer() {
    if (pollingRef.current) clearInterval(pollingRef.current);
    pollingRef.current = setInterval(() => {
      void pollViewerOnce();
    }, 4000);
    void pollViewerOnce();
  }

  function stopPollingViewer() {
    if (pollingRef.current) clearInterval(pollingRef.current);
    pollingRef.current = null;
  }

  useEffect(() => {
    return () => stopPollingViewer();
  }, []);

  const latestPoint = viewPoints.length ? viewPoints[viewPoints.length - 1] : null;
  const mapRegion = useMemo(() => {
    if (!latestPoint) {
      return {
        latitude: 23.8103,
        longitude: 90.4125,
        latitudeDelta: 0.2,
        longitudeDelta: 0.2,
      };
    }
    return {
      latitude: latestPoint.latitude,
      longitude: latestPoint.longitude,
      latitudeDelta: 0.01,
      longitudeDelta: 0.01,
    };
  }, [latestPoint?.latitude, latestPoint?.longitude]);

  const polyline = useMemo(() => {
    return viewPoints.map((p) => ({ latitude: p.latitude, longitude: p.longitude }));
  }, [viewPoints]);

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" />
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>JamaiTracker</Text>
          <Text style={styles.subtitle}>Consent-based location sharing demo</Text>
        </View>
        <View style={styles.tabs}>
          <TabButton label="Share" active={tab === "SHARE"} onPress={() => setTab("SHARE")} />
          <TabButton label="View" active={tab === "VIEW"} onPress={() => setTab("VIEW")} />
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.container}>
        <Card title="Backend">
          <Field label="API Base URL" value={baseUrl} onChange={setBaseUrl} placeholder="http://10.0.2.2:3000" />
          <Field label="API Key (optional)" value={apiKey} onChange={setApiKey} placeholder="(optional)" secure />
          <Text style={styles.help}>
            Tip: physical device needs your LAN IP (same Wi‑Fi). Android emulator often uses{" "}
            <Text style={styles.mono}>http://10.0.2.2:3000</Text>.
          </Text>
        </Card>

        {tab === "SHARE" ? (
          <>
            <Card title="Share (Tracker device)">
              <View style={styles.rowBetween}>
                <Text style={styles.label}>Consent</Text>
                <Switch value={consent} onValueChange={setConsent} />
              </View>
              <Text style={styles.help}>
                Only start if you are sharing <Text style={styles.bold}>your own</Text> location and you intend to share it.
              </Text>

              <Field label="My ID" value={myId} onChange={setMyId} placeholder="me" />
              <View style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Field label="Pair code (workspaceId)" value={pairCode} onChange={setPairCode} placeholder="JT-ABC123" />
                </View>
                <Pressable style={styles.smallBtn} onPress={() => setPairCode(makePairCode())}>
                  <Text style={styles.smallBtnText}>New</Text>
                </Pressable>
              </View>

              <View style={styles.pills}>
                <Pill label={activeShift?.paused ? "PAUSED" : activeShift ? "SHARING ON" : "OFF"} tone={activeShift ? (activeShift.paused ? "warn" : "ok") : "muted"} />
                {issue?.type ? <Pill label="ISSUE" tone="bad" /> : null}
              </View>

              <View style={styles.actions}>
                <PrimaryButton disabled={busy != null} label={busy === "start" ? "Starting…" : "Start"} onPress={onStart} />
                <SecondaryButton disabled={busy != null} label={busy === "pause" ? "Pausing…" : "Pause"} onPress={onPause} />
                <SecondaryButton disabled={busy != null} label={busy === "resume" ? "Resuming…" : "Resume"} onPress={onResume} />
                <DangerButton disabled={busy != null} label={busy === "stop" ? "Stopping…" : "Stop"} onPress={onStop} />
              </View>

              <View style={styles.actions}>
                <SecondaryButton disabled={busy != null} label={busy === "flush" ? "Uploading…" : "Upload once"} onPress={onFlushOnce} />
                <SecondaryButton disabled={busy != null} label="Refresh state" onPress={refreshTrackerState} />
              </View>

              <Divider />

              <Text style={styles.monoSmall}>shiftId: {activeShift?.shiftId ?? "—"}</Text>
              <Text style={styles.monoSmall}>deviceId: {activeShift?.deviceId ?? "—"}</Text>
              <Text style={styles.monoSmall}>strategy: {activeShift?.strategy ?? "—"}</Text>

              {issue ? (
                <View style={styles.issueBox}>
                  <Text style={styles.issueTitle}>Issue: {issue.type}</Text>
                  <Text style={styles.issueText}>{issue.message}</Text>
                  <Text style={styles.issueText}>at: {formatTs(issue.at)}</Text>
                  <View style={styles.actions}>
                    <SecondaryButton disabled={busy != null} label="Clear issue" onPress={onClearIssue} />
                  </View>
                </View>
              ) : null}

              <Text style={styles.help}>
                If background tracking is flaky on Android, ensure Location is “Allow all the time” and Battery is set to “Unrestricted”.
              </Text>
            </Card>
          </>
        ) : (
          <>
            <Card title="View (Partner device)">
              <Field label="Partner ID" value={viewId} onChange={setViewId} placeholder="me" />
              <Field label="Pair code (optional filter)" value={viewPair} onChange={setViewPair} placeholder="JT-ABC123" />

              <View style={styles.actions}>
                <PrimaryButton
                  disabled={busy != null}
                  label={pollingRef.current ? "Polling…" : "Start watching"}
                  onPress={async () => {
                    await saveSettings();
                    startPollingViewer();
                  }}
                />
                <SecondaryButton label="Stop" onPress={stopPollingViewer} />
                <SecondaryButton label="Refresh once" onPress={pollViewerOnce} />
              </View>

              {viewError ? <Text style={styles.error}>{viewError}</Text> : null}

              <Divider />

              <Text style={styles.monoSmall}>shiftId: {viewShiftId || "—"}</Text>
              <Text style={styles.monoSmall}>
                latest: {latestPoint ? `${latestPoint.latitude.toFixed(5)}, ${latestPoint.longitude.toFixed(5)}` : "—"}
              </Text>
              <Text style={styles.monoSmall}>at: {latestPoint ? formatTs(latestPoint.ts) : "—"}</Text>

              {latestPoint ? (
                <View style={styles.actions}>
                  <SecondaryButton label="Open in Maps" onPress={() => openMaps(latestPoint.latitude, latestPoint.longitude)} />
                </View>
              ) : null}
            </Card>

            <Card title="Map">
              <View style={styles.mapWrap}>
                {NativeMap ? (
                  <NativeMap.MapView style={styles.map} region={mapRegion}>
                    {latestPoint ? (
                      <NativeMap.Marker
                        coordinate={{ latitude: latestPoint.latitude, longitude: latestPoint.longitude }}
                        title="Latest"
                      />
                    ) : null}
                    {polyline.length > 1 ? (
                      <NativeMap.Polyline
                        coordinates={polyline}
                        strokeWidth={4}
                        strokeColor="#7C3AED"
                      />
                    ) : null}
                  </NativeMap.MapView>
                ) : (
                  <View style={[styles.map, styles.mapFallback]}>
                    <Text style={styles.mapFallbackTitle}>Map unavailable</Text>
                    <Text style={styles.help}>
                      This runtime doesn’t include native maps (common in Expo Go). You can still
                      use “Open in Maps”, or build a Dev Client to enable the embedded map.
                    </Text>
                    {latestPoint ? (
                      <View style={styles.actions}>
                        <SecondaryButton
                          label="Open in Maps"
                          onPress={() => openMaps(latestPoint.latitude, latestPoint.longitude)}
                        />
                      </View>
                    ) : null}
                    {nativeMapError ? (
                      <Text style={styles.monoSmall}>details: {nativeMapError}</Text>
                    ) : null}
                  </View>
                )}
              </View>
              <Text style={styles.help}>
                Demo security note: this viewer screen fetches points without real user auth. For production you must secure your backend and authorize who can view.
              </Text>
            </Card>
          </>
        )}

        <Card title="Reminder">
          <Text style={styles.help}>
            This demo is designed for <Text style={styles.bold}>opt-in</Text> sharing. Don’t use it to track someone without permission.
          </Text>
          <View style={styles.actions}>
            <SecondaryButton
              label="Learn about consent"
              onPress={() => Linking.openURL("https://www.npmjs.com/policies/conduct").catch(() => null)}
            />
          </View>
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{title}</Text>
      <View style={{ gap: 10 }}>{children}</View>
    </View>
  );
}

function Divider() {
  return <View style={styles.divider} />;
}

function Field(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  secure?: boolean;
}) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={styles.label}>{props.label}</Text>
      <TextInput
        value={props.value}
        onChangeText={props.onChange}
        placeholder={props.placeholder}
        placeholderTextColor="#64748B"
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry={props.secure}
        style={styles.input}
      />
    </View>
  );
}

function TabButton(props: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={props.onPress} style={[styles.tabBtn, props.active && styles.tabBtnActive]}>
      <Text style={[styles.tabBtnText, props.active && styles.tabBtnTextActive]}>{props.label}</Text>
    </Pressable>
  );
}

function Pill(props: { label: string; tone: "ok" | "warn" | "bad" | "muted" }) {
  const toneStyle =
    props.tone === "ok"
      ? styles.pillOk
      : props.tone === "warn"
        ? styles.pillWarn
        : props.tone === "bad"
          ? styles.pillBad
          : styles.pillMuted;
  return (
    <View style={[styles.pill, toneStyle]}>
      <Text style={styles.pillText}>{props.label}</Text>
    </View>
  );
}

function PrimaryButton(props: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable onPress={props.onPress} disabled={props.disabled} style={[styles.btn, styles.btnPrimary, props.disabled && styles.btnDisabled]}>
      <Text style={styles.btnPrimaryText}>{props.label}</Text>
    </Pressable>
  );
}

function SecondaryButton(props: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable onPress={props.onPress} disabled={props.disabled} style={[styles.btn, styles.btnSecondary, props.disabled && styles.btnDisabled]}>
      <Text style={styles.btnSecondaryText}>{props.label}</Text>
    </Pressable>
  );
}

function DangerButton(props: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable onPress={props.onPress} disabled={props.disabled} style={[styles.btn, styles.btnDanger, props.disabled && styles.btnDisabled]}>
      <Text style={styles.btnDangerText}>{props.label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#0B1020" },
  header: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#1F2A44",
    gap: 10,
  },
  title: { color: "white", fontSize: 22, fontWeight: "800" },
  subtitle: { color: "#94A3B8", marginTop: 2 },
  tabs: { flexDirection: "row", gap: 8, marginTop: 10 },
  tabBtn: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#233055",
    backgroundColor: "#0F1730",
  },
  tabBtnActive: { backgroundColor: "#1A1F3D", borderColor: "#7C3AED" },
  tabBtnText: { color: "#CBD5E1", fontWeight: "700" },
  tabBtnTextActive: { color: "white" },
  container: { padding: 16, paddingBottom: 40, gap: 12 },
  card: {
    backgroundColor: "#0F1730",
    borderColor: "#1F2A44",
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    gap: 10,
  },
  cardTitle: { color: "white", fontSize: 16, fontWeight: "800" },
  label: { color: "#CBD5E1", fontWeight: "700" },
  input: {
    backgroundColor: "#0B1020",
    borderColor: "#233055",
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: "white",
  },
  help: { color: "#94A3B8", lineHeight: 18 },
  bold: { fontWeight: "800", color: "#E2E8F0" },
  mono: { fontFamily: "Courier", color: "#E2E8F0" },
  monoSmall: { fontFamily: "Courier", color: "#CBD5E1", fontSize: 12 },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  row: { flexDirection: "row", gap: 10, alignItems: "flex-end" },
  smallBtn: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: "#1A1F3D",
    borderWidth: 1,
    borderColor: "#233055",
  },
  smallBtnText: { color: "white", fontWeight: "800" },
  pills: { flexDirection: "row", gap: 8, marginTop: 6 },
  pill: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, borderWidth: 1 },
  pillText: { color: "white", fontWeight: "800", fontSize: 12 },
  pillOk: { backgroundColor: "rgba(34,197,94,0.15)", borderColor: "rgba(34,197,94,0.35)" },
  pillWarn: { backgroundColor: "rgba(245,158,11,0.15)", borderColor: "rgba(245,158,11,0.35)" },
  pillBad: { backgroundColor: "rgba(239,68,68,0.15)", borderColor: "rgba(239,68,68,0.35)" },
  pillMuted: { backgroundColor: "rgba(148,163,184,0.10)", borderColor: "rgba(148,163,184,0.25)" },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 8 },
  btn: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, borderWidth: 1 },
  btnDisabled: { opacity: 0.55 },
  btnPrimary: { backgroundColor: "#7C3AED", borderColor: "#7C3AED" },
  btnPrimaryText: { color: "white", fontWeight: "900" },
  btnSecondary: { backgroundColor: "#0B1020", borderColor: "#233055" },
  btnSecondaryText: { color: "#E2E8F0", fontWeight: "800" },
  btnDanger: { backgroundColor: "rgba(239,68,68,0.15)", borderColor: "rgba(239,68,68,0.35)" },
  btnDangerText: { color: "#FCA5A5", fontWeight: "900" },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: "#1F2A44", marginVertical: 8 },
  issueBox: { marginTop: 10, padding: 12, borderRadius: 12, backgroundColor: "rgba(239,68,68,0.10)", borderWidth: 1, borderColor: "rgba(239,68,68,0.25)" },
  issueTitle: { color: "#FCA5A5", fontWeight: "900" },
  issueText: { color: "#FECACA", marginTop: 4 },
  error: { color: "#FCA5A5", marginTop: 8, fontWeight: "700" },
  mapWrap: { height: 260, borderRadius: 14, overflow: "hidden", borderWidth: 1, borderColor: "#233055" },
  map: { flex: 1 },
  mapFallback: { padding: 14, justifyContent: "center", gap: 8, backgroundColor: "#0B1020" },
  mapFallbackTitle: { color: "white", fontWeight: "900", fontSize: 14 },
});
