// ==UserScript==
// @name         Page Scroll Floating Arrows
// @namespace    https://github.com/decli/pagescroll
// @version      0.11.1
// @description  Liquid-glass floating scroll control: a collapsed glass ball that expands on hover (auto-collapses 3s after you leave), with refractive edges on Chromium and adaptive light/dark material. Right-click to configure its default position. Supports SPA pages with custom scroll containers.
// @author       decli
// @license      MIT
// @match        *://*/*
// @match        file:///*
// @run-at       document-start
// @noframes
// @homepageURL  https://github.com/decli/pagescroll
// @supportURL   https://github.com/decli/pagescroll/issues
// @downloadURL  https://raw.githubusercontent.com/decli/pagescroll/main/PageScroll.user.js
// @updateURL    https://raw.githubusercontent.com/decli/pagescroll/main/PageScroll.user.js
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_registerMenuCommand
// ==/UserScript==

(function () {
  "use strict";

  if (window.__pageScrollFloatingArrowsInstalled) return;
  window.__pageScrollFloatingArrowsInstalled = true;

  var HOST_ID = "page-scroll-floating-arrows-" + Math.random().toString(36).slice(2);
  var Z_INDEX = "2147483647";
  var MORPH_EASE = "cubic-bezier(.2,.8,.2,1)";
  var HOST_MORPH_TRANSITION = "left .28s " + MORPH_EASE + ",top .28s " + MORPH_EASE + ",width .28s " + MORPH_EASE + ",height .28s " + MORPH_EASE;
  var EXPANDED_WIDTH = 34;
  var EXPANDED_HEIGHT = 72;
  var COLLAPSED_WIDTH = 26;
  var COLLAPSED_HEIGHT = 26;
  var EXPAND_LINGER_MS = 3000;
  var EDGE_MARGIN = 8;
  var DEFAULT_RIGHT_GAP = 16;
  var DEFAULT_VERTICAL_RATIO = 0.2;
  var STORAGE_KEY = "pagescroll:default-position";

  var host = null;
  var panel = null;
  var toggleButton = null;
  var observer = null;
  var ensureTimer = null;
  var destroyed = false;
  var collapsed = true;
  var drag = null;
  var currentPosition = null;
  var manualPositionRatio = null;
  var savedDefaultRatio = null;
  var previewRatio = null;
  var settingsEl = null;
  var settingsInputX = null;
  var settingsInputY = null;
  var settingsOpen = false;
  var glassLight = false;
  var glassUpdateTimer = null;
  var lensEl = null;
  var pointerInside = false;
  var lingerTimer = null;
  var motionQuery = null;
  try {
    motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  } catch (error) {
    motionQuery = null;
  }

  function prefersReducedMotion() {
    return !!(motionQuery && motionQuery.matches);
  }

  function getHostSize() {
    if (collapsed) return { width: COLLAPSED_WIDTH, height: COLLAPSED_HEIGHT };
    return { width: EXPANDED_WIDTH, height: EXPANDED_HEIGHT };
  }

  function getViewportSize() {
    var html = document.documentElement;
    var clientWidth = html && html.clientWidth ? html.clientWidth : 0;
    var clientHeight = html && html.clientHeight ? html.clientHeight : 0;
    var innerWidth = window.innerWidth || clientWidth || 0;
    var innerHeight = window.innerHeight || clientHeight || 0;

    return {
      width: Math.max(0, clientWidth ? Math.min(clientWidth, innerWidth || clientWidth) : innerWidth),
      height: Math.max(0, innerHeight || clientHeight)
    };
  }

  function clamp01(value) {
    return Math.min(1, Math.max(0, Number(value) || 0));
  }

  function readStorage(key) {
    var value = null;
    try {
      if (typeof GM_getValue === "function") value = GM_getValue(key, null);
    } catch (error) {
      value = null;
    }
    if (typeof value === "string" && value) return value;
    try {
      return window.localStorage ? window.localStorage.getItem(key) : null;
    } catch (error) {
      return null;
    }
  }

  function writeStorage(key, value) {
    try {
      if (typeof GM_setValue === "function") GM_setValue(key, value);
    } catch (error) {
      // GM storage may be unavailable; localStorage below is the fallback.
    }
    try {
      if (window.localStorage) window.localStorage.setItem(key, value);
    } catch (error) {
      // Sandboxed pages can forbid localStorage; the config just won't persist.
    }
  }

  function removeStorage(key) {
    try {
      if (typeof GM_deleteValue === "function") GM_deleteValue(key);
    } catch (error) {
      // Ignore and still clear the localStorage copy.
    }
    try {
      if (window.localStorage) window.localStorage.removeItem(key);
    } catch (error) {
      // Nothing left to clear.
    }
  }

  function loadSavedDefaultRatio() {
    var raw = readStorage(STORAGE_KEY);
    if (!raw) return null;
    try {
      var parsed = JSON.parse(raw);
      if (parsed && isFinite(parsed.x) && isFinite(parsed.y)) {
        return { x: clamp01(parsed.x), y: clamp01(parsed.y) };
      }
    } catch (error) {
      // Corrupt config falls back to the built-in default.
    }
    return null;
  }

  function persistDefaultRatio(ratio) {
    savedDefaultRatio = { x: clamp01(ratio.x), y: clamp01(ratio.y) };
    writeStorage(STORAGE_KEY, JSON.stringify(savedDefaultRatio));
  }

  function getPositionRange(size) {
    size = size || getHostSize();
    var viewport = getViewportSize();
    var maxLeft = Math.max(EDGE_MARGIN, viewport.width - size.width - EDGE_MARGIN);
    var maxTop = Math.max(EDGE_MARGIN, viewport.height - size.height - EDGE_MARGIN);

    return {
      minLeft: EDGE_MARGIN,
      maxLeft: maxLeft,
      minTop: EDGE_MARGIN,
      maxTop: maxTop
    };
  }

  function defaultPosition(size) {
    size = size || getHostSize();
    var viewport = getViewportSize();
    return {
      left: Math.max(EDGE_MARGIN, viewport.width - size.width - DEFAULT_RIGHT_GAP),
      top: Math.max(EDGE_MARGIN, Math.round(viewport.height * DEFAULT_VERTICAL_RATIO - size.height / 2))
    };
  }

  function clampPosition(position, size) {
    var range = getPositionRange(size);
    return {
      left: Math.min(Math.max(Number(position.left) || EDGE_MARGIN, range.minLeft), range.maxLeft),
      top: Math.min(Math.max(Number(position.top) || EDGE_MARGIN, range.minTop), range.maxTop)
    };
  }

  // Reposition a box for a new size without the perceived sideways jump:
  // pin the horizontal edge nearest to the viewport side it is docked
  // against, and keep the vertical center, so the widget grows/shrinks
  // toward the screen interior only.
  function anchorSizeChange(oldSize, oldPosition, newSize) {
    var viewport = getViewportSize();
    var centerX = oldPosition.left + oldSize.width / 2;
    var left = centerX >= viewport.width / 2
      ? oldPosition.left + oldSize.width - newSize.width
      : oldPosition.left;
    var top = oldPosition.top + oldSize.height / 2 - newSize.height / 2;
    return clampPosition({ left: left, top: top }, newSize);
  }

  function positionToRatio(position) {
    var range = getPositionRange();
    var width = Math.max(1, range.maxLeft - range.minLeft);
    var height = Math.max(1, range.maxTop - range.minTop);

    return {
      x: clamp01((position.left - range.minLeft) / width),
      y: clamp01((position.top - range.minTop) / height)
    };
  }

  function ratioToPosition(ratio) {
    var range = getPositionRange();
    return clampPosition({
      left: range.minLeft + (range.maxLeft - range.minLeft) * clamp01(ratio && ratio.x),
      top: range.minTop + (range.maxTop - range.minTop) * clamp01(ratio && ratio.y)
    });
  }

  function centerRatioFromPosition(position) {
    var size = getHostSize();
    var viewport = getViewportSize();
    return {
      x: clamp01((position.left + size.width / 2) / Math.max(1, viewport.width)),
      y: clamp01((position.top + size.height / 2) / Math.max(1, viewport.height))
    };
  }

  function positionFromCenterRatio(ratio, size) {
    size = size || getHostSize();
    var viewport = getViewportSize();
    return clampPosition({
      left: viewport.width * clamp01(ratio && ratio.x) - size.width / 2,
      top: viewport.height * clamp01(ratio && ratio.y) - size.height / 2
    }, size);
  }

  function preferredPosition() {
    // Manually dragged positions are stored against the current size and
    // re-synced on every collapse/expand, so they are stable as-is.
    if (!previewRatio && manualPositionRatio) return ratioToPosition(manualPositionRatio);

    // Every other flow derives from the canonical expanded box, then maps
    // it through the same anchor rule setCollapsed uses, so the periodic
    // keep-alive can never disagree with a just-toggled position.
    var expandedSize = { width: EXPANDED_WIDTH, height: EXPANDED_HEIGHT };
    var expandedBox;
    if (previewRatio) {
      expandedBox = positionFromCenterRatio(previewRatio, expandedSize);
    } else if (savedDefaultRatio) {
      expandedBox = positionFromCenterRatio(savedDefaultRatio, expandedSize);
    } else {
      expandedBox = defaultPosition(expandedSize);
    }
    if (!collapsed) return expandedBox;
    return anchorSizeChange(expandedSize, expandedBox, getHostSize());
  }

  function rememberManualPosition() {
    manualPositionRatio = positionToRatio(getHostPosition());
  }

  function applyHostStyle(position) {
    if (!host) return;
    currentPosition = clampPosition(position || currentPosition || defaultPosition());
    var size = getHostSize();

    host.style.setProperty("all", "initial", "important");
    host.style.setProperty("position", "fixed", "important");
    host.style.setProperty("left", Math.round(currentPosition.left) + "px", "important");
    host.style.setProperty("top", Math.round(currentPosition.top) + "px", "important");
    host.style.setProperty("width", size.width + "px", "important");
    host.style.setProperty("height", size.height + "px", "important");
    host.style.setProperty("margin", "0", "important");
    host.style.setProperty("padding", "0", "important");
    host.style.setProperty("border", "0", "important");
    host.style.setProperty("background", "transparent", "important");
    host.style.setProperty("box-shadow", "none", "important");
    host.style.setProperty("overflow", "visible", "important");
    host.style.setProperty("display", "block", "important");
    host.style.setProperty("visibility", "visible", "important");
    host.style.setProperty("opacity", "1", "important");
    host.style.setProperty("pointer-events", "auto", "important");
    host.style.setProperty("z-index", Z_INDEX, "important");
    host.style.setProperty("contain", "layout style", "important");
    host.style.setProperty("isolation", "isolate", "important");
    host.style.setProperty("box-sizing", "border-box", "important");
    var animate = !drag && !prefersReducedMotion();
    host.style.setProperty("transition", animate ? HOST_MORPH_TRANSITION : "none", "important");
  }

  function buildLensMap(width, height, band, power) {
    var dpr = Math.min(3, Math.max(2, Math.round(window.devicePixelRatio || 1)));
    var mapWidth = Math.round(width * dpr);
    var mapHeight = Math.round(height * dpr);
    var canvas = document.createElement("canvas");
    canvas.width = mapWidth;
    canvas.height = mapHeight;
    var context = canvas.getContext("2d");
    var image = context.createImageData(mapWidth, mapHeight);
    var data = image.data;
    var radius = Math.min(width, height) / 2;
    var centerX = width / 2;
    var centerY = height / 2;
    var vectors = new Float32Array(mapWidth * mapHeight * 2);
    var maxDisplacement = 0;

    for (var py = 0; py < mapHeight; py += 1) {
      for (var px = 0; px < mapWidth; px += 1) {
        var x = (px + 0.5) / dpr;
        var y = (py + 0.5) / dpr;
        var qx = Math.abs(x - centerX) - (width / 2 - radius);
        var qy = Math.abs(y - centerY) - (height / 2 - radius);
        var outerX = Math.max(qx, 0);
        var outerY = Math.max(qy, 0);
        var sdf = Math.min(Math.max(qx, qy), 0) + Math.hypot(outerX, outerY) - radius;
        if (sdf > 0) continue;
        // Lens profile: neutral in the middle, bending samples toward the
        // center inside the edge band, so the rim magnifies like convex glass.
        var t = Math.min(1, Math.max(0, 1 + sdf / band));
        var eased = t * t * (3 - 2 * t);
        eased *= eased;
        var offset = (py * mapWidth + px) * 2;
        vectors[offset] = (centerX - x) * power * eased;
        vectors[offset + 1] = (centerY - y) * power * eased;
        var magnitude = Math.max(Math.abs(vectors[offset]), Math.abs(vectors[offset + 1]));
        if (magnitude > maxDisplacement) maxDisplacement = magnitude;
      }
    }

    for (var index = 0; index < mapWidth * mapHeight; index += 1) {
      var source = index * 2;
      var target = index * 4;
      var nx = maxDisplacement > 0 ? vectors[source] / maxDisplacement : 0;
      var ny = maxDisplacement > 0 ? vectors[source + 1] / maxDisplacement : 0;
      data[target] = Math.round(127.5 + nx * 127.5);
      data[target + 1] = Math.round(127.5 + ny * 127.5);
      data[target + 2] = 128;
      data[target + 3] = 255;
    }
    context.putImageData(image, 0, 0);
    return { url: canvas.toDataURL(), scale: maxDisplacement * 2 };
  }

  function makeLensFilter(ns, xlink, id, width, height, lens) {
    var filter = document.createElementNS(ns, "filter");
    filter.setAttribute("id", id);
    filter.setAttribute("x", "0");
    filter.setAttribute("y", "0");
    filter.setAttribute("width", String(width));
    filter.setAttribute("height", String(height));
    filter.setAttribute("filterUnits", "userSpaceOnUse");
    filter.setAttribute("color-interpolation-filters", "sRGB");

    var image = document.createElementNS(ns, "feImage");
    image.setAttribute("href", lens.url);
    image.setAttributeNS(xlink, "xlink:href", lens.url);
    image.setAttribute("x", "0");
    image.setAttribute("y", "0");
    image.setAttribute("width", String(width));
    image.setAttribute("height", String(height));
    image.setAttribute("preserveAspectRatio", "none");
    image.setAttribute("result", "map");
    filter.appendChild(image);

    // Refract each color channel with a slightly different strength for the
    // faint chromatic fringe real glass shows at its rim.
    var rows = {
      R: "1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0",
      G: "0 0 0 0 0 0 1 0 0 0 0 0 0 0 0 0 0 0 1 0",
      B: "0 0 0 0 0 0 0 0 0 0 0 0 1 0 0 0 0 0 1 0"
    };
    var scales = { R: lens.scale * 1.1, G: lens.scale, B: lens.scale * 0.9 };
    var keys = ["R", "G", "B"];
    for (var index = 0; index < keys.length; index += 1) {
      var key = keys[index];
      var displace = document.createElementNS(ns, "feDisplacementMap");
      displace.setAttribute("in", "SourceGraphic");
      displace.setAttribute("in2", "map");
      displace.setAttribute("scale", String(scales[key]));
      displace.setAttribute("xChannelSelector", "R");
      displace.setAttribute("yChannelSelector", "G");
      displace.setAttribute("result", "disp" + key);
      filter.appendChild(displace);
      var matrix = document.createElementNS(ns, "feColorMatrix");
      matrix.setAttribute("in", "disp" + key);
      matrix.setAttribute("type", "matrix");
      matrix.setAttribute("values", rows[key]);
      matrix.setAttribute("result", "chan" + key);
      filter.appendChild(matrix);
    }
    var mergeRG = document.createElementNS(ns, "feComposite");
    mergeRG.setAttribute("in", "chanR");
    mergeRG.setAttribute("in2", "chanG");
    mergeRG.setAttribute("operator", "arithmetic");
    mergeRG.setAttribute("k1", "0");
    mergeRG.setAttribute("k2", "1");
    mergeRG.setAttribute("k3", "1");
    mergeRG.setAttribute("k4", "0");
    mergeRG.setAttribute("result", "chanRG");
    filter.appendChild(mergeRG);
    var mergeRGB = document.createElementNS(ns, "feComposite");
    mergeRGB.setAttribute("in", "chanRG");
    mergeRGB.setAttribute("in2", "chanB");
    mergeRGB.setAttribute("operator", "arithmetic");
    mergeRGB.setAttribute("k1", "0");
    mergeRGB.setAttribute("k2", "1");
    mergeRGB.setAttribute("k3", "1");
    mergeRGB.setAttribute("k4", "0");
    filter.appendChild(mergeRGB);
    return filter;
  }

  function buildLens(shadow) {
    // backdrop-filter:url(#svg) only renders in Chromium; elsewhere the
    // frosted-glass fallback stays active, so bail out quietly.
    if (!lensEl || !panel) return;
    if (!/Chrome\/|Chromium\/|Edg\//.test(navigator.userAgent || "")) return;
    try {
      var ns = "http://www.w3.org/2000/svg";
      var xlink = "http://www.w3.org/1999/xlink";
      var capsule = buildLensMap(EXPANDED_WIDTH, EXPANDED_HEIGHT, 8, 0.32);
      var ball = buildLensMap(COLLAPSED_WIDTH, COLLAPSED_HEIGHT, 6, 0.4);
      var svg = document.createElementNS(ns, "svg");
      svg.setAttribute("width", "0");
      svg.setAttribute("height", "0");
      svg.setAttribute("aria-hidden", "true");
      svg.setAttribute("style", "position:absolute;width:0;height:0;overflow:hidden;");
      var defs = document.createElementNS(ns, "defs");
      defs.appendChild(makeLensFilter(ns, xlink, "ps-lens-capsule", EXPANDED_WIDTH, EXPANDED_HEIGHT, capsule));
      defs.appendChild(makeLensFilter(ns, xlink, "ps-lens-ball", COLLAPSED_WIDTH, COLLAPSED_HEIGHT, ball));
      svg.appendChild(defs);
      shadow.appendChild(svg);
      lensEl.classList.add("on");
      lensEl.classList.toggle("ball", collapsed);
      panel.classList.add("lens-on");
    } catch (error) {
      // The refraction lens is a progressive enhancement over frosted glass.
    }
  }

  function makeButton(action, label, glyph, className) {
    var button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.dataset.action = action;
    button.setAttribute("aria-label", label);
    button.title = label;
    button.textContent = glyph;
    return button;
  }

  function buildHost() {
    var position = preferredPosition();
    currentPosition = position;
    host = document.createElement("div");
    host.id = HOST_ID;
    host.setAttribute("data-page-scroll-floating-arrows", "true");
    applyHostStyle(position);

    var shadow = host.attachShadow({ mode: "closed" });
    var style = document.createElement("style");
    style.textContent = [
      ":host{all:initial;}",
      ".glass-dark{--glass-bg:rgba(28,28,32,.42);--glass-bg-thin:rgba(28,28,32,.3);--glass-bg-strong:rgba(28,28,32,.7);--glass-border:rgba(255,255,255,.22);--sheen:rgba(255,255,255,.14);--rim-top:rgba(255,255,255,.32);--rim-bottom:rgba(255,255,255,.09);--shadow-color:rgba(0,0,0,.45);--ink:#f5f5f7;--ink-dim:rgba(245,245,247,.82);--ink-faint:rgba(245,245,247,.56);--divider:rgba(255,255,255,.22);--chip-bg:rgba(66,66,72,.66);--chip-hover:rgba(255,255,255,.24);--hover-bg:rgba(255,255,255,.16);--field-bg:rgba(255,255,255,.1);--field-border:rgba(255,255,255,.24);}",
      ".glass-light{--glass-bg:rgba(255,255,255,.46);--glass-bg-thin:rgba(255,255,255,.34);--glass-bg-strong:rgba(255,255,255,.75);--glass-border:rgba(255,255,255,.66);--sheen:rgba(255,255,255,.6);--rim-top:rgba(255,255,255,.9);--rim-bottom:rgba(255,255,255,.35);--shadow-color:rgba(30,42,68,.22);--ink:#1d1d1f;--ink-dim:rgba(29,29,31,.78);--ink-faint:rgba(29,29,31,.55);--divider:rgba(29,29,31,.16);--chip-bg:rgba(255,255,255,.74);--chip-hover:rgba(255,255,255,.95);--hover-bg:rgba(29,29,31,.08);--field-bg:rgba(255,255,255,.55);--field-border:rgba(29,29,31,.18);}",
      "@supports not ((backdrop-filter:blur(2px)) or (-webkit-backdrop-filter:blur(2px))){.glass-dark{--glass-bg:rgba(28,28,32,.9);--glass-bg-strong:rgba(28,28,32,.95);--chip-bg:rgba(58,58,64,.95);}.glass-light{--glass-bg:rgba(255,255,255,.92);--glass-bg-strong:rgba(255,255,255,.96);--chip-bg:rgba(255,255,255,.96);}}",
      ".panel{position:relative;width:" + EXPANDED_WIDTH + "px;height:" + EXPANDED_HEIGHT + "px;box-sizing:border-box;padding:5px;display:flex;align-items:center;justify-content:center;border:1px solid var(--glass-border);border-radius:999px;background-color:var(--glass-bg);background-image:linear-gradient(180deg,var(--sheen),rgba(255,255,255,0) 48%);box-shadow:inset 0 1px 1px var(--rim-top),inset 0 -1px 1px var(--rim-bottom),0 8px 24px var(--shadow-color);backdrop-filter:blur(18px) saturate(180%);-webkit-backdrop-filter:blur(18px) saturate(180%);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;user-select:none;-webkit-user-select:none;touch-action:none;cursor:grab;transition:width .28s " + MORPH_EASE + ",height .28s " + MORPH_EASE + ",padding .28s " + MORPH_EASE + ",background-color .25s ease;}",
      ".panel.collapsed{width:" + COLLAPSED_WIDTH + "px;height:" + COLLAPSED_HEIGHT + "px;padding:0;}",
      ".panel.dragging{cursor:grabbing;opacity:.92;}",
      ".lens{position:absolute;inset:0;border-radius:999px;pointer-events:none;display:none;}",
      ".lens.on{display:block;backdrop-filter:url(#ps-lens-capsule);-webkit-backdrop-filter:url(#ps-lens-capsule);}",
      ".lens.on.ball{backdrop-filter:url(#ps-lens-ball);-webkit-backdrop-filter:url(#ps-lens-ball);}",
      ".panel.lens-on{background-color:var(--glass-bg-thin);backdrop-filter:blur(3px) saturate(170%);-webkit-backdrop-filter:blur(3px) saturate(170%);}",
      ".arrows{width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:space-between;opacity:1;transition:opacity .18s ease .06s,visibility 0s linear;}",
      ".panel.collapsed .arrows{opacity:0;visibility:hidden;transition:opacity .12s ease,visibility 0s linear .12s;}",
      ".divider{width:14px;height:1px;background:var(--divider);}",
      "button{appearance:none;-webkit-appearance:none;box-sizing:border-box;margin:0;border:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;line-height:1;display:grid;place-items:center;cursor:pointer;user-select:none;-webkit-user-select:none;touch-action:none;}",
      ".arrow{width:24px;height:24px;border-radius:999px;background:transparent;color:var(--ink);font-size:14px;font-weight:800;transition:background-color .15s ease,color .15s ease;}",
      ".arrow:hover{background:var(--hover-bg);}",
      ".close,.toggle{position:absolute;left:50%;z-index:1;width:16px;height:16px;border-radius:999px;border:1px solid var(--glass-border);background-color:var(--chip-bg);color:var(--ink);font-size:10px;font-weight:700;box-shadow:inset 0 1px 1px var(--rim-top),0 2px 8px var(--shadow-color);backdrop-filter:blur(12px) saturate(180%);-webkit-backdrop-filter:blur(12px) saturate(180%);opacity:0;transform:translateX(-50%) scale(.5);pointer-events:none;transition:opacity .16s ease,transform .16s ease,background-color .16s ease,color .16s ease;}",
      ".close{top:-8px;}",
      ".toggle{bottom:-8px;}",
      ".panel:hover .close,.panel:focus-within .close,.panel:hover .toggle,.panel:focus-within .toggle{opacity:1;transform:translateX(-50%) scale(1);pointer-events:auto;}",
      "@media (hover:none){.close,.toggle{opacity:1;transform:translateX(-50%) scale(1);pointer-events:auto;}}",
      ".toggle:hover{background-color:rgba(10,132,255,.92);border-color:transparent;color:#fff;}",
      ".close:hover{background-color:rgba(255,69,58,.92);border-color:transparent;color:#fff;}",
      ".panel.collapsed .toggle{position:absolute;left:0;top:0;width:" + COLLAPSED_WIDTH + "px;height:" + COLLAPSED_HEIGHT + "px;opacity:1;pointer-events:auto;transform:none;border:0;background:transparent;box-shadow:none;font-size:8px;line-height:1.15;white-space:pre;text-align:center;transition:opacity .16s ease .1s;}",
      ".panel.collapsed .toggle:hover{background-color:var(--hover-bg);color:var(--ink);}",
      ".panel.collapsed .close{display:none;}",
      ".arrow:active{transform:translateY(1px);}",
      ".close:active,.toggle:active{transform:translateX(-50%) scale(.92);}",
      ".panel.collapsed .toggle:active{transform:scale(.94);}",
      ".arrow:focus-visible,.toggle:focus-visible,.close:focus-visible{outline:2px solid #facc15;outline-offset:2px;}",
      "@media (prefers-reduced-motion:reduce){.panel,.arrows,.close,.toggle{transition:none;}}",
      ".settings{position:absolute;z-index:1;width:208px;box-sizing:border-box;padding:10px;display:none;flex-direction:column;gap:8px;border:1px solid var(--glass-border);border-radius:14px;background-color:var(--glass-bg-strong);background-image:linear-gradient(180deg,var(--sheen),rgba(255,255,255,0) 40%);box-shadow:inset 0 1px 1px var(--rim-top),0 12px 32px var(--shadow-color);backdrop-filter:blur(24px) saturate(180%);-webkit-backdrop-filter:blur(24px) saturate(180%);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;font-size:12px;color:var(--ink);cursor:default;user-select:none;-webkit-user-select:none;}",
      ".settings.open{display:flex;}",
      ".settings-head{display:flex;align-items:center;justify-content:space-between;font-weight:700;}",
      ".settings-close{width:16px;height:16px;border-radius:999px;border:1px solid var(--glass-border);background:var(--chip-bg);color:var(--ink);font-size:10px;font-weight:700;}",
      ".settings-close:hover{background:rgba(255,69,58,.92);border-color:transparent;color:#fff;}",
      ".settings-row{display:flex;align-items:center;justify-content:space-between;gap:6px;}",
      ".settings-row label{color:var(--ink-dim);}",
      ".settings-field{display:flex;align-items:center;gap:4px;}",
      ".settings-field span{color:var(--ink-faint);font-size:11px;}",
      ".settings-row input{width:64px;box-sizing:border-box;padding:4px 6px;border:1px solid var(--field-border);border-radius:6px;background:var(--field-bg);color:var(--ink);font-size:12px;font-family:inherit;outline:none;user-select:text;-webkit-user-select:text;}",
      ".settings-row input:focus{border-color:#0a84ff;}",
      ".settings-hint{color:var(--ink-faint);font-size:11px;line-height:1.5;}",
      ".settings-actions{display:flex;justify-content:flex-end;gap:6px;}",
      ".settings-actions button{padding:5px 9px;border-radius:6px;border:1px solid var(--glass-border);background:var(--chip-bg);color:var(--ink);font-size:11px;font-weight:600;}",
      ".settings-actions button:hover{background:var(--chip-hover);}",
      ".settings-actions button.primary{background:#0a84ff;border-color:transparent;color:#fff;}",
      ".settings-actions button.primary:hover{background:#3395ff;}"
    ].join("");

    panel = document.createElement("div");
    panel.className = "panel glass-dark";
    panel.setAttribute("role", "group");
    panel.setAttribute("aria-label", "Page scroll controls");
    panel.title = "拖动调整位置，右键打开设置";

    var arrows = document.createElement("div");
    arrows.className = "arrows";
    var divider = document.createElement("div");
    divider.className = "divider";
    arrows.appendChild(makeButton("top", "Scroll to page top", "▲", "arrow"));
    arrows.appendChild(divider);
    arrows.appendChild(makeButton("bottom", "Scroll to page bottom", "▼", "arrow"));

    toggleButton = makeButton("toggle", "Collapse page scroll controls", "−", "toggle");

    panel.appendChild(arrows);
    panel.appendChild(toggleButton);
    panel.appendChild(makeButton("close", "Close page scroll controls until reload", "×", "close"));
    syncCollapsedState();

    panel.addEventListener("pointerdown", onPointerDown, true);
    panel.addEventListener("pointermove", onPointerMove, true);
    panel.addEventListener("pointerup", onPointerUp, true);
    panel.addEventListener("pointercancel", onPointerCancel, true);
    panel.addEventListener("click", stopEvent, true);
    panel.addEventListener("keydown", onKeyDown, true);
    panel.addEventListener("contextmenu", onPanelContextMenu, true);
    panel.addEventListener("pointerenter", onPanelPointerEnter);
    panel.addEventListener("pointerleave", onPanelPointerLeave);
    panel.addEventListener("focusin", onPanelFocusIn);
    panel.addEventListener("focusout", onPanelFocusOut);

    shadow.appendChild(style);
    lensEl = document.createElement("div");
    lensEl.className = "lens";
    shadow.appendChild(lensEl);
    shadow.appendChild(panel);
    buildSettings(shadow);
    buildLens(shadow);
  }

  function makeSettingsInput() {
    var input = document.createElement("input");
    input.type = "number";
    input.min = "0";
    input.max = "100";
    input.step = "1";
    return input;
  }

  function makeSettingsRow(labelText, input) {
    var row = document.createElement("div");
    row.className = "settings-row";
    var label = document.createElement("label");
    label.textContent = labelText;
    var field = document.createElement("div");
    field.className = "settings-field";
    var unit = document.createElement("span");
    unit.textContent = "%";
    field.appendChild(input);
    field.appendChild(unit);
    row.appendChild(label);
    row.appendChild(field);
    return row;
  }

  function buildSettings(shadow) {
    settingsEl = document.createElement("div");
    settingsEl.className = "settings glass-dark";
    settingsEl.setAttribute("role", "dialog");
    settingsEl.setAttribute("aria-label", "PageScroll position settings");

    var head = document.createElement("div");
    head.className = "settings-head";
    var title = document.createElement("span");
    title.textContent = "位置设置";
    var closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "settings-close";
    closeButton.title = "关闭";
    closeButton.setAttribute("aria-label", "关闭设置");
    closeButton.textContent = "×";
    head.appendChild(title);
    head.appendChild(closeButton);

    settingsInputX = makeSettingsInput();
    settingsInputY = makeSettingsInput();

    var hint = document.createElement("div");
    hint.className = "settings-hint";
    hint.textContent = "控件中心相对窗口的百分比：0,0 为左上角，100,100 为右下角。修改会即时预览，保存后在所有页面生效。";

    var actions = document.createElement("div");
    actions.className = "settings-actions";
    var resetButton = document.createElement("button");
    resetButton.type = "button";
    resetButton.textContent = "恢复内置";
    resetButton.title = "恢复内置默认位置（右侧 20% 高度）";
    var saveButton = document.createElement("button");
    saveButton.type = "button";
    saveButton.className = "primary";
    saveButton.textContent = "保存";
    saveButton.title = "保存为默认位置";
    actions.appendChild(resetButton);
    actions.appendChild(saveButton);

    settingsEl.appendChild(head);
    settingsEl.appendChild(makeSettingsRow("横向位置", settingsInputX));
    settingsEl.appendChild(makeSettingsRow("纵向位置", settingsInputY));
    settingsEl.appendChild(hint);
    settingsEl.appendChild(actions);

    var swallowed = ["pointerdown", "pointermove", "pointerup", "pointercancel", "click", "dblclick", "contextmenu", "wheel", "keyup", "keypress"];
    for (var index = 0; index < swallowed.length; index += 1) {
      settingsEl.addEventListener(swallowed[index], function (event) {
        event.stopPropagation();
      });
    }
    settingsEl.addEventListener("keydown", function (event) {
      if (event.key === "Escape") {
        closeSettings();
      } else if (event.key === "Enter" && event.target && event.target.tagName === "INPUT") {
        saveSettings();
      }
      event.stopPropagation();
    });

    settingsInputX.addEventListener("input", onSettingsInput);
    settingsInputY.addEventListener("input", onSettingsInput);
    closeButton.addEventListener("click", closeSettings);
    resetButton.addEventListener("click", resetDefaultPosition);
    saveButton.addEventListener("click", saveSettings);

    shadow.appendChild(settingsEl);
  }

  function readSettingsInputs() {
    var current = centerRatioFromPosition(getHostPosition());
    var x = settingsInputX ? parseFloat(settingsInputX.value) : NaN;
    var y = settingsInputY ? parseFloat(settingsInputY.value) : NaN;
    return {
      x: isFinite(x) ? clamp01(x / 100) : current.x,
      y: isFinite(y) ? clamp01(y / 100) : current.y
    };
  }

  function syncSettingsInputs() {
    if (!settingsInputX || !settingsInputY) return;
    var ratio = centerRatioFromPosition(getHostPosition());
    settingsInputX.value = String(Math.round(ratio.x * 100));
    settingsInputY.value = String(Math.round(ratio.y * 100));
  }

  function positionSettings() {
    if (!settingsEl || !settingsOpen) return;
    var size = getHostSize();
    var viewport = getViewportSize();
    var hostPosition = getHostPosition();
    var rect = settingsEl.getBoundingClientRect();
    var width = rect.width || 208;
    var height = rect.height || 170;

    var left = -(width + 8);
    if (hostPosition.left + left < EDGE_MARGIN) left = size.width + 8;

    var top = 0;
    var overflowBottom = hostPosition.top + height - (viewport.height - EDGE_MARGIN);
    if (overflowBottom > 0) top = -overflowBottom;
    if (hostPosition.top + top < EDGE_MARGIN) top = EDGE_MARGIN - hostPosition.top;

    settingsEl.style.left = Math.round(left) + "px";
    settingsEl.style.top = Math.round(top) + "px";
  }

  function onSettingsInput() {
    previewRatio = readSettingsInputs();
    if (!destroyed && host) applyHostStyle(positionFromCenterRatio(previewRatio));
    scheduleGlassUpdate();
  }

  function openSettings() {
    if (destroyed || !settingsEl) return;
    settingsOpen = true;
    settingsEl.classList.add("open");
    syncSettingsInputs();
    positionSettings();
    try {
      settingsInputY.focus({ preventScroll: true });
      settingsInputY.select();
    } catch (error) {
      // Focus is a nicety; ignore pages that block it.
    }
  }

  function closeSettings() {
    settingsOpen = false;
    previewRatio = null;
    if (settingsEl) settingsEl.classList.remove("open");
    if (!destroyed && host) {
      applyHostStyle(preferredPosition());
      scheduleGlassUpdate();
      if (!pointerInside) scheduleAutoCollapse();
    }
  }

  function saveSettings() {
    persistDefaultRatio(readSettingsInputs());
    manualPositionRatio = null;
    closeSettings();
  }

  function onPanelContextMenu(event) {
    stopEvent(event);
    if (settingsOpen) {
      closeSettings();
    } else {
      openSettings();
    }
  }

  function stopEvent(event) {
    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === "function") event.stopImmediatePropagation();
  }

  function parseCssColor(value) {
    if (!value) return null;
    var match = /rgba?\(([^)]+)\)/.exec(String(value));
    if (!match) return null;
    var parts = match[1].split(/[\s,\/]+/).filter(Boolean);
    var r = parseFloat(parts[0]);
    var g = parseFloat(parts[1]);
    var b = parseFloat(parts[2]);
    if (!isFinite(r) || !isFinite(g) || !isFinite(b)) return null;
    var a = parts.length > 3 ? parseFloat(parts[3]) : 1;
    if (!isFinite(a)) a = 1;
    return { r: r, g: g, b: b, a: Math.min(1, Math.max(0, a)) };
  }

  function backdropIsLight() {
    try {
      if (typeof document.elementsFromPoint !== "function" || !host || !host.isConnected) return glassLight;
      var rect = host.getBoundingClientRect();
      var viewport = getViewportSize();
      var x = Math.min(Math.max(rect.left + rect.width / 2, 0), Math.max(0, viewport.width - 1));
      var y = Math.min(Math.max(rect.top + rect.height / 2, 0), Math.max(0, viewport.height - 1));
      var stack = document.elementsFromPoint(x, y);
      var layers = [];
      for (var index = 0; index < stack.length; index += 1) {
        if (stack[index] === host) continue;
        var color = parseCssColor(window.getComputedStyle(stack[index]).backgroundColor);
        if (color && color.a > 0) layers.push(color);
      }
      // Composite the visible background stack bottom-up over an assumed
      // white canvas, then classify by perceived luminance.
      var luminance = 1;
      for (var back = layers.length - 1; back >= 0; back -= 1) {
        var layer = layers[back];
        var own = (0.299 * layer.r + 0.587 * layer.g + 0.114 * layer.b) / 255;
        luminance = layer.a * own + (1 - layer.a) * luminance;
      }
      return luminance >= 0.55;
    } catch (error) {
      return glassLight;
    }
  }

  function updateGlassScheme() {
    if (destroyed || !host || !panel) return;
    glassLight = backdropIsLight();
    panel.classList.toggle("glass-light", glassLight);
    panel.classList.toggle("glass-dark", !glassLight);
    if (settingsEl) {
      settingsEl.classList.toggle("glass-light", glassLight);
      settingsEl.classList.toggle("glass-dark", !glassLight);
    }
  }

  function scheduleGlassUpdate() {
    if (glassUpdateTimer || destroyed) return;
    glassUpdateTimer = window.setTimeout(function () {
      glassUpdateTimer = null;
      updateGlassScheme();
    }, 180);
  }

  function onAnyScroll() {
    scheduleGlassUpdate();
  }

  function actionFromEvent(event) {
    var target = event.target;
    if (!target || typeof target.closest !== "function") return null;
    var actionNode = target.closest("[data-action]");
    return actionNode ? actionNode.dataset.action : null;
  }

  function onPointerDown(event) {
    if (event.button !== undefined && event.button !== 0) return;
    var current = getHostPosition();
    drag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startLeft: current.left,
      startTop: current.top,
      moved: false,
      action: actionFromEvent(event)
    };

    try {
      panel.setPointerCapture(event.pointerId);
    } catch (error) {
      // Some old pages/polyfills can reject capture; dragging still works.
    }
    stopEvent(event);
  }

  function onPointerMove(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;

    var dx = event.clientX - drag.startX;
    var dy = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) < 4) {
      stopEvent(event);
      return;
    }

    drag.moved = true;
    if (panel) panel.classList.add("dragging");

    var next = clampPosition({
      left: drag.startLeft + dx,
      top: drag.startTop + dy
    });
    applyHostStyle(next);
    stopEvent(event);
  }

  function onPointerUp(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;

    var completed = drag;
    drag = null;
    if (panel) panel.classList.remove("dragging");

    try {
      panel.releasePointerCapture(event.pointerId);
    } catch (error) {
      // Nothing to release.
    }

    if (completed.moved) {
      rememberManualPosition();
      scheduleGlassUpdate();
      if (settingsOpen) {
        previewRatio = null;
        syncSettingsInputs();
        positionSettings();
      }
    } else if (completed.action) {
      runAction(completed.action);
    }
    stopEvent(event);
  }

  function onPointerCancel(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    drag = null;
    if (panel) panel.classList.remove("dragging");
    stopEvent(event);
  }

  function onKeyDown(event) {
    if (event.key !== "Enter" && event.key !== " ") return;
    var action = actionFromEvent(event);
    if (!action) return;
    runAction(action);
    stopEvent(event);
  }

  function runAction(action) {
    if (action === "top") {
      scrollPage("top");
    } else if (action === "bottom") {
      scrollPage("bottom");
    } else if (action === "toggle") {
      toggleCollapsed();
    } else if (action === "close") {
      destroyControls();
    }
  }

  function syncCollapsedState() {
    if (!panel || !toggleButton) return;

    panel.classList.toggle("collapsed", collapsed);
    if (lensEl) lensEl.classList.toggle("ball", collapsed);
    panel.setAttribute("aria-label", collapsed ? "Page scroll controls collapsed" : "Page scroll controls");
    var toggleLabel = collapsed ? "Expand page scroll controls" : "Collapse page scroll controls";
    toggleButton.setAttribute("aria-label", toggleLabel);
    toggleButton.title = toggleLabel;
    toggleButton.textContent = collapsed ? "▲\n▼" : "−";
    applyHostStyle(currentPosition || defaultPosition());
    if (settingsOpen) positionSettings();
  }

  function setCollapsed(next) {
    next = !!next;
    if (collapsed === next) return;
    var oldSize = getHostSize();
    // Anchor from the logical target position, not the animated rect, so a
    // toggle that lands mid-transition still resolves to a stable spot.
    var oldPosition = currentPosition
      ? { left: currentPosition.left, top: currentPosition.top }
      : getHostPosition();

    collapsed = next;
    currentPosition = anchorSizeChange(oldSize, oldPosition, getHostSize());
    syncCollapsedState();
    if (manualPositionRatio) rememberManualPosition();
    scheduleGlassUpdate();
  }

  function toggleCollapsed() {
    clearLingerTimer();
    setCollapsed(!collapsed);
  }

  function clearLingerTimer() {
    if (lingerTimer) {
      window.clearTimeout(lingerTimer);
      lingerTimer = null;
    }
  }

  function scheduleAutoCollapse() {
    clearLingerTimer();
    if (destroyed || collapsed) return;
    lingerTimer = window.setTimeout(function () {
      lingerTimer = null;
      if (destroyed || collapsed || drag || settingsOpen || pointerInside) return;
      setCollapsed(true);
    }, EXPAND_LINGER_MS);
  }

  function onPanelPointerEnter() {
    pointerInside = true;
    clearLingerTimer();
    if (!destroyed && collapsed) setCollapsed(false);
  }

  function onPanelPointerLeave() {
    pointerInside = false;
    scheduleAutoCollapse();
  }

  function onPanelFocusIn() {
    clearLingerTimer();
    if (!destroyed && collapsed) setCollapsed(false);
  }

  function onPanelFocusOut() {
    if (!pointerInside) scheduleAutoCollapse();
  }

  function getHostPosition() {
    if (!host || !host.isConnected) return currentPosition || defaultPosition();
    var rect = host.getBoundingClientRect();
    return clampPosition({ left: rect.left, top: rect.top });
  }

  function mountHost() {
    if (destroyed) return;
    if (!host) buildHost();
    if (!drag) applyHostStyle(preferredPosition());

    var parent = document.body || document.documentElement;
    if (!parent) {
      requestAnimationFrame(mountHost);
      return;
    }
    if (!host.isConnected || host.parentNode !== parent) parent.appendChild(host);
    installObserver();
    updateGlassScheme();
  }

  function installObserver() {
    if (observer || !document.documentElement) return;
    observer = new MutationObserver(function () {
      if (!destroyed && host && !host.isConnected) requestAnimationFrame(mountHost);
    });
    observer.observe(document.documentElement, { childList: true });
    if (document.body) observer.observe(document.body, { childList: true });
  }

  function destroyControls() {
    destroyed = true;
    collapsed = true;
    drag = null;
    pointerInside = false;
    manualPositionRatio = null;
    previewRatio = null;
    settingsOpen = false;
    clearLingerTimer();
    if (ensureTimer) window.clearInterval(ensureTimer);
    if (glassUpdateTimer) {
      window.clearTimeout(glassUpdateTimer);
      glassUpdateTimer = null;
    }
    if (observer) observer.disconnect();
    if (host && host.parentNode) host.parentNode.removeChild(host);
    window.removeEventListener("resize", onResize, true);
    window.removeEventListener("scroll", onAnyScroll, true);
  }

  function onResize() {
    if (!host || destroyed) return;
    applyHostStyle(preferredPosition());
    updateGlassScheme();
    if (settingsOpen) {
      syncSettingsInputs();
      positionSettings();
    }
  }

  function saveCurrentPositionAsDefault() {
    persistDefaultRatio(centerRatioFromPosition(getHostPosition()));
    manualPositionRatio = null;
    previewRatio = null;
    if (!destroyed && host) applyHostStyle(preferredPosition());
    if (settingsOpen) syncSettingsInputs();
  }

  function resetDefaultPosition() {
    savedDefaultRatio = null;
    manualPositionRatio = null;
    previewRatio = null;
    removeStorage(STORAGE_KEY);
    if (!destroyed && host) applyHostStyle(preferredPosition());
    if (settingsOpen) {
      syncSettingsInputs();
      positionSettings();
    }
  }

  function registerMenuCommands() {
    if (typeof GM_registerMenuCommand !== "function") return;
    try {
      GM_registerMenuCommand("打开位置设置（或右键悬浮控件）", openSettings);
      GM_registerMenuCommand("保存当前位置为默认位置", saveCurrentPositionAsDefault);
      GM_registerMenuCommand("恢复内置默认位置（右侧 20% 高度）", resetDefaultPosition);
    } catch (error) {
      // Menu registration is optional; the widget works without it.
    }
  }

  function isRootScroller(element) {
    return element === window || element === document || element === document.documentElement || element === document.body || element === document.scrollingElement;
  }

  function getRootScroller() {
    return document.scrollingElement || document.documentElement || document.body;
  }

  function getScrollTop(element) {
    if (isRootScroller(element)) {
      return window.pageYOffset || getRootScroller().scrollTop || document.body.scrollTop || 0;
    }
    return element.scrollTop;
  }

  function setScrollTop(element, value) {
    if (isRootScroller(element)) {
      window.scrollTo(window.pageXOffset || 0, value);
      if (document.documentElement) document.documentElement.scrollTop = value;
      if (document.body) document.body.scrollTop = value;
      return;
    }
    element.scrollTop = value;
  }

  function maxScrollTop(element) {
    if (isRootScroller(element)) {
      var root = getRootScroller();
      var body = document.body;
      var scrollHeight = Math.max(
        root ? root.scrollHeight : 0,
        body ? body.scrollHeight : 0,
        document.documentElement ? document.documentElement.scrollHeight : 0
      );
      return Math.max(0, scrollHeight - window.innerHeight);
    }
    return Math.max(0, element.scrollHeight - element.clientHeight);
  }

  function getViewportRect() {
    var viewport = getViewportSize();
    return {
      left: 0,
      top: 0,
      right: viewport.width,
      bottom: viewport.height,
      width: viewport.width,
      height: viewport.height
    };
  }

  function getControlPoint() {
    if (host && host.isConnected) {
      var rect = host.getBoundingClientRect();
      return {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2
      };
    }

    var viewport = getViewportSize();
    return {
      x: viewport.width / 2,
      y: viewport.height / 2
    };
  }

  function rectContainsPoint(rect, point) {
    return point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom;
  }

  function distanceFromPointToRect(point, rect) {
    var dx = Math.max(rect.left - point.x, 0, point.x - rect.right);
    var dy = Math.max(rect.top - point.y, 0, point.y - rect.bottom);
    return Math.hypot(dx, dy);
  }

  function visibleArea(rect) {
    var viewport = getViewportSize();
    var width = Math.max(0, Math.min(rect.right, viewport.width) - Math.max(rect.left, 0));
    var height = Math.max(0, Math.min(rect.bottom, viewport.height) - Math.max(rect.top, 0));
    return width * height;
  }

  function hasScrollableOverflow(element) {
    var style = window.getComputedStyle(element);
    var overflow = (style.overflowY + " " + style.overflow).toLowerCase();
    return /\b(auto|scroll|overlay|hidden)\b/.test(overflow);
  }

  function getScrollerCandidate(element, point) {
    if (!element || element === host) return null;
    if (maxScrollTop(element) <= 8) return null;

    var root = getRootScroller();
    var isRoot = element === root || isRootScroller(element);
    if (!isRoot && !hasScrollableOverflow(element)) return null;

    var rect = isRoot ? getViewportRect() : element.getBoundingClientRect();
    var area = visibleArea(rect);
    if (!isRoot && area < 9000) return null;

    return {
      element: isRoot ? root : element,
      isRoot: isRoot,
      rect: rect,
      area: area,
      containsPoint: rectContainsPoint(rect, point),
      distance: distanceFromPointToRect(point, rect),
      scrollDistance: maxScrollTop(element)
    };
  }

  function pointCandidateScore(candidate) {
    var areaScore = Math.min(candidate.area, 800000);
    var score = areaScore + candidate.scrollDistance * 30;
    if (candidate.containsPoint) score += 100000000;
    score -= candidate.distance * 200;
    if (candidate.isRoot) score -= 10000000;
    return score;
  }

  function chooseBetterCandidate(best, next) {
    if (!next) return best;
    if (!best) return next;
    return pointCandidateScore(next) > pointCandidateScore(best) ? next : best;
  }

  function findPrimaryScroller() {
    var point = getControlPoint();
    var root = getRootScroller();
    var rootCandidate = getScrollerCandidate(root, point);
    var bestAtPoint = null;
    var bestNearby = null;
    var elements = document.querySelectorAll("body *");

    for (var index = 0; index < elements.length; index += 1) {
      var candidate = getScrollerCandidate(elements[index], point);
      if (!candidate || candidate.isRoot) continue;

      if (candidate.containsPoint) {
        bestAtPoint = chooseBetterCandidate(bestAtPoint, candidate);
      }
      bestNearby = chooseBetterCandidate(bestNearby, candidate);
    }

    if (bestAtPoint) return bestAtPoint.element;
    if (bestNearby && bestNearby.distance <= 160) return bestNearby.element;
    if (rootCandidate) return rootCandidate.element;
    return bestNearby ? bestNearby.element : root;
  }

  function animateScroll(element, targetTop) {
    var startTop = getScrollTop(element);
    var distance = targetTop - startTop;
    if (Math.abs(distance) < 1) {
      setScrollTop(element, targetTop);
      return;
    }

    var duration = Math.min(520, Math.max(180, Math.abs(distance) / 5));
    var startTime = performance.now();

    function easeOutCubic(value) {
      return 1 - Math.pow(1 - value, 3);
    }

    function step(now) {
      var progress = Math.min(1, (now - startTime) / duration);
      setScrollTop(element, startTop + distance * easeOutCubic(progress));
      if (progress < 1) {
        requestAnimationFrame(step);
      } else {
        setScrollTop(element, targetTop);
      }
    }

    requestAnimationFrame(step);
  }

  function scrollPage(direction) {
    var target = findPrimaryScroller();
    if (!target) return;

    var targetTop = direction === "top" ? 0 : maxScrollTop(target);
    animateScroll(target, targetTop);
  }

  savedDefaultRatio = loadSavedDefaultRatio();
  mountHost();
  ensureTimer = window.setInterval(mountHost, 1000);
  window.addEventListener("resize", onResize, true);
  window.addEventListener("scroll", onAnyScroll, { capture: true, passive: true });
  document.addEventListener("DOMContentLoaded", mountHost, { once: true, capture: true });
  window.addEventListener("load", mountHost, { once: true, capture: true });
  registerMenuCommands();
})();
