/** Web: picked files arrive as data URLs; recordings as blob: URLs, read here into a data URL. */
export async function pickedFileDataUrl(asset: { uri: string; base64?: string | null; mimeType?: string | null }) {
  const raw = asset.base64 || asset.uri;
  if (raw.startsWith("data:")) return raw;
  if (raw.startsWith("blob:") || raw.startsWith("http")) {
    const blob = await (await fetch(raw)).blob();
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }
  return `data:${asset.mimeType || "application/octet-stream"};base64,${raw}`;
}

/** Browsers play `data:` URLs directly. */
export function playableUri(dataUrl: string) {
  return dataUrl;
}
