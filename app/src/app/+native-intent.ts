/** Content shared from other apps (expo-sharing) lands on the share screen; everything else passes through. */
export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  try {
    if (new URL(path).hostname === "expo-sharing") return "/share";
    return path;
  } catch {
    return path;
  }
}
