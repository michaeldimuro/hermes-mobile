// Hermes Mobile pairing page.
//
// The installer opens pair.html#<payload>, where <payload> is base64url
// (RFC 4648 section 5, no padding) of UTF-8 JSON:
//   {"v":1,"url":"https://host","username":"hermes","password":"..."}
//
// Security properties:
//  - The fragment is never sent to any server by the browser.
//  - It is removed from the address bar and history as soon as this script runs.
//  - This script makes no network requests and sends the payload nowhere.
//    The QR code is drawn locally from the payload.
(function () {
  "use strict";

  var MAX_PAYLOAD_LENGTH = 8192;
  var MASK = "••••••••••••";

  // 1. Capture the fragment, then strip it from the URL and history at once,
  //    whether or not it turns out to be valid.
  var raw = "";
  try { raw = (window.location.hash || "").replace(/^#/, ""); } catch (e) { raw = ""; }
  if (raw) {
    try { history.replaceState(null, "", location.pathname); } catch (e) { /* ignore */ }
  }

  function decodeBase64Url(s) {
    var b64 = s.replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4) b64 += "=";
    var bin = atob(b64); // throws on invalid input
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  }

  function isNonEmptyString(x) { return typeof x === "string" && x.length > 0; }

  // Returns {payload, data} or null. Only v, url, username, password are used;
  // anything else in the JSON is ignored.
  function parse(fragment) {
    if (!fragment || fragment.length > MAX_PAYLOAD_LENGTH) return null;
    var payload = fragment.replace(/=+$/, ""); // tolerate stray padding
    if (!/^[A-Za-z0-9_-]+$/.test(payload)) return null;
    var obj;
    try { obj = JSON.parse(decodeBase64Url(payload)); } catch (e) { return null; }
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
    if (obj.v !== 1) return null;
    if (!isNonEmptyString(obj.url) || !/^https?:\/\//i.test(obj.url)) return null;
    try { new URL(obj.url); } catch (e) { return null; }
    if (!isNonEmptyString(obj.username) || !isNonEmptyString(obj.password)) return null;
    return {
      payload: payload,
      data: { url: obj.url, username: obj.username, password: obj.password }
    };
  }

  var parsed = parse(raw);
  raw = "";

  function $(id) { return document.getElementById(id); }

  function renderQr(container, text) {
    if (typeof window.qrcode !== "function") return false;
    var qr = window.qrcode(0, "M"); // type 0 = pick the smallest version that fits
    qr.addData(text);
    qr.make();
    var n = qr.getModuleCount();
    var quiet = 4; // standard quiet zone, always white
    var size = n + quiet * 2;
    var NS = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 " + size + " " + size);
    svg.setAttribute("width", "300");
    svg.setAttribute("height", "300");
    svg.setAttribute("shape-rendering", "crispEdges");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "QR code that opens Hermes Mobile connected to your Hermes");
    var bg = document.createElementNS(NS, "rect");
    bg.setAttribute("width", String(size));
    bg.setAttribute("height", String(size));
    bg.setAttribute("fill", "#ffffff");
    svg.appendChild(bg);
    var d = "";
    for (var r = 0; r < n; r++) {
      for (var c = 0; c < n; c++) {
        if (qr.isDark(r, c)) d += "M" + (c + quiet) + " " + (r + quiet) + "h1v1h-1z";
      }
    }
    var path = document.createElementNS(NS, "path");
    path.setAttribute("d", d);
    path.setAttribute("fill", "#000000");
    svg.appendChild(path);
    container.textContent = "";
    container.appendChild(svg);
    return true;
  }

  function copy(text) {
    if (typeof window.hermesCopyText === "function") return window.hermesCopyText(text);
    return navigator.clipboard.writeText(text);
  }

  function init() {
    if (!parsed) {
      $("pair-missing").hidden = false;
      return;
    }

    var data = parsed.data;
    var deepLink = "hermes://connect?d=" + parsed.payload;
    var status = $("status");
    var passEl = $("f-pass");
    var showBtn = $("pw-show");
    var revealed = false;

    $("f-url").textContent = data.url;
    $("f-user").textContent = data.username;
    passEl.textContent = MASK;
    $("open-app").setAttribute("href", deepLink);

    if (!renderQr($("qr"), deepLink)) {
      $("qr-caption").textContent =
        "The QR code couldn't be drawn (the QR library didn't load). Use the details here instead.";
    }

    showBtn.addEventListener("click", function () {
      revealed = !revealed;
      passEl.textContent = revealed ? data.password : MASK;
      showBtn.textContent = revealed ? "Hide" : "Show";
      showBtn.setAttribute("aria-pressed", revealed ? "true" : "false");
    });

    $("pw-copy").addEventListener("click", function () {
      copy(data.password).then(
        function () { status.textContent = "Password copied."; },
        function () { status.textContent = "Couldn't copy. Press Show and copy it by hand."; }
      );
    });

    $("done").addEventListener("click", function () {
      $("qr").textContent = "";
      $("f-url").textContent = "";
      $("f-user").textContent = "";
      passEl.textContent = "";
      $("open-app").setAttribute("href", "#");
      data = null;
      deepLink = "";
      parsed = null;
      $("pair-ok").hidden = true;
      $("pair-cleared").hidden = false;
    });

    $("pair-ok").hidden = false;
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
