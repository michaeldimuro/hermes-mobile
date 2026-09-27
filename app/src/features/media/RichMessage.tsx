import React, { memo, useEffect, useMemo, useState } from "react";
import { Text, View } from "react-native";
import Markdown, { type ASTNode, type MarkdownProps, type RenderRules } from "react-native-markdown-display";
import { space } from "@/ui/theme";
import { AttachmentCard } from "./AttachmentCard";
import { detectAttachments, resolveHref } from "./detect";
import { InlineImage } from "./InlineImage";
import { kindOf } from "./kinds";
import { LinkPreview } from "./LinkPreview";
import { markdownParser } from "./markdown";
import { openViewer, openWebLink } from "./navigation";
import { CodeBlock } from "./CodeBlock";

export type RichMessageProps = {
  /** Raw assistant markdown (may contain `MEDIA:` directives). */
  text: string;
  /** Hermes profile (bot) that owns the session — scopes gateway file access. */
  profile: string;
  /** Session id: lets the gateway resolve session-relative paths and validates ownership. */
  sessionId?: string | null;
  /** Chat markdown theme (react-native-markdown-display style object). */
  markdownStyle: object;
  selectable?: boolean;
  /** True while the reply is still streaming: no downloads / previews until it settles. */
  streaming?: boolean;
};

const SETTLE_MS = 800;
const MAX_PREVIEWS = 2;

/** True once `text` has stopped changing for SETTLE_MS and the reply is no longer streaming. */
function useSettled(text: string, streaming: boolean) {
  const [settled, setSettled] = useState<string | null>(null);
  useEffect(() => {
    if (streaming) return;
    const timer = setTimeout(() => setSettled(text), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [text, streaming]);
  return !streaming && settled === text;
}

function useRules(profile: string, sessionId: string | null | undefined, deferred: boolean, selectable: boolean): RenderRules {
  return useMemo<RenderRules>(
    () => ({
      image: (node: ASTNode) => {
        const src = String(node.attributes.src ?? "");
        const alt = typeof node.attributes.alt === "string" ? node.attributes.alt : undefined;
        const target = resolveHref(src);
        if (target.type === "file")
          return <InlineImage key={node.key} path={target.path} alt={alt} profile={profile} sessionId={sessionId} deferred={deferred} />;
        if (target.type === "remote-file" || target.type === "web")
          return <InlineImage key={node.key} url={target.url} alt={alt} deferred={deferred} />;
        return null;
      },
      fence: (node: ASTNode) => {
        const code = String(node.content ?? "").replace(/\n$/, "");
        // The fence's info string (language); set by the parser but missing from ASTNode's type.
        const info = (node as ASTNode & { sourceInfo?: unknown }).sourceInfo;
        const language = typeof info === "string" ? info : undefined;
        return <CodeBlock key={node.key} code={code} language={language} />;
      },
      ...(selectable
        ? {
            textgroup: (node: ASTNode, children: React.ReactNode[], _parents: ASTNode[], styles: Record<string, object>) => (
              <Text key={node.key} style={styles.textgroup} selectable>
                {children}
              </Text>
            ),
          }
        : {}),
    }),
    [profile, sessionId, deferred, selectable],
  );
}

/**
 * Drop-in replacement for the chat `<Markdown>`: renders the reply (plain URLs linkified, links open
 * in the in-app browser or the file viewer, gateway/local images inline), then cards for files the
 * bot shared (`MEDIA:` directives, file links, bare paths), then up to two link previews.
 */
export const RichMessage = memo(function RichMessage({
  text,
  profile,
  sessionId,
  markdownStyle,
  selectable = false,
  streaming = false,
}: RichMessageProps): React.JSX.Element {
  const detection = useMemo(() => detectAttachments(text), [text]);
  const settled = useSettled(text, streaming);
  const rules = useRules(profile, sessionId, streaming, selectable);
  const previews = useMemo(
    () => (settled ? detection.links.slice(0, MAX_PREVIEWS) : []),
    [settled, detection.links],
  );

  const onLinkPress = (url: string) => {
    const target = resolveHref(url);
    if (target.type === "file") openViewer({ path: target.path, kind: kindOf(target.path), profile, sessionId });
    else if (target.type === "remote-file") openViewer({ url: target.url, kind: kindOf(target.url) });
    else if (target.type === "web") openWebLink(target.url);
    return false;
  };

  return (
    <View>
      {detection.text ? (
        <Markdown
          style={markdownStyle as MarkdownProps["style"]}
          mergeStyle
          markdownit={markdownParser}
          rules={rules}
          onLinkPress={onLinkPress}
        >
          {detection.text}
        </Markdown>
      ) : null}
      {detection.attachments.length ? (
        <View style={{ gap: space.xs, marginTop: space.xs }}>
          {detection.attachments.map((attachment) => (
            <AttachmentCard
              key={attachment.key}
              attachment={attachment}
              profile={profile}
              sessionId={sessionId}
              deferred={streaming}
            />
          ))}
        </View>
      ) : null}
      {previews.length ? (
        <View style={{ gap: space.xs, marginTop: space.xs }}>
          {previews.map((url) => (
            <LinkPreview key={url} url={url} />
          ))}
        </View>
      ) : null}
    </View>
  );
});
