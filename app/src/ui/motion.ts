import { cubicBezier, Easing, Keyframe } from "react-native-reanimated";

/**
 * Shared motion vocabulary. UI motion stays under 300ms, enters and exits with a strong ease-out,
 * and never starts from scale(0). Layout-animation builders live at module scope (not in JSX).
 */
export const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
export const EASE_IN_OUT = Easing.bezier(0.77, 0, 0.175, 1);
export const EASE_SHEET = Easing.bezier(0.32, 0.72, 0, 1);
/** The same ease-out for Reanimated CSS transitions (they need the helper, not a "cubic-bezier()" string). */
export const EASE_OUT_CSS = cubicBezier(0.23, 1, 0.32, 1);

/** Icon swap in place (send ↔ stop): a quick settle from 85%, never from nothing. */
export const SWAP_IN = new Keyframe({
  0: { opacity: 0, transform: [{ scale: 0.85 }] },
  100: { opacity: 1, transform: [{ scale: 1 }], easing: EASE_OUT },
}).duration(150);

/** A new chat message: an 8px rise and fade, fast because it happens with every exchange. */
export const MESSAGE_IN = new Keyframe({
  0: { opacity: 0, transform: [{ translateY: 8 }] },
  100: { opacity: 1, transform: [{ translateY: 0 }], easing: EASE_OUT },
}).duration(180);

/** Cards that interrupt the conversation (approvals, questions, live activity). */
export const CARD_IN = new Keyframe({
  0: { opacity: 0, transform: [{ translateY: 12 }, { scale: 0.98 }] },
  100: { opacity: 1, transform: [{ translateY: 0 }, { scale: 1 }], easing: EASE_OUT },
}).duration(220);
export const CARD_OUT = new Keyframe({
  0: { opacity: 1 },
  100: { opacity: 0, easing: EASE_OUT },
}).duration(150);
