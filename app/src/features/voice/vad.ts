/**
 * End-of-turn detection from the recorder's level meter (dBFS, about -160 silent to 0 loudest).
 * The noise floor adapts to the room, so a noisy café doesn't count as speech and a quiet voice
 * in a quiet room still does.
 */
export type VadOptions = {
  /** The first moments of each recording only measure the room (people rarely start instantly). */
  calibrateMs: number;
  /** Levels this far above the room's noise floor count as speech. */
  marginDb: number;
  /** ...but never below this absolute level. */
  minLevelDb: number;
  /** Loud time needed before it's speech (a cough or a door isn't). */
  minSpeechMs: number;
  /** Quiet after speech that ends the turn. */
  endSilenceMs: number;
  /** Nobody spoke for this long: start a fresh recording (keeps files small). */
  idleMs: number;
  /** A single turn never runs longer than this. */
  maxMs: number;
};

export const VAD_DEFAULTS: VadOptions = {
  calibrateMs: 400,
  marginDb: 14,
  minLevelDb: -48,
  minSpeechMs: 220,
  endSilenceMs: 1100,
  idleMs: 15_000,
  maxMs: 90_000,
};

export type VadState = {
  floorDb: number;
  speaking: boolean;
  heardMs: number;
  quietMs: number;
  elapsedMs: number;
};

export type VadEvent = "none" | "end" | "idle";

/** Pass the previous turn's floor so the room doesn't have to be re-learned every turn. */
export const createVad = (floorDb = -60): VadState => ({ floorDb, speaking: false, heardMs: 0, quietMs: 0, elapsedMs: 0 });

const clampFloor = (db: number) => Math.max(-70, Math.min(-25, db));

/** Feed one meter reading taken `dtMs` after the previous one. */
export function stepVad(
  state: VadState,
  levelDb: number | undefined,
  dtMs: number,
  options: VadOptions = VAD_DEFAULTS,
): { state: VadState; event: VadEvent } {
  const level = typeof levelDb === "number" && Number.isFinite(levelDb) ? levelDb : -160;
  const next = { ...state, elapsedMs: state.elapsedMs + dtMs };
  if (state.elapsedMs < options.calibrateMs) {
    next.floorDb = clampFloor(state.floorDb + (level - state.floorDb) * 0.3);
    return { state: next, event: "none" };
  }
  const loud = level > Math.max(options.minLevelDb, state.floorDb + options.marginDb);
  if (loud) {
    next.heardMs += dtMs;
    next.quietMs = 0;
    if (next.heardMs >= options.minSpeechMs) next.speaking = true;
  } else {
    // Track the room's floor from quiet readings only; clamp so silence can't drag it to -160.
    next.floorDb = clampFloor(state.floorDb + (level - state.floorDb) * 0.08);
    next.quietMs += dtMs;
    if (!next.speaking) next.heardMs = Math.max(0, next.heardMs - dtMs);
  }
  let event: VadEvent = "none";
  if (next.speaking && (next.quietMs >= options.endSilenceMs || next.elapsedMs >= options.maxMs)) event = "end";
  else if (!next.speaking && next.elapsedMs >= options.idleMs) event = "idle";
  return { state: next, event };
}
