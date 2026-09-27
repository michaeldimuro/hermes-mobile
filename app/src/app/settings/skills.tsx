import React, { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { router } from "expo-router";
import { useGateway } from "@/lib/store/GatewayProvider";
import { Button, Chip, EmptyState, Icon, ScreenHeader } from "@/ui/primitives";
import { makeStyles, radius, space, useTheme } from "@/ui/theme";
import { BotChips, botLabel } from "@/features/settings/BotChips";
import { filterSkills, skillCategories, titleCase } from "@/features/settings/format";
import { SkillRow } from "@/features/settings/SkillRow";
import type { Skill } from "@/features/settings/types";
import { useSkills } from "@/features/settings/useSkills";

export default function SkillsScreen() {
  const { profiles, activeBot } = useGateway();
  const styles = useStyles();
  const { colors, type, scheme } = useTheme();
  const [bot, setBot] = useState(activeBot);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const { skills, loading, refreshing, error, refresh, toggle } = useSkills(bot);

  const categories = useMemo(() => skillCategories(skills), [skills]);
  const visible = useMemo(() => filterSkills(skills, query, category), [skills, query, category]);
  const enabledCount = useMemo(() => skills.filter((s) => s.enabled).length, [skills]);
  const botName = profiles.find((p) => p.name === bot);

  const selectBot = (name: string) => {
    setBot(name);
    setCategory(null);
  };

  const renderItem = useCallback(
    ({ item, index }: { item: Skill; index: number }) => (
      <View
        style={[
          styles.itemWrap,
          index === 0 && styles.first,
          index === visible.length - 1 && styles.last,
        ]}
      >
        <SkillRow skill={item} onToggle={toggle} />
      </View>
    ),
    [toggle, visible.length, styles],
  );

  const header = (
    <View style={styles.controls}>
      {profiles.length > 1 ? (
        <BotChips profiles={profiles} value={bot} onChange={selectBot} />
      ) : null}
      <View style={styles.search}>
        <Icon name="search" size={17} color={colors.muted} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search skills"
          placeholderTextColor={colors.faint}
          keyboardAppearance={scheme}
          style={styles.searchInput}
          autoCapitalize="none"
          autoCorrect={false}
          clearButtonMode="while-editing"
          returnKeyType="search"
          accessibilityLabel="Search skills"
        />
        {query ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Clear search" hitSlop={8} onPress={() => setQuery("")}>
            <Icon name="close-circle" size={17} color={colors.faint} />
          </Pressable>
        ) : null}
      </View>
      {categories.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.chips}
        >
          <Chip label="All" active={category === null} onPress={() => setCategory(null)} />
          {categories.map((c) => (
            <Chip key={c} label={titleCase(c)} active={category === c} onPress={() => setCategory(category === c ? null : c)} />
          ))}
        </ScrollView>
      ) : null}
      {error && skills.length > 0 ? <Text style={[type.small, styles.inlineError]}>{error}</Text> : null}
    </View>
  );

  const empty = loading ? (
    <ActivityIndicator style={{ marginTop: space.xxl }} color={colors.muted} />
  ) : error ? (
    <EmptyState
      icon="cloud-offline-outline"
      title="Couldn't load skills"
      body={error}
      action={<Button title="Try again" variant="secondary" onPress={refresh} />}
    />
  ) : (
    <EmptyState
      icon="sparkles-outline"
      title={skills.length ? "No matching skills" : "No skills installed"}
      body={skills.length ? "Try a different search or category." : `${botName ? botLabel(botName) : bot} has no skills yet.`}
    />
  );

  return (
    <View style={styles.screen}>
      <ScreenHeader
        title="Skills"
        subtitle={skills.length ? `${enabledCount} of ${skills.length} enabled · ${botName ? botLabel(botName) : bot}` : undefined}
        onBack={() => router.back()}
      />
      <FlatList
        data={visible}
        keyExtractor={(s) => s.name}
        renderItem={renderItem}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        ItemSeparatorComponent={Separator}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={styles.list}
        initialNumToRender={20}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.muted} />}
      />
    </View>
  );
}

function Separator() {
  const styles = useStyles();
  return (
    <View style={styles.sepWrap}>
      <View style={styles.sep} />
    </View>
  );
}

const useStyles = makeStyles((colors, type) => ({
  screen: { flex: 1, backgroundColor: colors.bg },
  list: { paddingBottom: space.xxl * 2 },
  controls: { gap: space.md, paddingTop: space.sm, paddingBottom: space.lg },
  search: {
    marginHorizontal: space.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    height: 42,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.raised,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  searchInput: { flex: 1, color: colors.text, fontSize: 16, paddingVertical: 0 },
  chips: { gap: space.sm, paddingHorizontal: space.lg },
  inlineError: { color: colors.danger, paddingHorizontal: space.lg },
  itemWrap: {
    marginHorizontal: space.lg,
    overflow: "hidden",
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  first: { borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, borderTopWidth: StyleSheet.hairlineWidth },
  last: { borderBottomLeftRadius: radius.lg, borderBottomRightRadius: radius.lg, borderBottomWidth: StyleSheet.hairlineWidth },
  sepWrap: {
    marginHorizontal: space.lg,
    backgroundColor: colors.surface,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: space.lg },
}));
