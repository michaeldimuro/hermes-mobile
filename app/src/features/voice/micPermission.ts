import { Platform } from "react-native";
import { getRecordingPermissionsAsync, requestRecordingPermissionsAsync } from "expo-audio";

export const MIC_OFF_MESSAGE =
  "The microphone is off for Hermes. Turn it on in Settings → Hermes Mobile. No Microphone switch there? Install the latest Hermes build.";

/**
 * iOS kills an app that asks for the microphone when its build has no NSMicrophoneUsageDescription.
 * Reading the status never crashes (without the key it just reports "denied"), so on iOS only ask
 * when the system would really show its prompt.
 */
export async function ensureMicPermission() {
  const current = await getRecordingPermissionsAsync();
  if (current.granted) return true;
  if (Platform.OS === "ios" && current.status !== "undetermined") return false;
  return (await requestRecordingPermissionsAsync()).granted;
}
