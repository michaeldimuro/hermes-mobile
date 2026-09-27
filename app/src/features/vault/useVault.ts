import { useCallback, useEffect, useState } from "react";
import { errorText, useGateway } from "@/lib/store/GatewayProvider";
import type { VaultItem, VaultSource } from "./vaultFormat";

/** The Hermes vault (local store + password managers) — metadata only; secrets go in, never out. */
export function useVault() {
  const { call, connection, showToast } = useGateway();
  const [items, setItems] = useState<VaultItem[] | null>(null);
  const [sources, setSources] = useState<VaultSource[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    () =>
      Promise.all([
        call<{ items?: VaultItem[] }>("vault.list", {}),
        call<{ sources?: VaultSource[] }>("vault.sources", {}),
      ])
        .then(([list, src]) => {
          setItems(list.items ?? []);
          setSources(src.sources ?? []);
          setError(null);
        })
        .catch((err) => setError(errorText(err, "Couldn't load your logins"))),
    [call],
  );

  useEffect(() => {
    if (connection === "open") void load();
  }, [connection, load]);

  /** Runs a vault change, then reloads; resolves true on success (errors are toasted). */
  const change = useCallback(
    async (method: string, params: Record<string, unknown>, done?: string) => {
      try {
        await call(method, params, 60_000);
        if (done) showToast(done, "success");
        await load();
        return true;
      } catch (err) {
        showToast(errorText(err, "The vault refused that change"), "error");
        return false;
      }
    },
    [call, load, showToast],
  );

  return {
    items,
    sources,
    error,
    reload: load,
    add: (params: Record<string, unknown>) => change("vault.add", params, "Login saved"),
    remove: (item: VaultItem) => change("vault.remove", { id: item.id }, "Login removed"),
    setSource: (name: string, enabled: boolean) => change("vault.source.set", { name, enabled }),
    unlock: (name: string, password: string) => change("vault.unlock", { name, password }, "Unlocked"),
    lock: (name: string) => change("vault.lock", { name }),
  };
}
