// Hermes Mobile website: small shared behaviours (tabs, copy buttons). No tracking.
(function () {
  "use strict";

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.className = "visually-hidden";
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy") ? resolve() : reject(new Error("copy failed")); }
      catch (e) { reject(e); }
      finally { document.body.removeChild(ta); }
    });
  }
  window.hermesCopyText = copyText;

  function flash(btn, label) {
    var original = btn.getAttribute("data-label") || btn.textContent;
    btn.setAttribute("data-label", original);
    btn.textContent = label;
    clearTimeout(btn._t);
    btn._t = setTimeout(function () { btn.textContent = original; }, 1800);
  }
  window.hermesFlash = flash;

  // Copy buttons inside .code blocks copy the <pre> text.
  document.querySelectorAll(".code").forEach(function (block) {
    var pre = block.querySelector("pre");
    if (!pre) return;
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn-sm copy";
    btn.textContent = "Copy";
    btn.setAttribute("aria-label", "Copy command");
    btn.addEventListener("click", function () {
      copyText(pre.textContent.trim()).then(
        function () { flash(btn, "Copied"); },
        function () { flash(btn, "Press Ctrl+C"); }
      );
    });
    block.appendChild(btn);
  });

  // Accessible tabs (WAI-ARIA tabs pattern, automatic activation).
  document.querySelectorAll("[data-tabs]").forEach(function (root) {
    var tabs = Array.prototype.slice.call(root.querySelectorAll('[role="tab"]'));
    function select(tab, focus) {
      tabs.forEach(function (t) {
        var on = t === tab;
        t.setAttribute("aria-selected", on ? "true" : "false");
        t.tabIndex = on ? 0 : -1;
        var panel = document.getElementById(t.getAttribute("aria-controls"));
        if (panel) panel.hidden = !on;
      });
      if (focus) tab.focus();
    }
    tabs.forEach(function (tab, i) {
      tab.addEventListener("click", function () { select(tab, false); });
      tab.addEventListener("keydown", function (e) {
        var next = null;
        if (e.key === "ArrowRight") next = tabs[(i + 1) % tabs.length];
        else if (e.key === "ArrowLeft") next = tabs[(i - 1 + tabs.length) % tabs.length];
        else if (e.key === "Home") next = tabs[0];
        else if (e.key === "End") next = tabs[tabs.length - 1];
        if (next) { e.preventDefault(); select(next, true); }
      });
    });
    // Preselect the visitor's OS tab when we can tell; macOS is the markup default.
    var ua = navigator.userAgent || "";
    var guess = /Windows/i.test(ua) ? "windows" : /Linux/i.test(ua) && !/Android/i.test(ua) ? "linux" : null;
    var preferred = guess && root.querySelector('[role="tab"][data-os="' + guess + '"]');
    if (preferred) select(preferred, false);
  });

  // Open a collapsed Q&A entry when linked to directly (e.g. troubleshooting.html#google-500).
  function openTarget() {
    var id = (location.hash || "").slice(1);
    if (!/^[A-Za-z0-9-]{1,64}$/.test(id)) return;
    var el = document.getElementById(id);
    if (el && el.tagName === "DETAILS") el.open = true;
  }
  openTarget();
  window.addEventListener("hashchange", openTarget);
})();
