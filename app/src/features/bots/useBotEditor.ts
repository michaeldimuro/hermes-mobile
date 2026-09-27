import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert } from "react-native";
import { errorText, useGateway } from "@/lib/store/GatewayProvider";
import type { CapabilityEntry, ProfileDescription } from "@/lib/gateway/types";
import { haptic } from "@/ui/primitives";
import { sameSet } from "./format";
import type { ModelPick } from "./ModelSheet";

export type Draft = {
  soul: string;
  description: string;
  model: ModelPick | null;
  disabledSkills: Set<string>;
  enabledToolsets: Set<string>;
  enabledMcp: Set<string>;
};

type ConfigureResult = {
  ok: boolean;
  applied?: Record<string, unknown>;
  confirm_required?: boolean | null;
  confirm_message?: string | null;
};

const names = (list: CapabilityEntry[] | undefined, enabled: boolean) =>
  new Set((list ?? []).filter((entry) => (entry.enabled ?? true) === enabled).map((entry) => entry.name));

function toDraft(d: ProfileDescription): Draft {
  return {
    soul: d.soul ?? "",
    description: d.description ?? "",
    model: d.model?.default ? { provider: d.model.provider ?? "", model: d.model.default } : null,
    disabledSkills: names(d.skills, false),
    enabledToolsets: names(d.toolsets, true),
    enabledMcp: names(d.mcp_servers, true),
  };
}

/** Skills can repeat across category folders; the editor treats a name as one switch. */
function dedupe(list: CapabilityEntry[] | undefined) {
  const seen = new Map<string, CapabilityEntry>();
  for (const entry of list ?? []) if (!seen.has(entry.name)) seen.set(entry.name, entry);
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

const confirmAsync = (message: string) =>
  new Promise<boolean>((resolve) =>
    Alert.alert("Confirm model", message, [
      { text: "Keep current", style: "cancel", onPress: () => resolve(false) },
      { text: "Use this model", onPress: () => resolve(true) },
    ], { cancelable: true, onDismiss: () => resolve(false) }),
  );

export function useBotEditor(name: string) {
  const { call, refreshProfiles, showToast, connection } = useGateway();
  const [base, setBase] = useState<ProfileDescription | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  /** Fetch the profile; callers own flipping `loading` on first. State is only set in promise
   *  callbacks (never synchronously), so effects can call this directly. */
  const fetchProfile = useCallback((): Promise<void> => {
    if (!name) return Promise.resolve();
    return Promise.resolve()
      .then(() => call<ProfileDescription>("profiles.describe", { name }, 30_000))
      .then((result) => {
        const clean = { ...result, skills: dedupe(result.skills) };
        setBase(clean);
        setDraft(toDraft(clean));
        setLoadError(null);
      })
      .catch((err) => {
        const message = errorText(err, "Could not load this bot");
        setLoadError(message);
        showToast(message, "error");
      })
      .finally(() => setLoading(false));
  }, [call, name, showToast]);

  const load = useCallback(async () => {
    if (!name) return;
    setLoading(true);
    await fetchProfile();
  }, [fetchProfile, name]);

  // Auto-load once the socket is open and nothing has loaded yet. `loading` flips on during
  // render when that condition starts to hold; the effect then only does the fetch.
  const autoLoad = connection === "open" && !base && Boolean(name);
  const [prevAutoLoad, setPrevAutoLoad] = useState(false);
  if (autoLoad !== prevAutoLoad) {
    setPrevAutoLoad(autoLoad);
    if (autoLoad) setLoading(true);
  }

  useEffect(() => {
    if (autoLoad) fetchProfile();
  }, [autoLoad, fetchProfile]);

  const original = useMemo(() => (base ? toDraft(base) : null), [base]);

  const changed = useMemo(() => {
    if (!draft || !original) return [] as (keyof Draft)[];
    const out: (keyof Draft)[] = [];
    if (draft.soul !== original.soul) out.push("soul");
    if (draft.description.trim() !== original.description.trim()) out.push("description");
    if (draft.model?.provider !== original.model?.provider || draft.model?.model !== original.model?.model) out.push("model");
    if (!sameSet(draft.disabledSkills, original.disabledSkills)) out.push("disabledSkills");
    if (!sameSet(draft.enabledToolsets, original.enabledToolsets)) out.push("enabledToolsets");
    if (!sameSet(draft.enabledMcp, original.enabledMcp)) out.push("enabledMcp");
    return out;
  }, [draft, original]);

  const update = useCallback(<K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((prev) => (prev ? { ...prev, [key]: value } : prev));
  }, []);

  /** Flip one member of a set-valued field. */
  const toggle = useCallback((key: "disabledSkills" | "enabledToolsets" | "enabledMcp", item: string, on: boolean) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const next = new Set(prev[key]);
      if (on) next.add(item);
      else next.delete(item);
      return { ...prev, [key]: next };
    });
  }, []);

  const discard = useCallback(() => {
    if (original) setDraft(original);
  }, [original]);

  const save = useCallback(async () => {
    if (!draft || changed.length === 0 || saving) return;
    // Only declared keys, only for sections that changed (the server rejects unknown params and
    // list fields use replace semantics).
    const params: Record<string, unknown> = { name };
    if (changed.includes("soul")) params.soul = draft.soul;
    if (changed.includes("description")) params.description = draft.description.trim();
    if (changed.includes("model") && draft.model) {
      params.model = draft.model.model;
      params.provider = draft.model.provider;
    }
    if (changed.includes("disabledSkills")) params.disabled_skills = [...draft.disabledSkills];
    if (changed.includes("enabledToolsets")) params.enabled_toolsets = [...draft.enabledToolsets];
    if (changed.includes("enabledMcp")) params.enabled_mcp_servers = [...draft.enabledMcp];

    setSaving(true);
    try {
      let result = await call<ConfigureResult>("profiles.configure", params, 45_000);
      let modelDeclined = false;
      if (result.confirm_required) {
        // Every other section has already been written; only the guarded model pick is pending.
        const ok = await confirmAsync(result.confirm_message || "This model needs confirmation before use.");
        if (ok) {
          result = await call<ConfigureResult>(
            "profiles.configure",
            { name, model: params.model, provider: params.provider, confirm_expensive_model: true },
            45_000,
          );
        } else {
          modelDeclined = true;
        }
      }
      const failed = Object.entries(result.applied ?? {})
        .filter(([key, value]) => value === false && !key.startsWith("ui_meta"))
        .map(([key]) => key.replace(/_/g, " "));
      await Promise.all([load(), refreshProfiles()]);
      if (failed.length) {
        haptic.warn();
        showToast(`Couldn't apply: ${failed.join(", ")}`, "warn");
      } else {
        haptic.success();
        showToast(modelDeclined ? "Saved. The model stayed the same." : "Saved", "success");
      }
    } catch (err) {
      haptic.warn();
      showToast(errorText(err, "Could not save changes"), "error");
    } finally {
      setSaving(false);
    }
  }, [call, changed, draft, load, name, refreshProfiles, saving, showToast]);

  return { base, draft, loading, loadError, saving, changed, update, toggle, discard, save, reload: load };
}
