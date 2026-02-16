let debugLoggingEnabled = false;

export function setTrackingInitDebugLogging(enabled: boolean) {
  debugLoggingEnabled = Boolean(enabled);
}

export function isTrackingInitDebugLoggingEnabled() {
  return debugLoggingEnabled;
}

