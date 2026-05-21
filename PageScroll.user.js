// ==UserScript==
// @name         Page Scroll Floating Arrows
// @namespace    https://github.com/decli/pagescroll
// @version      0.2.0
// @description  Draggable floating arrows for fast page top/bottom scrolling, including SPA pages with custom scroll containers.
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
// ==/UserScript==

(function () {
  "use strict";

  if (window.__pageScrollFloatingArrowsInstalled) return;
  window.__pageScrollFloatingArrowsInstalled = true;

  var STORAGE_POS = "pageScrollFloatingArrows.position.v1";
  var STORAGE_COLLAPSED = "pageScrollFloatingArrows.collapsed.v1";
  var HOST_ID = "page-scroll-floating-arrows-" + Math.random().toString(36).slice(2);
  var Z_INDEX = "2147483647";
  var EXPANDED_WIDTH = 54;
  var EXPANDED_HEIGHT = 132;
  var COLLAPSED_SIZE = 42;
  var EDGE_MARGIN = 8;

  var host = null;
  var panel = null;
  var toggleButton = null;
  var observer = null;
  var collapsed = false;
  var drag = null;
  var currentPosition = null;

  function readValue(key, fallback) {
    try {
      return GM_getValue(key, fallback);
    } catch (error) {
      try {
        var raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
      } catch (innerError) {
        return fallback;
      }
    }
  }

  function writeValue(key, value) {
    try {
      GM_setValue(key, value);
      return;
    } catch (error) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch (innerError) {
        // Ignore storage failures. The control still works for the page load.
      }
    }
  }

  function getHostSize() {
    if (collapsed) return { width: COLLAPSED_SIZE, height: COLLAPSED_SIZE };
    return { width: EXPANDED_WIDTH, height: EXPANDED_HEIGHT };
  }

  function defaultPosition() {
    var size = getHostSize();
    return {
      left: Math.max(EDGE_MARGIN, window.innerWidth - size.width - 24),
      top: Math.max(EDGE_MARGIN, Math.round(window.innerHeight * 0.55 - size.height / 2))
    };
  }

  function clampPosition(position) {
    var size = getHostSize();
    var viewportWidth = Math.max(window.innerWidth || 0, size.width + EDGE_MARGIN * 2);
    var viewportHeight = Math.max(window.innerHeight || 0, size.height + EDGE_MARGIN * 2);
    return {
      left: Math.min(Math.max(Number(position.left) || EDGE_MARGIN, EDGE_MARGIN), viewportWidth - size.width - EDGE_MARGIN),
      top: Math.min(Math.max(Number(position.top) || EDGE_MARGIN, EDGE_MARGIN), viewportHeight - size.height - EDGE_MARGIN)
    };
  }

  function getSavedCollapsed() {
    return readValue(STORAGE_COLLAPSED, false) === true;
  }

  function getSavedPosition() {
    var saved = readValue(STORAGE_POS, null);
    if (!saved || typeof saved !== "object") return defaultPosition();
    return clampPosition(saved);
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
    host.style.setProperty("display", "block", "important");
    host.style.setProperty("visibility", "visible", "important");
    host.style.setProperty("opacity", "1", "important");
    host.style.setProperty("pointer-events", "auto", "important");
    host.style.setProperty("z-index", Z_INDEX, "important");
    host.style.setProperty("contain", "layout style paint", "important");
    host.style.setProperty("isolation", "isolate", "important");
    host.style.setProperty("box-sizing", "border-box", "important");
  }

  function makeButton(action, label, glyph, className) {
    var button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.dataset.action = action;
    button.setAttribute("aria-label", label);
    button.textContent = glyph;
    return button;
  }

  function buildHost() {
    collapsed = getSavedCollapsed();
    var position = getSavedPosition();
    currentPosition = position;
    host = document.createElement("div");
    host.id = HOST_ID;
    host.setAttribute("data-page-scroll-floating-arrows", "true");
    applyHostStyle(position);

    var shadow = host.attachShadow({ mode: "closed" });
    var style = document.createElement("style");
    style.textContent = [
      ":host{all:initial;}",
      ".panel{width:54px;height:132px;box-sizing:border-box;padding:7px 6px 8px;display:flex;flex-direction:column;align-items:center;gap:6px;border:1px solid rgba(255,255,255,.18);border-radius:12px;background:rgba(24,24,27,.88);box-shadow:0 10px 30px rgba(0,0,0,.28);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);font-family:Arial,Helvetica,sans-serif;user-select:none;-webkit-user-select:none;touch-action:none;cursor:grab;}",
      ".panel.collapsed{width:42px;height:42px;padding:0;border-radius:999px;justify-content:center;gap:0;}",
      ".panel.dragging{cursor:grabbing;opacity:.92;}",
      ".topbar{width:100%;height:18px;display:flex;align-items:center;justify-content:flex-end;}",
      ".panel.collapsed .topbar{width:42px;height:42px;justify-content:center;}",
      "button{appearance:none;-webkit-appearance:none;box-sizing:border-box;margin:0;border:0;font-family:Arial,Helvetica,sans-serif;line-height:1;user-select:none;-webkit-user-select:none;touch-action:none;}",
      ".toggle{width:18px;height:18px;border-radius:999px;background:rgba(255,255,255,.14);color:#f8fafc;font-size:15px;font-weight:700;display:grid;place-items:center;padding:0;cursor:pointer;}",
      ".toggle:hover{background:#38bdf8;color:#001018;}",
      ".panel.collapsed .toggle{width:42px;height:42px;background:rgba(24,24,27,.9);border:1px solid rgba(255,255,255,.18);font-size:18px;box-shadow:0 6px 18px rgba(0,0,0,.24);}",
      ".panel.collapsed .toggle:hover{background:#38bdf8;color:#001018;}",
      ".arrow{width:42px;height:42px;border-radius:10px;background:rgba(255,255,255,.95);color:#111827;font-size:25px;font-weight:800;display:grid;place-items:center;padding:0;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.16);}",
      ".panel.collapsed .arrow{display:none;}",
      ".arrow:hover{background:#38bdf8;color:#001018;}",
      ".arrow:active,.toggle:active{transform:translateY(1px);}",
      ".arrow:focus-visible,.toggle:focus-visible{outline:2px solid #facc15;outline-offset:2px;}"
    ].join("");

    panel = document.createElement("div");
    panel.className = "panel";
    panel.setAttribute("role", "group");
    panel.setAttribute("aria-label", "Page scroll controls");

    var topbar = document.createElement("div");
    topbar.className = "topbar";
    toggleButton = makeButton("toggle", "Collapse page scroll controls", "−", "toggle");
    topbar.appendChild(toggleButton);

    panel.appendChild(topbar);
    panel.appendChild(makeButton("top", "Scroll to page top", "↑", "arrow"));
    panel.appendChild(makeButton("bottom", "Scroll to page bottom", "↓", "arrow"));
    syncCollapsedState();

    panel.addEventListener("pointerdown", onPointerDown, true);
    panel.addEventListener("pointermove", onPointerMove, true);
    panel.addEventListener("pointerup", onPointerUp, true);
    panel.addEventListener("pointercancel", onPointerCancel, true);
    panel.addEventListener("click", stopEvent, true);
    panel.addEventListener("keydown", onKeyDown, true);

    shadow.appendChild(style);
    shadow.appendChild(panel);
  }

  function stopEvent(event) {
    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === "function") event.stopImmediatePropagation();
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
      writeValue(STORAGE_POS, getHostPosition());
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
    }
  }

  function syncCollapsedState() {
    if (!panel || !toggleButton) return;

    panel.classList.toggle("collapsed", collapsed);
    panel.setAttribute("aria-label", collapsed ? "Page scroll controls collapsed" : "Page scroll controls");
    toggleButton.setAttribute("aria-label", collapsed ? "Expand page scroll controls" : "Collapse page scroll controls");
    toggleButton.textContent = collapsed ? "↕" : "−";
    applyHostStyle(currentPosition || defaultPosition());
  }

  function toggleCollapsed() {
    collapsed = !collapsed;
    syncCollapsedState();
    writeValue(STORAGE_COLLAPSED, collapsed);
    writeValue(STORAGE_POS, getHostPosition());
  }

  function getHostPosition() {
    if (!host || !host.isConnected) return currentPosition || defaultPosition();
    var rect = host.getBoundingClientRect();
    return clampPosition({ left: rect.left, top: rect.top });
  }

  function mountHost() {
    if (!host) buildHost();
    applyHostStyle(host.isConnected ? getHostPosition() : currentPosition || getSavedPosition());

    var parent = document.body || document.documentElement;
    if (!parent) {
      requestAnimationFrame(mountHost);
      return;
    }
    if (!host.isConnected || host.parentNode !== parent) parent.appendChild(host);
    installObserver();
  }

  function installObserver() {
    if (observer || !document.documentElement) return;
    observer = new MutationObserver(function () {
      if (host && !host.isConnected) requestAnimationFrame(mountHost);
    });
    observer.observe(document.documentElement, { childList: true });
    if (document.body) observer.observe(document.body, { childList: true });
  }

  function onResize() {
    if (!host) return;
    var next = clampPosition(getHostPosition());
    applyHostStyle(next);
    writeValue(STORAGE_POS, next);
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

  function visibleArea(rect) {
    var width = Math.max(0, Math.min(rect.right, window.innerWidth) - Math.max(rect.left, 0));
    var height = Math.max(0, Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0));
    return width * height;
  }

  function hasScrollableOverflow(element) {
    var style = window.getComputedStyle(element);
    var overflow = (style.overflowY + " " + style.overflow).toLowerCase();
    return /\b(auto|scroll|overlay)\b/.test(overflow);
  }

  function findPrimaryScroller() {
    var root = getRootScroller();
    if (root && maxScrollTop(root) > 8) return root;

    var best = null;
    var bestScore = 0;
    var elements = document.querySelectorAll("body *");

    for (var index = 0; index < elements.length; index += 1) {
      var element = elements[index];
      if (!element || element === host) continue;
      if (element.scrollHeight <= element.clientHeight + 8) continue;
      if (!hasScrollableOverflow(element)) continue;

      var rect = element.getBoundingClientRect();
      var area = visibleArea(rect);
      if (area < 9000) continue;

      var scrollDistance = element.scrollHeight - element.clientHeight;
      var centered = rect.left < window.innerWidth * 0.75 && rect.right > window.innerWidth * 0.25 ? 1.15 : 1;
      var score = (area + scrollDistance * 30) * centered;
      if (score > bestScore) {
        best = element;
        bestScore = score;
      }
    }

    return best || root;
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

    var root = getRootScroller();
    if (root && root !== target && maxScrollTop(root) > 8) {
      animateScroll(root, direction === "top" ? 0 : maxScrollTop(root));
    }
  }

  mountHost();
  window.setInterval(mountHost, 1000);
  window.addEventListener("resize", onResize, true);
  document.addEventListener("DOMContentLoaded", mountHost, { once: true, capture: true });
  window.addEventListener("load", mountHost, { once: true, capture: true });
})();
