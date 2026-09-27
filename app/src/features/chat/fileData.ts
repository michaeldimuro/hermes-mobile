import { File, Paths } from "expo-file-system";

/** A picked document or a recording as a `data:` URL (native: read from its local file). */
export async function pickedFileDataUrl(asset: { uri: string; mimeType?: string | null }) {
  const base64 = await new File(asset.uri).base64();
  return `data:${asset.mimeType || "application/octet-stream"};base64,${base64}`;
}

/** Something a native audio player can open for a `data:` URL: a cache file holding its bytes. */
export function playableUri(dataUrl: string, name: string) {
  const comma = dataUrl.indexOf(",");
  const ext = /audio\/(wav|x-wav)/.test(dataUrl.slice(0, comma)) ? "wav" : /ogg/.test(dataUrl.slice(0, comma)) ? "ogg" : "mp3";
  const file = new File(Paths.cache, `${name}.${ext}`);
  file.write(dataUrl.slice(comma + 1), { encoding: "base64" });
  return file.uri;
}
