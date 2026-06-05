// ==UserScript==
// @name         Page Scroll Floating Arrows
// @namespace    https://github.com/decli/pagescroll
// @version      0.5.0
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
// @grant        none
// ==/UserScript==

(function () {
  "use strict";

  if (window.__pageScrollFloatingArrowsInstalled) return;
  window.__pageScrollFloatingArrowsInstalled = true;

  var HOST_ID = "page-scroll-floating-arrows-" + Math.random().toString(36).slice(2);
  var Z_INDEX = "2147483647";
  var EXPANDED_WIDTH = 54;
  var EXPANDED_HEIGHT = 132;
  var COLLAPSED_WIDTH = 36;
  var COLLAPSED_HEIGHT = 36;
  var EDGE_MARGIN = 8;
  var DEFAULT_RIGHT_GAP = 24;
  var DEFAULT_VERTICAL_RATIO = 0.5;

  var host = null;
  var panel = null;
  var toggleButton = null;
  var observer = null;
  var ensureTimer = null;
  var destroyed = false;
  var collapsed = false;
  var drag = null;
  var currentPosition = null;
  var manualPositionRatio = null;

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

  function getPositionRange() {
    var size = getHostSize();
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

  function defaultPosition() {
    var size = getHostSize();
    var viewport = getViewportSize();
    return {
      left: Math.max(EDGE_MARGIN, viewport.width - size.width - DEFAULT_RIGHT_GAP),
      top: Math.max(EDGE_MARGIN, Math.round(viewport.height * DEFAULT_VERTICAL_RATIO - size.height / 2))
    };
  }

  function clampPosition(position) {
    var range = getPositionRange();
    return {
      left: Math.min(Math.max(Number(position.left) || EDGE_MARGIN, range.minLeft), range.maxLeft),
      top: Math.min(Math.max(Number(position.top) || EDGE_MARGIN, range.minTop), range.maxTop)
    };
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

  function preferredPosition() {
    return manualPositionRatio ? ratioToPosition(manualPositionRatio) : defaultPosition();
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
      ".panel{width:54px;height:132px;box-sizing:border-box;padding:7px 6px 8px;display:flex;flex-direction:column;align-items:center;gap:6px;border:1px solid rgba(255,255,255,.18);border-radius:12px;background:rgba(24,24,27,.88);box-shadow:0 10px 30px rgba(0,0,0,.28);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);font-family:Arial,Helvetica,sans-serif;user-select:none;-webkit-user-select:none;touch-action:none;cursor:grab;}",
      ".panel.collapsed{position:relative;width:36px;height:36px;padding:0;border:0;border-radius:0;background:transparent;box-shadow:none;filter:none;backdrop-filter:none;-webkit-backdrop-filter:none;display:block;overflow:visible;}",
      ".panel.dragging{cursor:grabbing;opacity:.92;}",
      ".topbar{width:100%;height:18px;display:flex;align-items:center;justify-content:space-between;}",
      ".panel.collapsed .topbar{position:absolute;top:0;right:0;width:36px;height:36px;justify-content:center;}",
      "button{appearance:none;-webkit-appearance:none;box-sizing:border-box;margin:0;border:0;font-family:Arial,Helvetica,sans-serif;line-height:1;user-select:none;-webkit-user-select:none;touch-action:none;}",
      ".toggle{width:18px;height:18px;border-radius:999px;background:rgba(255,255,255,.14);color:#f8fafc;font-size:15px;font-weight:700;display:grid;place-items:center;padding:0;cursor:pointer;}",
      ".toggle:hover{background:#38bdf8;color:#001018;}",
      ".panel.collapsed .toggle{width:36px;height:36px;background:rgba(24,24,27,.94);border:1px solid rgba(255,255,255,.18);font-size:16px;box-shadow:none;}",
      ".panel.collapsed .toggle:hover{background:#38bdf8;color:#001018;}",
      ".close{width:18px;height:18px;border-radius:999px;background:rgba(255,255,255,.14);color:#f8fafc;font-size:14px;font-weight:700;display:grid;place-items:center;padding:0;cursor:pointer;box-shadow:none;}",
      ".close:hover{background:rgba(248,113,113,.96);color:#111827;}",
      ".panel.collapsed .close{display:none;}",
      ".arrow{width:42px;height:42px;border-radius:10px;background:rgba(255,255,255,.95);color:#111827;font-size:25px;font-weight:800;display:grid;place-items:center;padding:0;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.16);}",
      ".panel.collapsed .arrow{display:none;}",
      ".arrow:hover{background:#38bdf8;color:#001018;}",
      ".arrow:active,.toggle:active,.close:active{transform:translateY(1px);}",
      ".arrow:focus-visible,.toggle:focus-visible,.close:focus-visible{outline:2px solid #facc15;outline-offset:2px;}"
    ].join("");

    panel = document.createElement("div");
    panel.className = "panel";
    panel.setAttribute("role", "group");
    panel.setAttribute("aria-label", "Page scroll controls");

    var topbar = document.createElement("div");
    topbar.className = "topbar";
    toggleButton = makeButton("toggle", "Collapse page scroll controls", "−", "toggle");
    topbar.appendChild(makeButton("close", "Close page scroll controls until reload", "×", "close"));
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
      rememberManualPosition();
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
    panel.setAttribute("aria-label", collapsed ? "Page scroll controls collapsed" : "Page scroll controls");
    toggleButton.setAttribute("aria-label", collapsed ? "Expand page scroll controls" : "Collapse page scroll controls");
    toggleButton.textContent = collapsed ? "↕" : "−";
    applyHostStyle(currentPosition || defaultPosition());
  }

  function toggleCollapsed() {
    var oldSize = getHostSize();
    var oldPosition = getHostPosition();
    var center = {
      x: oldPosition.left + oldSize.width / 2,
      y: oldPosition.top + oldSize.height / 2
    };

    collapsed = !collapsed;
    var newSize = getHostSize();
    currentPosition = clampPosition({
      left: center.x - newSize.width / 2,
      top: center.y - newSize.height / 2
    });
    syncCollapsedState();
    if (manualPositionRatio) rememberManualPosition();
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
    collapsed = false;
    drag = null;
    manualPositionRatio = null;
    if (ensureTimer) window.clearInterval(ensureTimer);
    if (observer) observer.disconnect();
    if (host && host.parentNode) host.parentNode.removeChild(host);
    window.removeEventListener("resize", onResize, true);
  }

  function onResize() {
    if (!host || destroyed) return;
    applyHostStyle(preferredPosition());
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

  mountHost();
  ensureTimer = window.setInterval(mountHost, 1000);
  window.addEventListener("resize", onResize, true);
  document.addEventListener("DOMContentLoaded", mountHost, { once: true, capture: true });
  window.addEventListener("load", mountHost, { once: true, capture: true });
})();
