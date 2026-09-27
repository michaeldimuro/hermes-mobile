import { useCallback, useEffect, useRef, useState } from "react";
import { errorText, useGateway } from "@/lib/store/GatewayProvider";
import { haptic } from "@/ui/primitives";
import { jobTitle } from "./format";
import type { CronJob, CronJobCreateBody, DeliveryTarget } from "./types";

const jobPath = (job: CronJob, action = "") =>
  `/api/cron/jobs/${encodeURIComponent(job.id)}${action ? `/${action}` : ""}` +
  (job.profile ? `?profile=${encodeURIComponent(job.profile)}` : "");

/**
 * Hermes cron jobs across every profile (GET /api/cron/jobs?profile=all), kept live by the
 * `cron.changed` WS event. Per-job calls carry the owning profile as a hint (the server
 * falls back to locating the job itself).
 */
export function useAutomations() {
  const { get, client, connection, showToast } = useGateway();
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState<Set<string>>(new Set());
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Fetch the job list; callers own flipping `loading`/`refreshing` on first. State is only set
   *  in promise callbacks (never synchronously), so effects can call this directly. */
  const fetchJobs = useCallback(
    (): Promise<void> =>
      get<CronJob[]>("/api/cron/jobs?profile=all")
        .then((rows) => {
          setJobs(Array.isArray(rows) ? rows : []);
          setError(null);
        })
        .catch((err) => setError(errorText(err, "Could not load automations.")))
        .finally(() => {
          setLoading(false);
          setRefreshing(false);
        }),
    [get],
  );

  const load = useCallback(
    async (mode: "initial" | "refresh" | "silent" = "initial") => {
      if (mode === "refresh") setRefreshing(true);
      if (mode === "initial") setLoading(true);
      await fetchJobs();
    },
    [fetchJobs],
  );

  // Initial load while the socket is down, silent reload once it opens. The spinner for the
  // "initial" case flips on during render when the socket drops; the effect only fetches.
  const isOpen = connection === "open";
  const [prevOpen, setPrevOpen] = useState(isOpen);
  if (isOpen !== prevOpen) {
    setPrevOpen(isOpen);
    if (!isOpen) setLoading(true);
  }
  useEffect(() => {
    fetchJobs();
  }, [fetchJobs, isOpen]);

  useEffect(() => {
    if (!client) return;
    const off = client.onEvent((event) => {
      if (event.type !== "cron.changed") return;
      if (debounce.current) clearTimeout(debounce.current);
      debounce.current = setTimeout(() => load("silent"), 350);
    });
    return () => {
      off();
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [client, load]);

  const replace = (next: CronJob) =>
    setJobs((rows) => rows.map((j) => (j.id === next.id && j.profile === next.profile ? { ...j, ...next } : j)));

  const setPaused = useCallback(
    async (job: CronJob, pause: boolean) => {
      try {
        const next = await get<CronJob>(jobPath(job, pause ? "pause" : "resume"), { method: "POST" });
        if (next?.id) replace({ ...next, profile: next.profile ?? job.profile });
        haptic.success();
        showToast(`${jobTitle(job)} ${pause ? "paused" : "resumed"}`, "success");
      } catch (err) {
        haptic.warn();
        showToast(errorText(err, `Could not ${pause ? "pause" : "resume"} this automation.`), "error");
      }
    },
    [get, showToast],
  );

  const remove = useCallback(
    async (job: CronJob) => {
      const before = jobs;
      setJobs((rows) => rows.filter((j) => !(j.id === job.id && j.profile === job.profile)));
      try {
        await get(jobPath(job), { method: "DELETE" });
        haptic.success();
        showToast(`Deleted ${jobTitle(job)}`, "success");
      } catch (err) {
        setJobs(before);
        haptic.warn();
        showToast(errorText(err, "Could not delete this automation."), "error");
      }
    },
    [get, jobs, showToast],
  );

  /** The trigger endpoint blocks until the run finishes (can be minutes), so it runs in the
   *  background with its own never-firing abort signal, bypassing rest()'s 10s timeout. */
  const runNow = useCallback(
    (job: CronJob) => {
      const key = `${job.profile}:${job.id}`;
      setRunning((s) => new Set(s).add(key));
      showToast(`Running ${jobTitle(job)}…`, "info");
      const longLived = new AbortController();
      get<CronJob>(jobPath(job, "trigger"), { method: "POST", signal: longLived.signal })
        .then((next) => {
          if (next?.id) replace({ ...next, profile: next.profile ?? job.profile });
          const failed = next?.last_status && next.last_status !== "ok";
          showToast(
            failed ? `${jobTitle(job)} finished: ${next.last_error || next.last_status}` : `${jobTitle(job)} finished`,
            failed ? "warn" : "success",
          );
        })
        .catch((err) => showToast(errorText(err, "Could not run this automation."), "error"))
        .finally(() =>
          setRunning((s) => {
            const n = new Set(s);
            n.delete(key);
            return n;
          }),
        );
    },
    [get, showToast],
  );

  const create = useCallback(
    async (profile: string, body: CronJobCreateBody) => {
      const job = await get<CronJob>(`/api/cron/jobs?profile=${encodeURIComponent(profile)}`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      haptic.success();
      showToast(`Scheduled ${jobTitle(job ?? { id: "", ...body })}`, "success");
      load("silent");
      return job;
    },
    [get, load, showToast],
  );

  const deliveryTargets = useCallback(
    async (profile: string) => {
      const res = await get<{ targets?: DeliveryTarget[] }>(
        `/api/cron/delivery-targets?profile=${encodeURIComponent(profile)}`,
      );
      return res?.targets ?? [];
    },
    [get],
  );

  const isRunning = useCallback((job: CronJob) => running.has(`${job.profile}:${job.id}`), [running]);

  return {
    jobs,
    loading,
    refreshing,
    error,
    refresh: () => load("refresh"),
    setPaused,
    remove,
    runNow,
    isRunning,
    create,
    deliveryTargets,
  };
}
