import { detectAttachments, detectToolFiles, gatewayPathFromUrl, resolveHref, splitFences } from "@/features/media/detect";
import { extensionOf, fileNameOf, formatBytes, kindOf, mimeOf } from "@/features/media/kinds";

describe("kinds", () => {
  it("classifies by extension", () => {
    expect(kindOf("/tmp/a.PNG")).toBe("image");
    expect(kindOf("/tmp/clip.mov")).toBe("video");
    expect(kindOf("/tmp/voice.opus")).toBe("audio");
    expect(kindOf("/tmp/report.pdf")).toBe("pdf");
    expect(kindOf("/tmp/notes.md")).toBe("markdown");
    expect(kindOf("/tmp/data.json")).toBe("text");
    expect(kindOf("/tmp/page.html")).toBe("html");
    expect(kindOf("/tmp/archive.zip")).toBe("other");
    expect(kindOf("https://x.com/a.jpg?w=2#f")).toBe("image");
  });
  it("derives names, extensions, mime and sizes", () => {
    expect(fileNameOf("/a/b/My%20File.pdf")).toBe("My File.pdf");
    expect(fileNameOf("https://x.com/p/q.png?x=1")).toBe("q.png");
    expect(extensionOf("/a/.env")).toBe("");
    expect(mimeOf("a.csv")).toBe("text/csv");
    expect(mimeOf("a.py")).toBe("text/plain");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(730221)).toBe("713 KB");
    expect(formatBytes(null)).toBe("");
  });
});

describe("splitFences", () => {
  it("round-trips text and marks code", () => {
    const text = "a\n```js\nMEDIA:/x.png\n```\nb";
    const segments = splitFences(text);
    expect(segments.map((s) => s.text).join("")).toBe(text);
    expect(segments.map((s) => s.code)).toEqual([false, true, false]);
  });
  it("treats an unclosed (streaming) fence as code", () => {
    expect(splitFences("x\n```\nopen").at(-1)?.code).toBe(true);
  });
});

describe("detectAttachments", () => {
  it("extracts MEDIA lines (incl. spaces) and strips them from the text", () => {
    const text = "Here you go.\n\n## Image\nMEDIA:/Users/me/AI Brain/report final.pdf\nMEDIA:`/tmp/shot 1.png`\n\nDone.";
    const result = detectAttachments(text);
    expect(result.text).toBe("Here you go.\n\n## Image\n\nDone.");
    expect(result.attachments.map((a) => [a.path, a.kind, a.origin])).toEqual([
      ["/Users/me/AI Brain/report final.pdf", "pdf", "media"],
      ["/tmp/shot 1.png", "image", "media"],
    ]);
  });
  it("strips inline MEDIA tags and delivery markers", () => {
    const result = detectAttachments("Voice note: MEDIA:/tmp/a.ogg [[audio_as_voice]] enjoy");
    expect(result.text).toBe("Voice note:   enjoy");
    expect(result.attachments[0]).toMatchObject({ path: "/tmp/a.ogg", kind: "audio" });
  });
  it("leaves MEDIA examples inside code fences alone", () => {
    const text = "Use:\n```\nMEDIA:/tmp/example.png\n```";
    const result = detectAttachments(text);
    expect(result.text).toBe(text);
    expect(result.attachments).toEqual([]);
  });
  it("keeps a non-path MEDIA mention as prose", () => {
    expect(detectAttachments("the MEDIA: tag is special").text).toBe("the MEDIA: tag is special");
  });
  it("finds markdown links to local files but not markdown images", () => {
    const result = detectAttachments("See [the report](/tmp/r.pdf) and ![chart](/tmp/c.png).");
    expect(result.attachments.map((a) => a.path)).toEqual(["/tmp/r.pdf"]);
  });
  it("finds bare absolute paths with known extensions only", () => {
    const result = detectAttachments("Saved to `/tmp/out.csv` and ~/Desktop/x.mp4. Folder /usr/local/bin is not a file.");
    expect(result.attachments.map((a) => a.path)).toEqual(["/tmp/out.csv", "~/Desktop/x.mp4"]);
  });
  it("separates web links from file URLs and gateway file URLs", () => {
    const text =
      "Read https://example.com/post, (see https://en.wikipedia.org/wiki/Foo_(bar)). " +
      "PDF: https://cdn.x.com/doc.pdf and http://gw:9119/api/fs/download?path=%2Ftmp%2Fz.png&profile=default. " +
      "[Docs](https://docs.expo.dev/).";
    const result = detectAttachments(text);
    expect(result.links).toEqual(["https://docs.expo.dev/", "https://example.com/post", "https://en.wikipedia.org/wiki/Foo_(bar)"]);
    expect(result.attachments.map((a) => a.key)).toEqual(["url:https://cdn.x.com/doc.pdf", "path:/tmp/z.png"]);
  });
  it("dedupes repeated references", () => {
    const result = detectAttachments("MEDIA:/tmp/a.png\nAlso /tmp/a.png");
    expect(result.attachments).toHaveLength(1);
  });
  it("does not treat URL paths as local paths", () => {
    expect(detectAttachments("https://site.com/img/a.png").attachments.map((a) => a.key)).toEqual([
      "url:https://site.com/img/a.png",
    ]);
  });
});

describe("resolveHref", () => {
  it("routes hrefs", () => {
    expect(resolveHref("/tmp/My%20File.pdf")).toEqual({ type: "file", path: "/tmp/My File.pdf" });
    expect(resolveHref("file:///tmp/a%20b.png")).toEqual({ type: "file", path: "/tmp/a b.png" });
    expect(resolveHref("https://example.com")).toEqual({ type: "web", url: "https://example.com" });
    expect(resolveHref("https://x.com/a.mp3")).toEqual({ type: "remote-file", url: "https://x.com/a.mp3" });
    expect(resolveHref("#anchor")).toEqual({ type: "none" });
    expect(resolveHref("//evil.com/x.png")).toEqual({ type: "none" });
  });
  it("recognises gateway file routes", () => {
    expect(gatewayPathFromUrl("https://h/api/media?path=%2Fx%2Fy.png")).toBe("/x/y.png");
    expect(gatewayPathFromUrl("https://h/api/files/download?path=%2Fa.pdf&token=t")).toBe("/a.pdf");
    expect(gatewayPathFromUrl("https://h/api/sessions?path=%2Fa.pdf")).toBeNull();
  });
});

describe("detectToolFiles", () => {
  it("reads image_generate / screenshot JSON payloads", () => {
    const result = JSON.stringify({ success: true, image: "/Users/me/.hermes/cache/images/gen.png", prompt: "cat" });
    expect(detectToolFiles(result).map((a) => a.path)).toEqual(["/Users/me/.hermes/cache/images/gen.png"]);
    expect(detectToolFiles({ screenshot_path: "/tmp/s.png", analysis: "ok" })[0]).toMatchObject({ kind: "image", origin: "tool" });
  });
  it("reads MEDIA tags and 'Screenshot path:' lines from text results", () => {
    const files = detectToolFiles("Saved.\nMEDIA:/tmp/speech.mp3\nScreenshot path: /tmp/page.png");
    expect(files.map((a) => a.path)).toEqual(["/tmp/speech.mp3", "/tmp/page.png"]);
  });
  it("ignores non-file values", () => {
    expect(detectToolFiles({ path: "/usr/bin", note: "hello" })).toEqual([]);
  });
});
