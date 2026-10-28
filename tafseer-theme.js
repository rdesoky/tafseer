/*
 * Theme bridge for tafseer pages.
 *
 * Resolves the active theme from, in order:
 *   1. an explicit parent message (postMessage) or window.tafseerTheme.set()
 *   2. a `theme` / `colorScheme` / `mode` URL parameter
 *   3. a stored preference for this site
 *   4. a same-origin parent page that exposes a dark/light signal
 *   5. the OS/browser color scheme (handled by tafseer-theme.css)
 *
 * The resolved theme is exposed as `data-theme="dark" | "light"` on <html>.
 * When the theme is automatic the attribute is absent and CSS media queries
 * take over.
 *
 * Parent integration (cross-origin friendly):
 *   iframe.contentWindow.postMessage({ theme: "dark" }, "*");   // or "light" / "auto"
 *   iframe.contentWindow.postMessage("dark", "*");
 * The page also posts { type: "tafseer:ready", theme } and
 * { type: "tafseer:theme-request" } to its parent so the parent can reply.
 */
(function () {
  "use strict";

  var root = document.documentElement;
  var STORAGE_KEY = "tafseer-theme";
  var mq = window.matchMedia
    ? window.matchMedia("(prefers-color-scheme: dark)")
    : null;

  function normalize(value) {
    if (value === true) return "dark";
    if (value === false) return "light";
    if (typeof value !== "string") return null;
    var v = value.trim().toLowerCase();
    if (/^(dark|night|black|true|1|on)$/.test(v)) return "dark";
    if (/^(light|day|white|false|0|off)$/.test(v)) return "light";
    return null;
  }

  function store(theme) {
    try {
      if (theme) localStorage.setItem(STORAGE_KEY, theme);
      else localStorage.removeItem(STORAGE_KEY);
    } catch (e) {
      /* storage can be unavailable in third-party iframes */
    }
  }

  function apply(theme, remember) {
    var resolved = normalize(theme);
    if (resolved) root.setAttribute("data-theme", resolved);
    else root.removeAttribute("data-theme");
    if (remember) store(resolved);
    return resolved;
  }

  function current() {
    return root.getAttribute("data-theme") || (mq && mq.matches ? "dark" : "light");
  }

  function fromPayload(payload, depth) {
    var theme = normalize(payload);
    if (theme) return theme;
    if (!payload || typeof payload !== "object" || depth > 2) return null;
    var keys = [
      "theme",
      "colorScheme",
      "color-scheme",
      "colorMode",
      "scheme",
      "mode",
      "value",
      "data",
      "detail",
      "payload"
    ];
    for (var i = 0; i < keys.length; i++) {
      if (keys[i] in payload) {
        theme = fromPayload(payload[keys[i]], depth + 1);
        if (theme) return theme;
      }
    }
    for (var key in payload) {
      if (Object.prototype.hasOwnProperty.call(payload, key)) {
        theme = normalize(payload[key]);
        if (theme) return theme;
      }
    }
    return null;
  }

  function isResetRequest(payload) {
    if (!payload || typeof payload !== "object") return false;
    if (!("theme" in payload)) return false;
    return !normalize(payload.theme);
  }

  function detect() {
    var match = location.search.match(
      /[?&](?:theme|colorScheme|color-scheme|mode|scheme)=([^&#]*)/i
    );
    if (match) return { theme: decodeURIComponent(match[1]), remember: true };

    try {
      var stored = localStorage.getItem(STORAGE_KEY);
      if (stored) return { theme: stored, remember: false };
    } catch (e) {
      /* ignore */
    }

    try {
      var parentWindow = window.parent;
      if (parentWindow && parentWindow !== window) {
        var parentDoc = parentWindow.document;
        var el = parentDoc.documentElement;
        var body = parentDoc.body;
        var signal = [
          el.getAttribute("data-theme"),
          el.getAttribute("data-bs-theme"),
          el.getAttribute("data-color-mode"),
          el.className,
          body ? body.className : ""
        ].join(" ");
        if (/\bdark\b/i.test(signal)) return { theme: "dark", remember: false };
        if (/\blight\b/i.test(signal)) return { theme: "light", remember: false };
      }
    } catch (e) {
      /* cross-origin parent: rely on postMessage */
    }

    return null;
  }

  function postToParent(message) {
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage(message, "*");
      }
    } catch (e) {
      /* ignore */
    }
  }

  window.addEventListener(
    "message",
    function (event) {
      if (event.source !== window.parent && event.source !== window.top) return;
      if (isResetRequest(event.data)) {
        apply(null, true);
        return;
      }
      var theme = fromPayload(event.data, 0);
      if (theme) apply(theme, true);
    },
    false
  );

  window.tafseerTheme = {
    set: function (theme) {
      return apply(theme, true);
    },
    auto: function () {
      return apply(null, true);
    },
    get: current
  };

  var initial = detect();
  if (initial) apply(initial.theme, initial.remember);

  postToParent({ type: "tafseer:ready", theme: current() });
  postToParent({ type: "tafseer:theme-request", theme: current() });

  if (mq) {
    var onSchemeChange = function () {
      postToParent({ type: "tafseer:theme-change", theme: current() });
    };
    if (mq.addEventListener) mq.addEventListener("change", onSchemeChange);
    else if (mq.addListener) mq.addListener(onSchemeChange);
  }
})();
