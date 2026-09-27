import { decodeEntities, domainOf, parseOpenGraph } from "@/features/media/og";
import { downloadErrorText, fileRequest, gatewayFileUrl, stableHash } from "@/features/media/source";

const config = { url: "192.168.1.5:9119/", token: "secret" };

describe("fileRequest", () => {
  it("builds an authenticated /api/fs/download request with profile + session scope", () => {
    const request = fileRequest({ path: "/Users/me/My Pics/a.png", profile: "cto", sessionId: "s1" }, config);
    expect(request).toMatchObject({
      url: "http://192.168.1.5:9119/api/fs/download?path=%2FUsers%2Fme%2FMy%20Pics%2Fa.png&profile=cto&session_id=s1",
      headers: { "X-Hermes-Session-Token": "secret" },
      name: "a.png",
      kind: "image",
      authenticated: true,
    });
    expect(request?.cacheName).toMatch(/^[0-9a-z]+\.png$/);
  });
  it("shares a cache name across sessions but not across profiles", () => {
    const a = fileRequest({ path: "/x.pdf", profile: "p", sessionId: "1" }, config)?.cacheName;
    const b = fileRequest({ path: "/x.pdf", profile: "p", sessionId: "2" }, config)?.cacheName;
    const c = fileRequest({ path: "/x.pdf", profile: "q" }, config)?.cacheName;
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
  it("never sends the gateway token to remote URLs", () => {
    const request = fileRequest({ url: "https://cdn.example.com/v.mp4" }, config);
    expect(request?.headers).toEqual({});
    expect(request?.authenticated).toBe(false);
    expect(fileRequest({ url: "javascript:alert(1)" }, config)).toBeNull();
  });
  it("uses cookie auth (no token header) for password backends", () => {
    const request = fileRequest({ path: "/x.pdf" }, { url: "https://h", auth: "password", username: "u", password: "p" });
    expect(request).toMatchObject({ headers: {}, cookieAuth: true, authenticated: true });
    expect(fileRequest({ path: "/x.pdf" }, config)?.cookieAuth).toBe(false);
  });
  it("needs a config for gateway paths", () => {
    expect(fileRequest({ path: "/x.png" }, null)).toBeNull();
    expect(gatewayFileUrl({ url: "https://h.ts.net" }, "~/a.md")).toBe("https://h.ts.net/api/fs/download?path=~%2Fa.md");
  });
  it("hashes deterministically", () => {
    expect(stableHash("abc")).toBe(stableHash("abc"));
    expect(stableHash("abc")).not.toBe(stableHash("abd"));
  });
  it("explains download failures", () => {
    expect(downloadErrorText(new Error("UnableToDownload: status 404"))).toMatch(/no longer exists/);
    expect(downloadErrorText(new Error("status 403"))).toMatch(/refused/);
  });
});

describe("parseOpenGraph", () => {
  it("reads og tags, resolves relative images and decodes entities", () => {
    const html = `<html><head><title>Fallback</title>
      <meta property="og:title" content="Tom &amp; Jerry&#39;s" />
      <meta content='A  cat
        and a mouse' property='og:description'>
      <meta property="og:image" content="/img/card.png">
      <meta property="og:site_name" content="Cartoons"></head></html>`;
    expect(parseOpenGraph(html, "https://www.toons.com/a/b")).toEqual({
      url: "https://www.toons.com/a/b",
      domain: "toons.com",
      title: "Tom & Jerry's",
      description: "A cat and a mouse",
      image: "https://www.toons.com/img/card.png",
      siteName: "Cartoons",
    });
  });
  it("falls back to <title> and meta description", () => {
    const meta = parseOpenGraph('<title> Hello </title><meta name="description" content="World">', "https://x.io");
    expect(meta).toMatchObject({ title: "Hello", description: "World", image: undefined });
  });
  it("helpers", () => {
    expect(decodeEntities("&lt;b&gt; &#x41;")).toBe("<b> A");
    expect(domainOf("not a url")).toBe("not a url");
  });
});
