import React, { useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { botTitle } from "@/features/chat/botMeta";
import { BotUsage, compact, costOf, daySeries, tokensOf, useUsage } from "@/features/usage/useUsage";
import { useGateway } from "@/lib/store/GatewayProvider";
import { BotAvatar, Button, Chip, EmptyState, ScreenHeader } from "@/ui/primitives";
import { botColor, makeStyles, radius, space, useTheme } from "@/ui/theme";

const PERIODS = [7, 30, 90];

/** Daily tokens as a row of bars (no chart library needed at this size). */
function Bars({ usage, tint, days }: { usage: BotUsage; tint: string; days: number }) {
  const styles = useStyles();
  // Hermes lists only active days; lay them on the full period so quiet days read as gaps.
  const values = daySeries(usage, days);
  const max = Math.max(1, ...values);
  if (!values.some(Boolean)) return null;
  return (
    <View style={styles.bars} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {values.map((v, i) => (
        <View key={i} style={[styles.bar, { height: v ? Math.max(2, (v / max) * 36) : 1, backgroundColor: tint, opacity: v ? 0.85 : 0.2 }]} />
      ))}
    </View>
  );
}

/** Which bots use the most tokens (and money, where the provider reports cost). */
export default function UsageScreen() {
  const styles = useStyles();
  const { colors, type } = useTheme();
  const { profiles } = useGateway();
  const [days, setDays] = useState(30);
  const [refreshing, setRefreshing] = useState(false);
  const { rows, error, reload } = useUsage(days);
  const total = (rows ?? []).reduce((sum, r) => sum + tokensOf(r.totals), 0);
  const cost = (rows ?? []).reduce((sum, r) => sum + costOf(r.totals), 0);

  return (
    <View style={styles.screen}>
      <ScreenHeader
        title="Usage"
        subtitle={rows ? `${compact(total)} tokens${cost > 0 ? ` · $${cost.toFixed(2)}` : ""} in ${days} days` : undefined}
        onBack={() => router.back()}
      />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void reload().finally(() => setRefreshing(false));
            }}
            tintColor={colors.muted}
          />
        }
      >
        <View style={styles.periods}>
          {PERIODS.map((p) => (
            <Chip key={p} label={`${p} days`} active={days === p} onPress={() => setDays(p)} />
          ))}
        </View>
        {!rows && !error ? <ActivityIndicator style={{ marginTop: space.xxl }} color={colors.muted} /> : null}
        {error && !rows ? (
          <EmptyState icon="stats-chart-outline" title="Couldn't load usage" body={error} action={<Button title="Try again" variant="secondary" onPress={() => void reload()} />} />
        ) : null}
        {rows?.map((usage) => {
          const tint = botColor(usage.bot, colors);
          const tokens = tokensOf(usage.totals);
          const share = total ? tokens / total : 0;
          const money = costOf(usage.totals);
          return (
            <View key={usage.bot} style={styles.card}>
              <View style={styles.head}>
                <BotAvatar name={usage.bot} size={32} />
                <View style={styles.flex}>
                  <Text style={type.heading}>{botTitle(profiles.find((p) => p.name === usage.bot), usage.bot)}</Text>
                  <Text style={type.small}>
                    {`${usage.totals.total_sessions} sessions · ${usage.totals.total_api_calls} calls${money > 0 ? ` · $${money.toFixed(2)}` : ""}`}
                  </Text>
                </View>
                <View style={styles.right}>
                  <Text style={styles.tokens}>{compact(tokens)}</Text>
                  <Text style={type.small}>{`${Math.round(share * 100)}%`}</Text>
                </View>
              </View>
              <View style={styles.meter}>
                <View style={[styles.meterFill, { width: `${share * 100}%`, backgroundColor: tint }]} />
              </View>
              <Bars usage={usage} tint={tint} days={days} />
              {usage.models.length || usage.tools.length ? (
                <Text style={type.small} numberOfLines={2}>
                  {[
                    usage.models.slice(0, 2).map((m) => m.model).join(", "),
                    usage.tools.slice(0, 3).map((t) => `${t.tool} ×${t.count}`).join(", "),
                  ]
                    .filter(Boolean)
                    .join("  ·  ")}
                </Text>
              ) : null}
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.lg, gap: space.md, paddingBottom: space.xxl },
  periods: { flexDirection: "row", gap: space.sm },
  card: {
    padding: space.md,
    gap: space.sm,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  head: { flexDirection: "row", alignItems: "center", gap: space.md },
  flex: { flex: 1, minWidth: 0 },
  right: { alignItems: "flex-end" },
  tokens: { color: colors.text, fontSize: 17, fontWeight: "700" },
  meter: { height: 4, borderRadius: 2, backgroundColor: colors.raised, overflow: "hidden" },
  meterFill: { height: 4, borderRadius: 2 },
  bars: { flexDirection: "row", alignItems: "flex-end", gap: 2, height: 36 },
  bar: { flex: 1, borderRadius: 1.5 },
}));
