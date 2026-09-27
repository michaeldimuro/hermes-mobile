import React, { memo, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { Icon } from "@/ui/primitives";
import { makeStyles, radius, space, useTheme } from "@/ui/theme";
import { domainOf, parseOpenGraph, type LinkMeta } from "./og";
import { openWebLink } from "./navigation";

const TIMEOUT_MS = 6000;
const MAX_ENTRIES = 200;
const cache = new Map<string, Promise<LinkMeta>>();

/** Fetch + parse a page's Open Graph tags directly from the device; memoised in memory. Never rejects. */
export function fetchLinkMeta(url: string): Promise<LinkMeta> {
  const existing = cache.get(url);
  if (existing) return existing;
  const fallback: LinkMeta = { url, domain: domainOf(url) };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const promise = fetch(url, {
    signal: controller.signal,
    credentials: "omit",
    headers: { Accept: "text/html,application/xhtml+xml", "User-Agent": "Mozilla/5.0 (compatible; HermesMobile/1.0; +link-preview)" },
  })
    .then(async (response) => {
      const type = response.headers.get("content-type") ?? "";
      if (!response.ok || !/html/i.test(type)) return fallback;
      return parseOpenGraph(await response.text(), response.url || url);
    })
    .catch(() => fallback)
    .finally(() => clearTimeout(timer));
  if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
  cache.set(url, promise);
  return promise;
}

function useLinkMeta(url: string, enabled: boolean): LinkMeta | null {
  const [state, setState] = useState<{ key: string; meta: LinkMeta } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    fetchLinkMeta(url).then((meta) => alive && setState({ key: url, meta }));
    return () => {
      alive = false;
    };
  }, [url, enabled]);
  return state?.key === url ? state.meta : null;
}

/** Link card (OG image, site, title, description) that opens the page in the in-app browser. */
export const LinkPreview = memo(function LinkPreview({ url, enabled = true }: { url: string; enabled?: boolean }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const meta = useLinkMeta(url, enabled);
  const domain = meta?.domain ?? domainOf(url);
  const title = meta?.title ?? url;
  const [imageFailed, setImageFailed] = useState(false);
  const showImage = Boolean(meta?.image) && !imageFailed;

  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`${meta?.title ?? domain}, opens ${domain}`}
      onPress={() => openWebLink(url)}
      style={({ pressed }) => [styles.card, pressed && { opacity: 0.85 }]}
    >
      {showImage ? (
        <Image
          source={{ uri: meta?.image }}
          style={styles.image}
          contentFit="cover"
          transition={150}
          onError={() => setImageFailed(true)}
          accessibilityIgnoresInvertColors
        />
      ) : null}
      <View style={styles.body}>
        <View style={styles.site}>
          <Icon name="globe-outline" size={13} color={colors.muted} />
          <Text style={styles.domain} numberOfLines={1}>
            {meta?.siteName && meta.siteName.toLowerCase() !== domain.toLowerCase() ? `${meta.siteName} · ${domain}` : domain}
          </Text>
        </View>
        <Text style={styles.title} numberOfLines={2}>
          {title}
        </Text>
        {meta?.description ? (
          <Text style={styles.description} numberOfLines={2}>
            {meta.description}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
});

const useStyles = makeStyles((colors, type) => ({
  card: {
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
    overflow: "hidden",
    marginVertical: space.xs,
    maxWidth: 420,
  },
  image: { width: "100%", aspectRatio: 1.91, backgroundColor: colors.raised },
  body: { padding: space.md, gap: 3 },
  site: { flexDirection: "row", alignItems: "center", gap: 5 },
  domain: { ...type.small, fontSize: 12, flexShrink: 1 },
  title: { ...type.heading, fontSize: 15, lineHeight: 20 },
  description: { ...type.small },
}));
