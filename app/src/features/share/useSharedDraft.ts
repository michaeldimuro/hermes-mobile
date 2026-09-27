import { useEffect } from "react";
import { pickedFileDataUrl } from "@/features/chat/fileData";
import { shareDraft, takeShare } from "./pendingShare";

type Attach = {
  image: (image: { uri: string; base64: string; fileName?: string | null }) => Promise<void> | void;
  file: (file: { name: string; dataUrl?: string }) => Promise<void> | void;
};

/** A new chat opened from the share sheet: prefill the composer and attach what was shared. */
export function useSharedDraft(bot: string, enabled: boolean, setDraft: (text: string) => void, attach: Attach) {
  useEffect(() => {
    if (!enabled) return;
    const share = takeShare(bot);
    if (!share) return;
    const text = shareDraft(share);
    if (text) setDraft(text);
    void (async () => {
      for (const item of share.items) {
        if (item.kind !== "image" && item.kind !== "file") continue;
        try {
          const dataUrl = await pickedFileDataUrl({ uri: item.value, mimeType: item.mimeType });
          const name = item.name || item.value.split("/").pop() || (item.kind === "image" ? "photo.jpg" : "file");
          if (item.kind === "image") await attach.image({ uri: item.value, base64: dataUrl.slice(dataUrl.indexOf(",") + 1), fileName: name });
          else await attach.file({ name, dataUrl });
        } catch {
          // Unreadable share (revoked permission); the rest still goes through.
        }
      }
    })();
    // Runs once per opened chat: the staged share is consumed on first read.
  }, [bot, enabled, setDraft, attach]);
}
