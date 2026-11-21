// ---------------------------------------------------------
// app.js: starts RoomFund in the browser.
//   - the router: #/items, #/items/3, #/settings ... → a screen
//   - screen transitions (Section 5): forward slides in from the
//     right (280ms), back slides out to the right, tabs are instant
//   - the floating header + floating tab bar (Section 4)
// ---------------------------------------------------------
import { h, px, iconButton, store, auth, api, prefs, reduceMotion, applyReduceMotion, applyTheme, setLoggedOutHandler, iso, today } from "./lib.js";
import { icon, tabIcon } from "./icons.js";
import * as A from "./screens/auth.js";
import * as I from "./screens/items.js";
import * as F from "./screens/itemform.js";
import * as D from "./screens/detail.js";
import * as T from "./screens/timeline.js";
import * as S from "./screens/savings.js";
import * as P from "./screens/progress.js";
import * as G from "./screens/settings.js";
import * as R from "./screens/room.js";
import { paydayCheckin } from "./screens/popups.js";
import { showBadges, animateTabIcon } from "./fx.js";
import { adviseInstall } from "./install.js";

const appEl = document.getElementById("app");

// ---------- Routes: pattern → screen function ----------
const ROUTES = [
  ["/login", A.loginScreen, { public: true }],
  ["/signup", A.signupScreen, { public: true }],
  ["/forgot", A.forgotScreen, { public: true }],
  ["/forgot/sent", A.forgotSentScreen, { public: true }],
  ["/reset", A.resetScreen, { public: true }],
  ["/password-changed", A.passwordChangedScreen, { public: true }],
  ["/items", I.itemsScreen],
  ["/search", I.searchScreen],
  ["/items/new", F.addItemScreen],
  ["/items/:id/edit", F.editItemScreen],
  ["/items/:id", D.detailScreen],
  ["/timeline", T.timelineScreen],
  ["/savings", S.savingsScreen],
  ["/progress", P.progressScreen],
  ["/settings", G.settingsScreen],
  ["/payday", G.paydaySetupScreen],
  ["/room", R.roomScreen],
];

function match(path) {
  for (const [pattern, fn, opts] of ROUTES) {
    const keys = [];
    const re = new RegExp("^" + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return "([^/]+)"; }) + "$");
    const m = path.match(re);
    if (m) return { fn, opts: opts || {}, params: Object.fromEntries(keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) };
  }
  return null;
}
function parseHash() {
  const raw = location.hash.replace(/^#/, "") || "/";
  const [path, qs] = raw.split("?");
  return { path, query: Object.fromEntries(new URLSearchParams(qs || "")) };
}

// ---------- Navigation ----------
const stack = [];          // the paths we've visited, to know when "back" happens
let nextDir = null;        // the direction for the NEXT hash change
let current = null;        // {el, path}
let rendering = Promise.resolve();

export function go(path, dir = "forward", { replace = false } = {}) {
  nextDir = dir;
  if (replace) { location.replace("#" + path); }
  else if (location.hash === "#" + path) { show(dir); }
  else location.hash = path;
}
// back(fallback): go to the previous screen if we came from one, otherwise to fallback.
export function back(fallback = "/items") {
  if (stack.length > 1) { nextDir = "back"; history.back(); }
  else go(fallback, "back", { replace: true });
}

window.addEventListener("hashchange", () => {
  let dir = nextDir;
  nextDir = null;
  const { path } = parseHash();
  if (!dir) dir = stack.length > 1 && stack[stack.length - 2] === path ? "back" : "forward";   // browser back button
  show(dir);
});

// ---------- Header + tab bar ----------
function buildHeader(spec, ctx) {
  if (!spec) return null;
  const bar = h("header", { class: "topbar" });
  if (spec.back) bar.appendChild(iconButton("back", () => (typeof spec.back === "function" ? spec.back() : back(spec.back === true ? "/items" : spec.back)), "Back"));
  if (spec.wordmark) bar.appendChild(wordmark("", "header-wordmark"));
  const sub = h("span", { class: "s f-pixel" }, spec.sub || "");
  const t = h("span", { class: "t" }, spec.title || "");
  if (spec.title) bar.appendChild(px("div", "titlebar", [t, sub]));
  if (spec.custom) bar.appendChild(spec.custom);
  else bar.appendChild(h("span", { class: "spacer" }));
  if (spec.gear !== false) bar.appendChild(iconButton("gear", () => go("/settings"), "Settings"));
  ctx.ui.setSub = (text) => { sub.textContent = text; };
  ctx.ui.setTitle = (text) => { t.textContent = text; };
  return bar;
}

export function wordmark(cls = "", extra = "") {
  return h("span", { class: `wordmark ${cls} ${extra}`, "aria-label": "RoomFund" },
    h("span", { class: "room" }, "Room"), h("span", { class: "fund" }, "Fund"));
}

const TABS = [
  ["items", "Items", "list", "/items"],
  ["timeline", "Timeline", "calendar", "/timeline"],
  ["room", "My room", "floor", "/room"],
  ["savings", "Savings", "coins", "/savings"],
  ["progress", "Progress", "trophy", "/progress"],
];
// tabBar(active, showRoom, preview): the floating pixel tab bar (4 tabs, or 5 with My Room).
export function tabBar(active, showRoom, preview = false) {
  const tabs = TABS.filter(([k]) => k !== "room" || showRoom);
  const bar = px("nav", `tabbar ${preview ? "preview" : ""}`, tabs.map(([key, label, ic, path]) => {
    const on = key === active;
    const tab = h("button", {
      class: `tab press pxw ${on ? "active" : ""}`, type: "button", "aria-current": on ? "page" : null,
      onclick: preview ? null : () => { if (!on) go(path, "none"); },     // tab switches are instant
    }, h("span", { class: "px" }, h("span", { class: "tab-inner" }, tabIcon(ic), label)));
    return tab;
  }), { "aria-label": "Main" });
  bar.dataset.accent = ({ items: "items", timeline: "timeline", room: "room", savings: "savings", progress: "progress" })[active] || "items";
  return bar;
}
let tabbarEl = null;
let lastTab = null;
function updateTabbar(tab) {
  tabbarEl?.remove();
  tabbarEl = null;
  if (!tab) { lastTab = null; return; }
  tabbarEl = tabBar(tab, !!store.settings?.show_room_tab);
  document.body.appendChild(tabbarEl);
  if (tab !== lastTab && !reduceMotion()) {
    // the new tab's pill pops in with a bounce, and its icon plays its little animation
    const active = tabbarEl.querySelector(".tab.active");
    active?.animate([{ transform: "scale(.8)" }, { transform: "scale(1.1)", offset: .55 }, { transform: "scale(.97)", offset: .8 }, { transform: "none" }],
      { duration: 420, easing: "ease-out" });
    animateTabIcon(active?.querySelector(".tab-ic"));
  }
  lastTab = tab;
}
// Settings calls this when "Show My Room tab" flips, so the real bar updates straight away.
export function refreshTabbar() { if (tabbarEl) updateTabbar(current?.tab); }

// ---------- Showing a screen ----------
async function show(dir) {
  rendering = rendering.then(() => render(dir)).catch((e) => console.error(e));
  return rendering;
}

async function render(dir) {
  const { path, query } = parseHash();
  const m = match(path);
  if (!m) { go(auth.token ? "/items" : "/login", "none", { replace: true }); return; }
  if (!m.opts.public && !auth.token) { go("/login", "none", { replace: true }); return; }
  if (m.opts.public && auth.token && path !== "/reset" && path !== "/password-changed") { go("/items", "none", { replace: true }); return; }

  // Keep our own history stack in step with the browser's.
  if (dir === "back") { stack.pop(); if (stack[stack.length - 1] !== path) stack.push(path); }
  else if (stack[stack.length - 1] !== path) stack.push(path);
  if (stack.length > 30) stack.shift();

  if (!m.opts.public) { try { await store.loadSettings(); } catch {} }

  const ctx = { params: m.params, query, go, back, ui: {} };
  const spec = await m.fn(ctx);
  const screen = h("main", { class: `screen ${spec.header ? "with-header" : ""} ${spec.tab ? "" : "no-tabs"}` });
  if (spec.accent) screen.dataset.accent = spec.accent;
  const header = buildHeader(spec.header, ctx);
  if (header) screen.appendChild(header);
  screen.appendChild(spec.el);
  await transition(screen, dir, spec);
  current = { el: screen, path, tab: spec.tab, spec };
  spec.onShow?.();
}

async function transition(screen, dir, spec) {
  const old = current?.el;
  const instant = !old || dir === "none" || reduceMotion();
  if (instant) {
    old?.remove();
    appEl.appendChild(screen);
    window.scrollTo(0, 0);
    updateTabbar(spec.tab);
    return;
  }
  // Freeze the old screen where it is, then slide both (280ms ease-out).
  const y = window.scrollY;
  const rect = appEl.getBoundingClientRect();
  Object.assign(old.style, { position: "fixed", top: `${-y}px`, left: `${rect.left}px`, width: `${rect.width}px`, zIndex: 1, pointerEvents: "none" });
  appEl.appendChild(screen);
  window.scrollTo(0, 0);
  const forward = dir !== "back";
  const opts = { duration: 280, easing: "ease-out", fill: "both" };
  const a1 = screen.animate([{ transform: `translateX(${forward ? "100%" : "-100%"})` }, { transform: "translateX(0)" }], opts);
  const a2 = old.animate([{ transform: "translateX(0)" }, { transform: `translateX(${forward ? "-100%" : "100%"})` }], opts);
  const tabChanges = !!spec.tab !== !!current?.tab;
  if (tabChanges) updateTabbar(spec.tab); else updateTabbar(spec.tab);
  await Promise.all([a1.finished, a2.finished]).catch(() => {});
  a1.cancel();        // remove the transform so position:fixed headers work normally again
  old.remove();
}

// ---------- Cards pop in (the game-like feel) ----------
// Whenever a screen fills with its real content, its main blocks spring in one after
// another: rise, overshoot a little, settle. Skeletons, pop-ups and Search don't do it.
const POP = ".card, .item-card, .saving-row, .price-row, .badge, .stat, .check-row, .balance, .money-card, .pbar, .filter-chips, .verdict-badge";
let popQueue = [], popScheduled = false;
new MutationObserver((records) => {
  if (reduceMotion() || location.hash.startsWith("#/search")) return;
  for (const r of records) for (const n of r.addedNodes) {
    if (n.nodeType !== 1) continue;
    const found = n.matches(POP) ? [n] : [...n.querySelectorAll(POP)];
    for (const el of found) if (!el.parentElement?.closest(POP) && !el.closest(".loading-delay")) popQueue.push(el);
  }
  if (popQueue.length && !popScheduled) {
    popScheduled = true;
    requestAnimationFrame(() => {
      popQueue.filter((el) => el.isConnected).slice(0, 14).forEach((el, i) => el.animate([
        { transform: "translateY(14px) scale(.96)", opacity: 0 },
        { transform: "translateY(-3px) scale(1.01)", opacity: 1, offset: .7 },
        { transform: "none", opacity: 1 },
      ], { duration: 380, delay: Math.min(i * 45, 450), easing: "ease-out", fill: "backwards" }));
      popQueue = []; popScheduled = false;
    });
  }
}).observe(appEl, { childList: true, subtree: true });

// ---------- Logged out (token expired) ----------
setLoggedOutHandler((expired) => {
  store.clear();
  updateTabbar(null);
  go(`/login${expired ? "?expired=1" : ""}`, "none", { replace: true });
});

// ---------- After logging in (and on start when already logged in) ----------
// Ask about a due payday (Section 7F), unless "Remind me tomorrow" was chosen today.
// signedIn: true right after logging in / signing up → also advise installing the app.
export async function afterLogin({ signedIn = false } = {}) {
  try {
    const pending = await api("GET", "/payday/pending");
    if (pending && prefs.get("rf_payday_snooze") !== iso(today())) {
      const result = await paydayCheckin(pending);
      if (result?.new_badges?.length) showBadges(result.new_badges);
    }
  } catch {}
  if (signedIn) await adviseInstall();       // "Install RoomFund" (not a shortcut) after every sign-in
}

// The service worker makes RoomFund installable (and opens the last-seen screens offline).
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
}

// ---------- Start ----------
applyTheme();
applyReduceMotion();

(async function start() {
  const { path } = parseHash();
  const firstPublic = !auth.token || ["/reset", "/password-changed"].includes(path);
  if (!location.hash || location.hash === "#/" || location.hash === "#") {
    history.replaceState(null, "", auth.token ? "#/items" : "#/login");
  }
  // Splash plays once when the site loads (Section 5), unless Reduce motion is on.
  // When you're already logged in, the splash ends with the "Hi {name} 👋" welcome.
  if (!reduceMotion() && !["/reset", "/password-changed"].includes(parseHash().path)) {
    const greet = auth.token && !firstPublic ? store.loadMe().then((me) => me.name) : null;
    await A.playSplash(() => show("none"), { greet });
  } else {
    await show("none");
  }
  if (auth.token && !firstPublic) afterLogin();
})();
