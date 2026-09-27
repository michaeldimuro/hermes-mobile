import type { IconName } from "@/ui/primitives";
import { extensionOf, type MediaKind } from "./kinds";

export function kindIcon(kind: MediaKind): IconName {
  switch (kind) {
    case "image":
      return "image-outline";
    case "video":
      return "film-outline";
    case "audio":
      return "musical-notes-outline";
    case "pdf":
      return "document-text-outline";
    case "markdown":
      return "reader-outline";
    case "text":
      return "code-slash-outline";
    case "html":
      return "globe-outline";
    default:
      return "document-outline";
  }
}

export function kindLabel(kind: MediaKind, name: string): string {
  const ext = extensionOf(name).toUpperCase();
  const labels: Record<MediaKind, string> = {
    image: "Image",
    video: "Video",
    audio: "Audio",
    pdf: "PDF",
    markdown: "Markdown",
    text: ext || "Text",
    html: "Web page",
    other: ext ? `${ext} file` : "File",
  };
  return labels[kind];
}
