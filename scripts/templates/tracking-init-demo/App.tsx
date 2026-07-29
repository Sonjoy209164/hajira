import "@hajiracm/all-time-tracking-expo/trackingTask";

import NetInfo from "@react-native-community/netinfo";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Platform, SafeAreaView, ScrollView, Text, View } from "react-native";

import {
  clearQueuedTrackingPoints,
  drainQueuedTrackingPoints,
  getActiveSession,
  getOrCreateDeviceId,
  openAppSettings,
  pauseTracking,
  readQueuedTrackingPoints,
  resumeTracking,
  setTrackingInitDebugLogging,
  startTracking,
  stopTracking,
  type QueuedTrackingPoint,
} from "@hajiracm/all-time-tracking-expo";

// Print every collected point to the JS console
setTrackingInitDebugLogging(true);

function formatTs(ts: number) {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return String(ts);
  }
}

export default function App() {
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [active, setActive] = useState<any>(null);
  const [queue, setQueue] = useState<QueuedTrackingPoint[]>([]);
  const [online, setOnline] = useState<boolean | null>(null);
  const [output, setOutput] = useState<string>("");
  const [busy, setBusy] = useState<boolean>(false);

  const sessionId: string | null = active?.sessionId ?? null;

  const refresh = useCallback(async () => {
    const nextActive = await getActiveSession().catch(() => null);
    setActive(nextActive);

    if (nextActive?.sessionId) {
      const list = await readQueuedTrackingPoints({ sessionId: nextActive.sessionId }).catch(() => []);
      setQueue(Array.isArray(list) ? list : []);
    } else {
      setQueue([]);
    }
  }, []);

  useEffect(() => {
    getOrCreateDeviceId()
      .then(setDeviceId)
      .catch((e) => setOutput(String(e)));

    refresh().catch(() => null);

    const unsub = NetInfo.addEventListener((state) => {
      const isOnline = Boolean(state.isConnected && state.isInternetReachable !== false);
      setOnline(isOnline);
    });

    const timer = setInterval(() => refresh().catch(() => null), 2500);
    return () => {
      clearInterval(timer);
      unsub();
    };
  }, [refresh]);

  const summary = useMemo(() => {
    if (!active) return "No active session";
    return [
      `sessionId: ${active.sessionId}`,
      `deviceId: ${active.deviceId}`,
      `startedAt: ${formatTs(active.startedAt)}`,
      `paused: ${Boolean(active.paused)}`,
      `strategy: ${active.strategy ?? "?"}`,
      active.permissionWarning ? `warning: ${active.permissionWarning}` : null,
    ]
      .filter(Boolean)
      .join("\n");
  }, [active]);

  async function run(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
    } catch (e: any) {
      setOutput(String(e?.message ?? e));
    } finally {
      setBusy(false);
      refresh().catch(() => null);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#0b1020" }}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
        <Text style={{ color: "white", fontSize: 22, fontWeight: "700" }}>Tracking Init Demo</Text>

        <View
          style={{
            backgroundColor: "#121a33",
            borderRadius: 12,
            padding: 12,
            gap: 8,
          }}
        >
          <Text style={{ color: "#c7d2fe" }}>Device</Text>
          <Text style={{ color: "white" }}>{deviceId ?? "…"}</Text>
          <Text style={{ color: "#c7d2fe" }}>Network</Text>
          <Text style={{ color: "white" }}>{online == null ? "…" : online ? "Online" : "Offline"}</Text>
          <Text style={{ color: "#c7d2fe" }}>Session</Text>
          <Text style={{ color: "white", fontFamily: Platform.select({ ios: "Menlo", android: "monospace" }) }}>
            {summary}
          </Text>
        </View>

        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          <Button
            title={busy ? "…" : "Start"}
            onPress={() =>
              run(async () => {
                const res = await startTracking({ sessionId: "demo" });
                setOutput(`startTracking -> ${JSON.stringify(res, null, 2)}`);
              })
            }
          />
          <Button title="Pause" onPress={() => run(async () => void (await pauseTracking()))} />
          <Button title="Resume" onPress={() => run(async () => void (await resumeTracking()))} />
          <Button title="Stop" onPress={() => run(async () => void (await stopTracking()))} />
          <Button title="App settings" onPress={() => run(async () => void (await openAppSettings()))} />
        </View>

        <View
          style={{
            backgroundColor: "#121a33",
            borderRadius: 12,
            padding: 12,
            gap: 8,
          }}
        >
          <Text style={{ color: "#c7d2fe" }}>Queue</Text>
          <Text style={{ color: "white" }}>{sessionId ? `${queue.length} point(s) queued` : "No session"}</Text>

          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            <Button
              title="Drain 50"
              onPress={() =>
                run(async () => {
                  if (!sessionId) throw new Error("No active session");
                  const drained = await drainQueuedTrackingPoints({ sessionId, limit: 50 });
                  setOutput(`drainQueuedTrackingPoints -> ${JSON.stringify(drained, null, 2)}`);
                })
              }
            />
            <Button
              title="Clear"
              onPress={() =>
                run(async () => {
                  if (!sessionId) throw new Error("No active session");
                  await clearQueuedTrackingPoints({ sessionId });
                  setOutput("cleared queue");
                })
              }
            />
          </View>

          <Text style={{ color: "#c7d2fe" }}>Last point</Text>
          <Text style={{ color: "white", fontFamily: Platform.select({ ios: "Menlo", android: "monospace" }) }}>
            {queue.length ? JSON.stringify(queue[queue.length - 1], null, 2) : "—"}
          </Text>
        </View>

        <View
          style={{
            backgroundColor: "#0f172a",
            borderRadius: 12,
            padding: 12,
            gap: 8,
          }}
        >
          <Text style={{ color: "#c7d2fe" }}>Output</Text>
          <Text style={{ color: "white", fontFamily: Platform.select({ ios: "Menlo", android: "monospace" }) }}>
            {output || "—"}
          </Text>
        </View>

        <Text style={{ color: "#94a3b8", fontSize: 12 }}>
          Note: Background tracking is reliable in a Dev Build/Production. In Expo Go on Android, it falls back to a foreground
          watcher (works while the app is open).
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}
