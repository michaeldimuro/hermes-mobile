import { describe, expect, it } from "@jest/globals";
import {
  deliveryLabel,
  describeScheduleInput,
  filterSkills,
  formatClock,
  humanizeCron,
  humanizeInterval,
  humanizeSchedule,
  jobIsPaused,
  jobTitle,
  lastRunStatus,
  ordinal,
  platformName,
  platformTone,
  relativeTime,
  SCHEDULE_PRESETS,
  skillCategories,
} from "@/features/settings/format";

describe("formatClock / ordinal", () => {
  it("formats 12-hour clock times", () => {
    expect(formatClock(0, 5)).toBe("12:05 AM");
    expect(formatClock(9, 0)).toBe("9:00 AM");
    expect(formatClock(12, 0)).toBe("12:00 PM");
    expect(formatClock(17, 30)).toBe("5:30 PM");
  });
  it("builds ordinals", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23].map(ordinal)).toEqual([
      "1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd",
    ]);
  });
});

describe("humanizeInterval", () => {
  it("picks the largest whole unit", () => {
    expect(humanizeInterval(1)).toBe("Every minute");
    expect(humanizeInterval(30)).toBe("Every 30 minutes");
    expect(humanizeInterval(60)).toBe("Every hour");
    expect(humanizeInterval(120)).toBe("Every 2 hours");
    expect(humanizeInterval(1440)).toBe("Every day");
    expect(humanizeInterval(4320)).toBe("Every 3 days");
    expect(humanizeInterval(10080)).toBe("Every week");
    expect(humanizeInterval(90)).toBe("Every 90 minutes");
    expect(humanizeInterval(0)).toBe("Custom interval");
  });
});

describe("humanizeCron", () => {
  it("handles common daily/weekly/monthly shapes", () => {
    expect(humanizeCron("0 10 * * *")).toBe("Every day at 10:00 AM");
    expect(humanizeCron("0 11,13,15 * * *")).toBe("Every day at 11:00 AM, 1:00 PM, 3:00 PM");
    expect(humanizeCron("0 9 * * 1-5")).toBe("Weekdays at 9:00 AM");
    expect(humanizeCron("0 9 * * MON-FRI")).toBe("Weekdays at 9:00 AM");
    expect(humanizeCron("30 8 * * 1")).toBe("Every Monday at 8:30 AM");
    expect(humanizeCron("0 10 * * 0,6")).toBe("Weekends at 10:00 AM");
    expect(humanizeCron("0 10 * * 6-7")).toBe("Weekends at 10:00 AM");
    expect(humanizeCron("0 9 * * 1,3,5")).toBe("Mon, Wed, Fri at 9:00 AM");
    expect(humanizeCron("0 9 1 * *")).toBe("Monthly on the 1st at 9:00 AM");
  });
  it("handles sub-daily repetition", () => {
    expect(humanizeCron("*/15 * * * *")).toBe("Every 15 minutes");
    expect(humanizeCron("0 * * * *")).toBe("Every hour");
    expect(humanizeCron("15 * * * *")).toBe("Every hour at :15");
    expect(humanizeCron("0 */2 * * *")).toBe("Every 2 hours");
  });
  it("returns null for shapes it cannot describe", () => {
    expect(humanizeCron("0 9 * 1 *")).toBeNull();
    expect(humanizeCron("0 9-17 * * *")).toBeNull();
    expect(humanizeCron("nonsense")).toBeNull();
  });
});

describe("humanizeSchedule", () => {
  it("uses the structured schedule from the jobs API", () => {
    expect(humanizeSchedule({ kind: "interval", minutes: 4320, display: "every 4320m" })).toBe("Every 3 days");
    expect(humanizeSchedule({ kind: "cron", expr: "0 10 * * *", display: "0 10 * * *" })).toBe("Every day at 10:00 AM");
    expect(humanizeSchedule({ kind: "cron", expr: "0 9-17 * * *" })).toBe("0 9-17 * * *");
    const local = new Date(2026, 8, 25, 10, 0).toISOString();
    expect(humanizeSchedule({ kind: "once", run_at: local })).toBe("Once · Sep 25, 10:00 AM");
  });
  it("falls back gracefully", () => {
    expect(humanizeSchedule(null, "every 5m")).toBe("every 5m");
    expect(humanizeSchedule(undefined)).toBe("No schedule");
    expect(humanizeSchedule({ display: "weird" })).toBe("weird");
    expect(humanizeSchedule("every 2h")).toBe("Every 2 hours");
  });
});

describe("relativeTime", () => {
  const now = Date.parse("2026-09-25T12:00:00Z");
  it("describes future and past spans", () => {
    expect(relativeTime("2026-09-25T12:00:10Z", now)).toBe("now");
    expect(relativeTime("2026-09-25T11:59:50Z", now)).toBe("just now");
    expect(relativeTime("2026-09-25T12:05:00Z", now)).toBe("in 5m");
    expect(relativeTime("2026-09-25T09:00:00Z", now)).toBe("3h ago");
    expect(relativeTime("2026-09-27T12:00:00Z", now)).toBe("in 2d");
    expect(relativeTime("2026-09-25T10:00:00-04:00", now)).toBe("in 2h");
  });
  it("handles missing and invalid input", () => {
    expect(relativeTime(null, now)).toBe("Never");
    expect(relativeTime("not a date", now)).toBe("Unknown");
  });
  it("falls back to a date beyond a week", () => {
    expect(relativeTime(new Date(2026, 9, 20, 9, 0).toISOString(), now)).toBe("Oct 20, 9:00 AM");
  });
});

describe("describeScheduleInput", () => {
  it("recognises the syntaxes Hermes parse_schedule accepts", () => {
    expect(describeScheduleInput("30m")).toEqual({ ok: true, label: "Every 30 minutes" });
    expect(describeScheduleInput("every 2h")).toEqual({ ok: true, label: "Every 2 hours" });
    expect(describeScheduleInput("in 45m")).toEqual({ ok: true, label: "Once, in 45m" });
    expect(describeScheduleInput("0 9 * * 1-5")).toEqual({ ok: true, label: "Weekdays at 9:00 AM" });
    expect(describeScheduleInput("0 9-17 * * *")).toEqual({ ok: true, label: "Cron: 0 9-17 * * *" });
    expect(describeScheduleInput("every monday 9am").ok).toBe(true);
    expect(describeScheduleInput("weekdays at 9am").ok).toBe(true);
    expect(describeScheduleInput("2026-10-01T09:00").ok).toBe(true);
  });
  it("rejects empty or unrecognised input", () => {
    expect(describeScheduleInput("   ")).toEqual({ ok: false, label: null });
    expect(describeScheduleInput("whenever").ok).toBe(false);
    expect(describeScheduleInput("in soon").ok).toBe(false);
  });
  it("every preset is recognised", () => {
    for (const preset of SCHEDULE_PRESETS) expect(describeScheduleInput(preset.schedule).ok).toBe(true);
  });
});

describe("job helpers", () => {
  it("detects paused jobs", () => {
    expect(jobIsPaused({ enabled: false, state: "scheduled" })).toBe(true);
    expect(jobIsPaused({ enabled: true, state: "paused" })).toBe(true);
    expect(jobIsPaused({ enabled: true, state: "scheduled" })).toBe(false);
  });
  it("titles jobs by name, then prompt, then id", () => {
    expect(jobTitle({ id: "a1", name: " Daily brief ", prompt: "x" })).toBe("Daily brief");
    expect(jobTitle({ id: "a1", name: "", prompt: "Summarise   my inbox" })).toBe("Summarise my inbox");
    expect(jobTitle({ id: "a1", name: null, prompt: "y".repeat(80) })).toHaveLength(60);
    expect(jobTitle({ id: "a1" })).toBe("a1");
  });
  it("maps last_status values", () => {
    expect(lastRunStatus({ last_status: "ok" })).toEqual({ label: "Succeeded", tone: "success" });
    expect(lastRunStatus({ last_status: "error" }).tone).toBe("danger");
    expect(lastRunStatus({ last_status: "blocked_config" })).toEqual({ label: "Blocked by config", tone: "warn" });
    expect(lastRunStatus({ last_status: "delivery_failed" }).tone).toBe("warn");
    expect(lastRunStatus({ last_status: null })).toEqual({ label: "Never run", tone: "muted" });
    expect(lastRunStatus({ last_status: "ok", state: "running" }).label).toBe("Running");
    expect(lastRunStatus({ last_status: "some_new_state" }).label).toBe("Some New State");
  });
});

describe("delivery + platform labels", () => {
  it("describes delivery targets", () => {
    expect(deliveryLabel("local")).toBe("Saved on gateway");
    expect(deliveryLabel(null)).toBe("Saved on gateway");
    expect(deliveryLabel("origin", { platform: "discord" })).toBe("Reply in Discord");
    expect(deliveryLabel("origin")).toBe("Reply where created");
    expect(deliveryLabel("discord:1532165684010942576")).toBe("Discord channel");
    expect(deliveryLabel("telegram")).toBe("Telegram home channel");
    expect(deliveryLabel("bot-chat:analyst")).toBe("analyst chat");
    expect(deliveryLabel("local,discord")).toBe("Saved on gateway + Discord home channel");
  });
  it("names and tones platforms", () => {
    expect(platformName("discord")).toBe("Discord");
    expect(platformName("my_custom-thing")).toBe("My Custom Thing");
    expect(platformTone("connected")).toBe("success");
    expect(platformTone("reconnecting")).toBe("warn");
    expect(platformTone("fatal")).toBe("danger");
    expect(platformTone(undefined)).toBe("muted");
  });
});

describe("skills filtering", () => {
  const skills = [
    { name: "apple-notes", description: "Manage Apple Notes", category: "apple" },
    { name: "apple-reminders", description: "Reminders", category: "apple" },
    { name: "arxiv", description: "Search papers", category: "research" },
    { name: "loose", description: null, category: null },
  ];
  it("lists categories by frequency", () => {
    expect(skillCategories(skills)).toEqual(["apple", "research"]);
  });
  it("filters by query and category", () => {
    expect(filterSkills(skills, "", null)).toHaveLength(4);
    expect(filterSkills(skills, "PAPERS", null).map((s) => s.name)).toEqual(["arxiv"]);
    expect(filterSkills(skills, "", "apple").map((s) => s.name)).toEqual(["apple-notes", "apple-reminders"]);
    expect(filterSkills(skills, "notes", "apple").map((s) => s.name)).toEqual(["apple-notes"]);
    expect(filterSkills(skills, "research", null).map((s) => s.name)).toEqual(["arxiv"]);
  });
});
