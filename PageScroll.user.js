// ==UserScript==
// @name         Page Scroll Floating Arrows
// @namespace    https://github.com/decli/pagescroll
// @version      0.7.0
// @description  Compact draggable floating arrows for fast page top/bottom scrolling. Right-click the widget to configure its default position. Supports SPA pages with custom scroll containers.
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
  var EXPANDED_WIDTH = 50;
  var EXPANDED_HEIGHT = 50;
  var COLLAPSED_WIDTH = 26;
  var COLLAPSED_HEIGHT = 26;
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
  var collapsed = false;
  var drag = null;
  var currentPosition = null;
  var manualPositionRatio = null;
  var savedDefaultRatio = null;
  var previewRatio = null;
  var settingsEl = null;
  var settingsInputX = null;
  var settingsInputY = null;
  var settingsOpen = false;

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

  function centerRatioFromPosition(position) {
    var size = getHostSize();
    var viewport = getViewportSize();
    return {
      x: clamp01((position.left + size.width / 2) / Math.max(1, viewport.width)),
      y: clamp01((position.top + size.height / 2) / Math.max(1, viewport.height))
    };
  }

  function positionFromCenterRatio(ratio) {
    var size = getHostSize();
    var viewport = getViewportSize();
    return clampPosition({
      left: viewport.width * clamp01(ratio && ratio.x) - size.width / 2,
      top: viewport.height * clamp01(ratio && ratio.y) - size.height / 2
    });
  }

  function preferredPosition() {
    if (previewRatio) return positionFromCenterRatio(previewRatio);
    if (manualPositionRatio) return ratioToPosition(manualPositionRatio);
    if (savedDefaultRatio) return positionFromCenterRatio(savedDefaultRatio);
    return defaultPosition();
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
      ".panel{width:" + EXPANDED_WIDTH + "px;height:" + EXPANDED_HEIGHT + "px;box-sizing:border-box;padding:4px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;border:1px solid rgba(255,255,255,.18);border-radius:13px;background:rgba(24,24,27,.88);box-shadow:0 6px 20px rgba(0,0,0,.28);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);font-family:Arial,Helvetica,sans-serif;user-select:none;-webkit-user-select:none;touch-action:none;cursor:grab;}",
      ".panel.collapsed{position:relative;width:" + COLLAPSED_WIDTH + "px;height:" + COLLAPSED_HEIGHT + "px;padding:0;border:0;border-radius:0;background:transparent;box-shadow:none;filter:none;backdrop-filter:none;-webkit-backdrop-filter:none;display:block;overflow:visible;}",
      ".panel.dragging{cursor:grabbing;opacity:.92;}",
      ".topbar{display:flex;align-items:center;gap:4px;opacity:.55;transition:opacity .12s ease;}",
      ".panel:hover .topbar,.panel:focus-within .topbar{opacity:1;}",
      ".panel.collapsed .topbar{position:absolute;top:0;right:0;width:" + COLLAPSED_WIDTH + "px;height:" + COLLAPSED_HEIGHT + "px;justify-content:center;opacity:1;}",
      ".arrows{display:flex;align-items:center;gap:4px;}",
      ".panel.collapsed .arrows{display:none;}",
      "button{appearance:none;-webkit-appearance:none;box-sizing:border-box;margin:0;border:0;padding:0;font-family:Arial,Helvetica,sans-serif;line-height:1;display:grid;place-items:center;cursor:pointer;user-select:none;-webkit-user-select:none;touch-action:none;}",
      ".toggle,.close{width:18px;height:18px;border-radius:999px;background:rgba(255,255,255,.14);color:#f8fafc;font-size:11px;font-weight:700;}",
      ".toggle:hover{background:#38bdf8;color:#001018;}",
      ".close:hover{background:rgba(248,113,113,.96);color:#111827;}",
      ".panel.collapsed .toggle{width:" + COLLAPSED_WIDTH + "px;height:" + COLLAPSED_HEIGHT + "px;background:rgba(24,24,27,.92);border:1px solid rgba(255,255,255,.18);font-size:12px;box-shadow:0 4px 14px rgba(0,0,0,.24);}",
      ".panel.collapsed .toggle:hover{background:#38bdf8;color:#001018;}",
      ".panel.collapsed .close{display:none;}",
      ".arrow{width:18px;height:18px;border-radius:999px;background:rgba(255,255,255,.95);color:#111827;font-size:13px;font-weight:800;box-shadow:0 1px 4px rgba(0,0,0,.2);}",
      ".arrow:hover{background:#38bdf8;color:#001018;}",
      ".arrow:active,.toggle:active,.close:active{transform:translateY(1px);}",
      ".arrow:focus-visible,.toggle:focus-visible,.close:focus-visible{outline:2px solid #facc15;outline-offset:2px;}",
      ".settings{position:absolute;z-index:1;width:208px;box-sizing:border-box;padding:10px;display:none;flex-direction:column;gap:8px;border:1px solid rgba(255,255,255,.18);border-radius:10px;background:rgba(24,24,27,.96);box-shadow:0 12px 32px rgba(0,0,0,.4);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#f8fafc;cursor:default;user-select:none;-webkit-user-select:none;}",
      ".settings.open{display:flex;}",
      ".settings-head{display:flex;align-items:center;justify-content:space-between;font-weight:700;}",
      ".settings-close{width:16px;height:16px;border-radius:999px;background:rgba(255,255,255,.14);color:#f8fafc;font-size:10px;font-weight:700;}",
      ".settings-close:hover{background:rgba(248,113,113,.96);color:#111827;}",
      ".settings-row{display:flex;align-items:center;justify-content:space-between;gap:6px;}",
      ".settings-row label{color:rgba(248,250,252,.85);}",
      ".settings-field{display:flex;align-items:center;gap:4px;}",
      ".settings-field span{color:rgba(248,250,252,.6);font-size:11px;}",
      ".settings-row input{width:64px;box-sizing:border-box;padding:4px 6px;border:1px solid rgba(255,255,255,.22);border-radius:6px;background:rgba(255,255,255,.08);color:#f8fafc;font-size:12px;font-family:inherit;outline:none;user-select:text;-webkit-user-select:text;}",
      ".settings-row input:focus{border-color:#38bdf8;}",
      ".settings-hint{color:rgba(248,250,252,.55);font-size:11px;line-height:1.5;}",
      ".settings-actions{display:flex;justify-content:flex-end;gap:6px;}",
      ".settings-actions button{padding:5px 9px;border-radius:6px;background:rgba(255,255,255,.12);color:#f8fafc;font-size:11px;font-weight:600;}",
      ".settings-actions button:hover{background:rgba(255,255,255,.22);}",
      ".settings-actions button.primary{background:#38bdf8;color:#001018;}",
      ".settings-actions button.primary:hover{background:#7dd3fc;}"
    ].join("");

    panel = document.createElement("div");
    panel.className = "panel";
    panel.setAttribute("role", "group");
    panel.setAttribute("aria-label", "Page scroll controls");
    panel.title = "拖动调整位置，右键打开设置";

    var topbar = document.createElement("div");
    topbar.className = "topbar";
    toggleButton = makeButton("toggle", "Collapse page scroll controls", "−", "toggle");
    topbar.appendChild(makeButton("close", "Close page scroll controls until reload", "×", "close"));
    topbar.appendChild(toggleButton);

    var arrows = document.createElement("div");
    arrows.className = "arrows";
    arrows.appendChild(makeButton("top", "Scroll to page top", "↑", "arrow"));
    arrows.appendChild(makeButton("bottom", "Scroll to page bottom", "↓", "arrow"));

    panel.appendChild(topbar);
    panel.appendChild(arrows);
    syncCollapsedState();

    panel.addEventListener("pointerdown", onPointerDown, true);
    panel.addEventListener("pointermove", onPointerMove, true);
    panel.addEventListener("pointerup", onPointerUp, true);
    panel.addEventListener("pointercancel", onPointerCancel, true);
    panel.addEventListener("click", stopEvent, true);
    panel.addEventListener("keydown", onKeyDown, true);
    panel.addEventListener("contextmenu", onPanelContextMenu, true);

    shadow.appendChild(style);
    shadow.appendChild(panel);
    buildSettings(shadow);
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
    settingsEl.className = "settings";
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
    if (!destroyed && host) applyHostStyle(preferredPosition());
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
    panel.setAttribute("aria-label", collapsed ? "Page scroll controls collapsed" : "Page scroll controls");
    var toggleLabel = collapsed ? "Expand page scroll controls" : "Collapse page scroll controls";
    toggleButton.setAttribute("aria-label", toggleLabel);
    toggleButton.title = toggleLabel;
    toggleButton.textContent = collapsed ? "↕" : "−";
    applyHostStyle(currentPosition || defaultPosition());
    if (settingsOpen) positionSettings();
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
    previewRatio = null;
    settingsOpen = false;
    if (ensureTimer) window.clearInterval(ensureTimer);
    if (observer) observer.disconnect();
    if (host && host.parentNode) host.parentNode.removeChild(host);
    window.removeEventListener("resize", onResize, true);
  }

  function onResize() {
    if (!host || destroyed) return;
    applyHostStyle(preferredPosition());
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
  document.addEventListener("DOMContentLoaded", mountHost, { once: true, capture: true });
  window.addEventListener("load", mountHost, { once: true, capture: true });
  registerMenuCommands();
})();
