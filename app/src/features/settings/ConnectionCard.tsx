import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { errorText, useGateway } from "@/lib/store/GatewayProvider";
import type { ConnectionState } from "@/lib/gateway/types";
import { Icon } from "@/ui/primitives";
import { makeStyles, radius, space, useTheme } from "@/ui/theme";
import { platformName, platformTone, titleCase, type Tone } from "./format";
import type { GatewayStatus, UpdateCheck } from "./types";
import { Pill, StatusDot } from "./ui";

const CONNECTION_COPY: Record<ConnectionState, { label: string; tone: Tone }> = {
  open: { label: "Connected", tone: "success" },
  connecting: { label: "Connecting…", tone: "warn" },
  reconnecting: { label: "Reconnecting…", tone: "warn" },
  idle: { label: "Offline", tone: "danger" },
  closed: { label: "Disconnected", tone: "danger" },
};

export function hostOf(url: string | undefined): string {
  if (!url) return "Not configured";
  return url.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
}

/** Gateway host, live socket state, Hermes version/update and messaging platforms (GET /api/status). */
export function ConnectionCard({ refreshKey }: { refreshKey: number }) {
  const { config, connection, get } = useGateway();
  const styles = useStyles();
  const { colors, type } = useTheme();
  const [status, setStatus] = useState<GatewayStatus | null>(null);
  const [update, setUpdate] = useState<UpdateCheck | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  /** Fetch status + update check; callers own flipping `loading` on first. */
  // State is only set in promise callbacks (never synchronously), so effects can call this directly.
  const fetchStatus = useCallback(
    (): Promise<void> =>
      get<GatewayStatus>("/api/status")
        .then((next) => {
          setStatus(next);
          setError(null);
        })
        .catch((err) => setError(errorText(err, "Could not reach the gateway.")))
        .finally(() => setLoading(false))
        .then(() => {
          // The update check may hit GitHub (cached 24h server-side); never block the card on it.
          get<UpdateCheck>("/api/hermes/update/check")
            .then(setUpdate)
            .catch(() => setUpdate(null));
        }),
    [get],
  );

  const load = useCallback(() => {
    setLoading(true);
    return fetchStatus();
  }, [fetchStatus]);

  // Reload on pull-to-refresh (refreshKey) and whenever the socket comes back up.
  // The spinner flips on during render when a trigger changes; the effect only fetches.
  const isOpen = connection === "open";
  const trigger = `${refreshKey}:${isOpen}`;
  const [prevTrigger, setPrevTrigger] = useState(trigger);
  if (trigger !== prevTrigger) {
    setPrevTrigger(trigger);
    setLoading(true);
  }
  useEffect(() => {
    fetchStatus();
  }, [fetchStatus, refreshKey, isOpen]);

  const conn = CONNECTION_COPY[connection] ?? CONNECTION_COPY.idle;
  const platforms = Object.entries(status?.gateway_platforms ?? {});
  const gatewayTone: Tone = status?.gateway_running ? "success" : status ? "danger" : "muted";

  return (
    <View style={styles.card} accessibilityLabel={`Gateway ${hostOf(config?.url)}, ${conn.label}`}>
      <View style={styles.top}>
        <View style={styles.logo}>
          <Icon name="planet-outline" size={22} color={colors.accentText} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={type.heading} numberOfLines={1} selectable>
            {hostOf(config?.url)}
          </Text>
          <View style={styles.stateLine}>
            <StatusDot tone={conn.tone} />
            <Text style={[type.small, { color: colors.textSoft }]}>{conn.label}</Text>
          </View>
        </View>
        {loading ? (
          <ActivityIndicator color={colors.muted} />
        ) : (
          <Pressable accessibilityRole="button" accessibilityLabel="Refresh status" hitSlop={10} onPress={load}>
            <Icon name="refresh" size={18} color={colors.muted} />
          </Pressable>
        )}
      </View>

      {error ? (
        <View style={styles.errorBox}>
          <Icon name="alert-circle-outline" size={16} color={colors.danger} />
          <Text style={[type.small, { color: colors.danger, flex: 1 }]}>{error}</Text>
        </View>
      ) : null}

      {status ? (
        <View style={styles.facts}>
          <Fact label="Hermes">
            <Text style={styles.factValue}>
              v{status.version ?? "?"}
              {status.release_date ? <Text style={type.small}>{`  ·  ${status.release_date}`}</Text> : null}
            </Text>
            {update?.update_available ? (
              <Pill
                icon="arrow-up-circle"
                tone="warn"
                label={update.behind && update.behind > 0 ? `Update · ${update.behind} behind` : "Update available"}
              />
            ) : update ? (
              <Pill icon="checkmark-circle" tone="success" label="Up to date" />
            ) : null}
          </Fact>
          <Fact label="Gateway">
            <StatusDot tone={gatewayTone} />
            <Text style={styles.factValue}>
              {status.gateway_running ? titleCase(status.gateway_state || "running") : "Stopped"}
            </Text>
            {typeof status.active_agents === "number" && status.active_agents > 0 ? (
              <Text style={type.small}>{`· ${status.active_agents} working`}</Text>
            ) : null}
          </Fact>
          {!status.gateway_running && status.gateway_exit_reason ? (
            <Text style={[type.small, { color: colors.danger }]}>{status.gateway_exit_reason}</Text>
          ) : null}
          <Fact label="Platforms">
            {platforms.length === 0 ? (
              <Text style={type.small}>None connected</Text>
            ) : (
              <View style={styles.platforms}>
                {platforms.map(([id, p]) => {
                  const tone = platformTone(p?.state);
                  return (
                    <View
                      key={id}
                      style={styles.platform}
                      accessibilityLabel={`${platformName(id)} ${p?.state ?? "unknown"}`}
                    >
                      <StatusDot tone={tone} size={6} />
                      <Text style={styles.platformText}>{platformName(id)}</Text>
                    </View>
                  );
                })}
              </View>
            )}
          </Fact>
        </View>
      ) : null}
      {update?.update_available && update.update_command ? (
        <Text style={[type.small, styles.hint]}>
          Run <Text style={[type.mono, { color: colors.textSoft }]}>{update.update_command}</Text> on the host to update.
        </Text>
      ) : null}
    </View>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  const styles = useStyles();
  return (
    <View style={styles.fact}>
      <Text style={styles.factLabel}>{label}</Text>
      <View style={styles.factBody}>{children}</View>
    </View>
  );
}

const useStyles = makeStyles((colors, type) => ({
  card: {
    marginHorizontal: space.lg,
    padding: space.lg,
    gap: space.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  top: { flexDirection: "row", alignItems: "center", gap: space.md },
  logo: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: `${colors.accent}1A`,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: `${colors.accent}55`,
    alignItems: "center",
    justifyContent: "center",
  },
  stateLine: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 },
  errorBox: {
    flexDirection: "row",
    gap: space.sm,
    alignItems: "center",
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.dangerBg,
  },
  facts: {
    gap: space.sm,
    paddingTop: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  fact: { flexDirection: "row", alignItems: "flex-start", gap: space.md, minHeight: 24 },
  factLabel: { ...type.small, width: 76, paddingTop: 2 },
  factBody: { flex: 1, flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: space.sm, minHeight: 22 },
  factValue: { color: colors.text, fontSize: 14, fontWeight: "500" },
  platforms: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  platform: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    height: 26,
    borderRadius: radius.pill,
    backgroundColor: colors.raised,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  platformText: { color: colors.textSoft, fontSize: 12, fontWeight: "500" },
  hint: { marginTop: -space.xs },
}));
