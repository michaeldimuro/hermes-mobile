import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, SectionList, Text, TextInput, View } from "react-native";
import { errorText, useGateway } from "@/lib/store/GatewayProvider";
import type { ModelOptionProvider, ModelOptionsResult } from "@/lib/gateway/types";
import { Button, haptic, Icon, Sheet } from "@/ui/primitives";
import { makeStyles, radius, space, useTheme } from "@/ui/theme";

export type ModelPick = { provider: string; model: string };

type Props = {
  visible: boolean;
  onClose: () => void;
  /** Profile whose auth/catalog to read; omit for the launch (default) profile. */
  profile?: string;
  value: ModelPick | null;
  onSelect: (pick: ModelPick | null) => void;
  /** Adds an "inherit the default model" row (used when creating a bot). */
  allowInherit?: boolean;
};

type Section = { provider: ModelOptionProvider; data: string[] };

// Catalog is stable within a session; keep it so re-opening the sheet is instant.
const cache = new Map<string, ModelOptionsResult>();

export function ModelSheet({ visible, onClose, profile, value, onSelect, allowInherit }: Props) {
  const { colors, type, scheme } = useTheme();
  const styles = useStyles();
  const { call } = useGateway();
  const key = profile ?? "";
  const [data, setData] = useState<ModelOptionsResult | null>(() => cache.get(key) ?? null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  // Clear the search and any stale error each time the sheet opens (or its profile changes while open).
  const session = visible ? key : null;
  const [prevSession, setPrevSession] = useState<string | null>(null);
  if (session !== prevSession) {
    setPrevSession(session);
    if (session !== null) {
      setQuery("");
      setError(null);
    }
  }

  useEffect(() => {
    if (!visible) return;
    let live = true;
    const params: Record<string, unknown> = { explicit_only: true };
    if (profile) params.profile = profile;
    call<ModelOptionsResult>("model.options", params, 45_000)
      .then((result) => {
        cache.set(key, result);
        if (live) setData(result);
      })
      .catch((err) => live && setError(errorText(err, "Could not load models")));
    return () => {
      live = false;
    };
  }, [visible, profile, key, call]);

  const sections = useMemo<Section[]>(() => {
    const q = query.trim().toLowerCase();
    const providers = [...(data?.providers ?? [])].sort((a, b) => {
      const rank = (p: ModelOptionProvider) => (p.is_current ? 0 : p.authenticated ? 1 : 2);
      return rank(a) - rank(b) || a.name.localeCompare(b.name);
    });
    return providers
      .map((provider) => {
        const models = provider.models ?? [];
        const featured = new Set(provider.featured_models ?? []);
        const ordered = [...models.filter((m) => featured.has(m)), ...models.filter((m) => !featured.has(m))];
        const providerHit = !q || provider.name.toLowerCase().includes(q) || provider.slug.includes(q);
        return { provider, data: providerHit ? ordered : ordered.filter((m) => m.toLowerCase().includes(q)) };
      })
      .filter((section) => section.data.length > 0);
  }, [data, query]);

  const pick = (next: ModelPick | null) => {
    haptic.tap();
    onSelect(next);
    onClose();
  };

  return (
    <Sheet visible={visible} onClose={onClose} title="Choose a model">
      <View style={styles.search}>
        <Icon name="search" size={16} color={colors.muted} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search models or providers"
          placeholderTextColor={colors.faint}
          keyboardAppearance={scheme}
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.searchInput}
          accessibilityLabel="Search models"
        />
      </View>

      {!data && !error ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accentText} />
          <Text style={type.small}>Loading models…</Text>
        </View>
      ) : null}

      {error && !data ? (
        <View style={styles.center}>
          <Text style={[type.small, { color: colors.danger, textAlign: "center" }]}>{error}</Text>
          <Button title="Close" variant="secondary" onPress={onClose} />
        </View>
      ) : null}

      {data ? (
        <SectionList
          style={styles.list}
          sections={sections}
          keyExtractor={(item, index) => `${item}-${index}`}
          keyboardShouldPersistTaps="handled"
          stickySectionHeadersEnabled={false}
          initialNumToRender={24}
          ListHeaderComponent={
            allowInherit ? (
              <ModelRow
                title="Use default model"
                subtitle={data.model ? `Inherits ${data.provider ?? ""} · ${data.model}` : "Inherits from your default bot"}
                selected={value === null}
                onPress={() => pick(null)}
              />
            ) : null
          }
          ListEmptyComponent={<Text style={[type.small, styles.empty]}>No models match “{query}”.</Text>}
          renderSectionHeader={({ section }) => <ProviderHeader provider={section.provider} />}
          renderItem={({ item, section }) => {
            const provider = section.provider;
            const disabled = provider.authenticated === false;
            return (
              <ModelRow
                title={item}
                selected={value?.provider === provider.slug && value.model === item}
                featured={(provider.featured_models ?? []).includes(item)}
                disabled={disabled}
                onPress={() => pick({ provider: provider.slug, model: item })}
              />
            );
          }}
        />
      ) : null}
    </Sheet>
  );
}

function ProviderHeader({ provider }: { provider: ModelOptionProvider }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const signedIn = provider.authenticated !== false;
  return (
    <View style={styles.providerHeader}>
      <Text style={styles.providerName}>{provider.name}</Text>
      {provider.is_current ? <Text style={[styles.tag, { color: colors.accentText }]}>CURRENT</Text> : null}
      {!signedIn ? <Text style={[styles.tag, { color: colors.faint }]}>NOT SIGNED IN</Text> : null}
      <View style={{ flex: 1 }} />
      <Text style={styles.slug}>{provider.slug}</Text>
    </View>
  );
}

function ModelRow({
  title,
  subtitle,
  selected,
  featured,
  disabled,
  onPress,
}: {
  title: string;
  subtitle?: string;
  selected: boolean;
  featured?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const { colors, type } = useTheme();
  const styles = useStyles();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      accessibilityLabel={title}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.row, selected && styles.rowSelected, pressed && { backgroundColor: colors.raised }, disabled && { opacity: 0.4 }]}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={[styles.rowTitle, selected && { color: colors.accentText }]}>
          {title}
        </Text>
        {subtitle ? (
          <Text numberOfLines={1} style={type.small}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {featured ? <Icon name="star" size={13} color={colors.faint} /> : null}
      {selected ? <Icon name="checkmark-circle" size={20} color={colors.accentText} /> : null}
    </Pressable>
  );
}

const useStyles = makeStyles((colors, type) => ({
  search: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    marginHorizontal: space.lg,
    marginBottom: space.sm,
    paddingHorizontal: space.md,
    height: 42,
    borderRadius: radius.md,
    backgroundColor: colors.raised,
  },
  searchInput: { flex: 1, color: colors.text, fontSize: 15, paddingVertical: 0 },
  list: { flexGrow: 0 },
  center: { alignItems: "center", gap: space.md, padding: space.xxl },
  empty: { textAlign: "center", padding: space.xl },
  providerHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    paddingHorizontal: space.xl,
    paddingTop: space.lg,
    paddingBottom: space.xs,
  },
  providerName: { ...type.caption, color: colors.textSoft },
  tag: { ...type.caption, fontSize: 10 },
  slug: { ...type.mono, fontSize: 11, color: colors.faint },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    minHeight: 48,
    marginHorizontal: space.sm,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    borderRadius: radius.md,
  },
  rowSelected: { backgroundColor: colors.overlay },
  rowTitle: { fontSize: 15, color: colors.text, fontWeight: "500" },
}));
