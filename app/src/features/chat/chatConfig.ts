/** Pure helpers for the chat reducer: config.set patches, `@file:` refs, and side-item placement. */
import type { SessionLiveInfo } from "@/lib/gateway/types";
import type { TimelineItem } from "./chatReducer";

export type ConfigKey = "reasoning" | "fast" | "model" | "yolo";
export type ConfigSetResult = { key?: string; value?: unknown; confirm_required?: boolean | null; confirm_message?: string | null };

/**
 * `config.set` answers with the applied value but only some keys emit `session.info`, so the UI
 * patches its own copy. Returns null when nothing was applied (e.g. a model awaiting confirmation).
 */
export function configPatch(key: ConfigKey, requested: string, result: ConfigSetResult | null | undefined): Partial<SessionLiveInfo> | null {
  if (result?.confirm_required) return null;
  const applied = result?.value == null || result.value === "" ? requested : String(result.value);
  switch (key) {
    case "reasoning":
      return { reasoning_effort: applied };
    case "fast":
      return { fast: applied === "fast" || applied === "priority" };
    case "yolo":
      return { yolo: ["1", "on", "true"].includes(applied.toLowerCase()) };
    case "model": {
      const provider = /--provider\s+(\S+)/.exec(requested)?.[1];
      const model = applied.replace(/\s*--provider\s+\S+/, "").trim();
      return provider ? { model, provider } : { model };
    }
  }
}

/** `@file:` references the app appended when sending documents: shown as file chips, not text. */
export function splitFileRefs(text: string) {
  const files: string[] = [];
  const body = text
    .replace(/@file:(?:`([^`]+)`|"([^"]+)"|'([^']+)'|(\S+))/g, (_match, ticked, double, single, bare) => {
      const path = String(ticked ?? double ?? single ?? bare);
      files.push(path.split("/").pop() || path);
      return "";
    })
    .trim();
  return { body: body || (files.length ? "" : text), files };
}

/** Re-insert local-only items (side answers, notices) after the message they originally followed. */
export function mergeSides(items: TimelineItem[], sides: TimelineItem[], previous: TimelineItem[]) {
  const out = items.slice();
  for (const side of sides) {
    const index = previous.indexOf(side);
    const before = previous.slice(0, index).filter((item) => item.kind === "user").length;
    let seen = 0;
    let at = out.length;
    for (let i = 0; i < out.length; i++) {
      if (out[i].kind === "user" && ++seen > before) {
        at = i;
        break;
      }
    }
    out.splice(at, 0, side);
  }
  return out;
}
