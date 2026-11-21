// ---------------------------------------------------------
// lib.js: the shared toolbox every screen uses.
//   h() / px()        build elements (px = pixel-corner box)
//   naira() / dates   formatting
//   api()             talk to the FastAPI backend (adds the login token)
//   modal() / sheet() / toast() / banner()
//   haptic(), reduceMotion(), prefs
// ---------------------------------------------------------
import { icon } from "./icons.js";

// The browser's replaceChildren / append / prepend print the word "null" for an empty slot.
// Our screens often pass "maybe nothing" (e.g. `hasPhoto ? x : null`), so skip those everywhere.
for (const name of ["replaceChildren", "append", "prepend"]) {
  for (const proto of [Element.prototype, DocumentFragment.prototype]) {
    const original = proto[name];
    proto[name] = function (...nodes) {
      return original.apply(this, nodes.flat(Infinity).filter((n) => n !== null && n !== undefined && n !== false));
    };
  }
}

// Safety net for animations: some browsers pause animations (background tabs, some
// headless browsers), so `animation.finished` might never come and a screen could get
// stuck. Every animation's `finished` now ALSO resolves on a timer (its length + a bit).
const originalAnimate = Element.prototype.animate;
Element.prototype.animate = function (keyframes, options) {
  const a = originalAnimate.call(this, keyframes, options);
  const ms = (typeof options === "number" ? options : (options?.duration || 0) + (options?.delay || 0)) + 120;
  const real = a.finished;
  const safe = Promise.race([real, new Promise((resolve) => setTimeout(() => resolve(a), ms))]);
  real.catch(() => {});
  Object.defineProperty(a, "finished", { get: () => safe });
  return a;
};

// ---------- Building elements ----------

// h("div", {class: "x", onclick: fn}, child, child...) → a real DOM element.
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else if (k === "dataset") Object.assign(el.dataset, v);
    else if (k === "html") el.innerHTML = v;
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, "");
    else el.setAttribute(k, v);
  }
  append(el, children);
  return el;
}
export function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

// px(tag, classes, children, attrs): a pixel-corner box.
// The OUTER element carries the hard shadow + press; the inner .px is clipped.
export function px(tag, cls, children = [], attrs = {}) {
  const inner = h(tag === "button" || tag === "a" ? "span" : "div", { class: "px" }, children);
  return h(tag, { ...attrs, class: `pxw ${cls || ""}` }, inner);
}

// A button with the shared press effect. kind: primary / secondary / danger / money
export function button(label, onclick, kind = "secondary", extra = {}) {
  const cls = `btn press ${kind === "secondary" ? "" : kind} ${extra.class || ""}`;
  const b = px("button", cls, [label], { type: extra.type || "button", onclick, ...(extra.attrs || {}) });
  return b;
}
export function iconButton(name, onclick, label, cls = "") {
  return px("button", `icon-btn press ${cls}`, [icon(name)], { type: "button", onclick, "aria-label": label, title: label });
}

// Keep the pressed look until the next screen starts moving (Section 5).
document.addEventListener("click", (e) => {
  const el = e.target.closest(".press");
  if (!el) return;
  el.classList.add("pressed");
  setTimeout(() => el.classList.remove("pressed"), 160);
}, true);

// ---------- Formatting ----------

export const naira = (n) => "₦" + Math.round(Number(n) || 0).toLocaleString("en-NG");
export const nairaK = (n) => n >= 1_000_000 ? `₦${(n / 1_000_000).toFixed(n % 1_000_000 ? 1 : 0)}m`
                        : n >= 1000 ? `₦${Math.round(n / 1000)}k` : naira(n);
// A ₦ amount inside Pixelify text must be Inter (Section 7G): wrap it in span.money.
export const money = (n, cls = "") => h("span", { class: `money ${cls}` }, naira(n));

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export function parseDate(s) {                 // "2026-11-21" → a local Date (no timezone surprises)
  if (s instanceof Date) return s;
  const [y, m, d] = String(s).slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d);
}
export function iso(d) {
  d = parseDate(d);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export const today = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
export const addDays = (d, n) => { d = new Date(parseDate(d)); d.setDate(d.getDate() + n); return d; };
export function addMonths(d, n) {
  d = parseDate(d);
  const t = new Date(d.getFullYear(), d.getMonth() + n, 1);
  const last = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate();
  t.setDate(Math.min(d.getDate(), last));
  return t;
}
export const fmtDay = (d) => { d = parseDate(d); return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`; };   // Sat 14 Nov
export const fmtShort = (d) => { d = parseDate(d); return `${d.getDate()} ${MONTHS[d.getMonth()]}`; };                      // 14 Nov
export const fmtMonthYear = (d) => { d = parseDate(d); return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`; };              // Jan 2027
export const fmtMonthLong = (d) => { d = parseDate(d); return `${MONTHS_LONG[d.getMonth()]} ${d.getFullYear()}`; };        // January 2027
export const ordinal = (n) => n + (["th", "st", "nd", "rd"][(n % 100 - 20) % 10] || ["th", "st", "nd", "rd"][n % 100] || "th");
export const weekStart = (d) => { d = new Date(parseDate(d)); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d; };

// ---------- Preferences saved on this device ----------
export const prefs = {
  get(key, fallback = null) { try { const v = localStorage.getItem(key); return v === null ? fallback : v; } catch { return fallback; } },
  set(key, value) { try { value === null ? localStorage.removeItem(key) : localStorage.setItem(key, value); } catch {} },
};

// Reduce motion (Section 23). Changed on request: animations are ON by default, even when
// the device says "reduce motion" (Windows' "Animation effects: off" switched every animation
// off). Only the in-app toggle (Settings → Feel) turns them off.
export function reduceMotion() { return document.documentElement.classList.contains("reduce-motion"); }
export function applyReduceMotion() {
  document.documentElement.classList.toggle("reduce-motion", prefs.get("rf_reduce_motion") === "1");
}
export function applyTheme() {
  const t = prefs.get("rf_theme", "system");
  if (t === "light" || t === "dark") document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
}

// Haptics (Section 23): one helper, only these patterns.
const PATTERNS = { tap: [10], tick: [8], success: [20, 40, 20], thud: [35], celebrate: [15, 30, 15, 30, 40], warning: [25, 60, 25], error: [40, 50, 40] };
export const canVibrate = () => "vibrate" in navigator;
export function hapticsOn() { return canVibrate() && prefs.get("rf_haptics", "1") === "1"; }
export function haptic(kind) { if (hapticsOn()) try { navigator.vibrate(PATTERNS[kind] || 10); } catch {} }
export const isIPhone = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

// ---------- Talking to the backend ----------

export const auth = {
  get token() { return prefs.get("rf_token"); },
  set token(t) { prefs.set("rf_token", t); },
};
let onLoggedOut = () => {};
export function setLoggedOutHandler(fn) { onLoggedOut = fn; }

export class ApiError extends Error {
  constructor(status, detail, offline = false) { super(detail || "Something went wrong"); this.status = status; this.detail = detail; this.offline = offline; }
}

// api("GET", "/items") · api("POST", "/items", {...}) · api("POST", "/login", form, {form: true})
export async function api(method, path, body = null, opts = {}) {
  const headers = {};
  if (auth.token && !opts.noAuth) headers.Authorization = `Bearer ${auth.token}`;
  let payload = undefined;
  if (opts.form) { payload = new URLSearchParams(body); }
  else if (body instanceof FormData) { payload = body; }
  else if (body !== null) { headers["Content-Type"] = "application/json"; payload = JSON.stringify(body); }
  let res;
  try {
    res = await fetch(path, { method, headers, body: payload });
  } catch (e) {
    throw new ApiError(0, "offline", true);          // no internet / server down
  }
  if (res.status === 204) return null;
  let data = null;
  try { data = await res.json(); } catch {}
  if (res.status === 401 && !opts.noAuth && path !== "/login") {
    auth.token = null;
    onLoggedOut(true);                                 // login expired → back to Log in (yellow banner)
  }
  if (!res.ok) {
    let detail = data?.detail;
    if (Array.isArray(detail)) detail = detail.map((d) => d.msg).join(" ");   // 422 from Pydantic
    throw new ApiError(res.status, detail || "Something went wrong");
  }
  return data;
}

// ---------- A tiny shared store (things many screens read) ----------
export const store = {
  me: null, settings: null, items: null, schedule: null,
  async loadMe(force = false) { if (!this.me || force) this.me = await api("GET", "/me"); return this.me; },
  async loadSettings(force = false) {
    if (!this.settings || force) {
      this.settings = await api("GET", "/settings");
      document.getElementById("app").className = `density-${this.settings.list_density || "moderate"}`;
    }
    return this.settings;
  },
  async loadItems(force = true) { if (!this.items || force) this.items = await api("GET", "/items"); return this.items; },
  async loadSchedule(force = false) { if (!this.schedule || force) this.schedule = await api("GET", "/payday/schedule"); return this.schedule; },
  clear() { this.me = this.settings = this.items = this.schedule = null; },
};

// ---------- Pop-ups, sheets, toasts, banners ----------

function animateIn(overlay, card, fromY) {
  if (reduceMotion()) { overlay.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 120 }); return; }
  overlay.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, easing: "ease-out" });
  // springs into place: rises, overshoots a touch, settles (like a game menu opening)
  card.animate([
    { transform: `translateY(${fromY}) scale(.92)`, opacity: 0 },
    { transform: "translateY(-4px) scale(1.02)", opacity: 1, offset: .7 },
    { transform: "none", opacity: 1 },
  ], { duration: 320, easing: "ease-out" });
}

// countUp(el, to): numbers roll up like a game score (₦0 → ₦100,000, 0% → 58%).
export function countUp(el, to, format = naira, ms = 650) {
  if (!el) return;
  if (reduceMotion() || !to) { el.textContent = format(to); return; }
  const start = performance.now();
  const tick = (now) => {
    const t = Math.max(0, Math.min(1, (now - start) / ms));   // frame times can be a hair earlier than start: never below 0
    const eased = 1 - Math.pow(1 - t, 3);                  // fast at first, then slows down
    el.textContent = format(Math.round(to * eased));
    if (t < 1) requestAnimationFrame(tick);
  };
  el.textContent = format(0);
  requestAnimationFrame(tick);
  setTimeout(() => { el.textContent = format(to); }, ms + 200);   // always ends on the exact number
}
async function animateOut(overlay, card, toY) {
  const d = reduceMotion() ? 100 : 220;
  overlay.animate([{ opacity: 1 }, { opacity: 0 }], { duration: d, easing: "ease-in", fill: "forwards" });
  await card.animate([{ transform: "none", opacity: 1 }, { transform: `translateY(${toY})`, opacity: 0 }], { duration: d, easing: "ease-in", fill: "forwards" }).finished.catch(() => {});
  overlay.remove();
}

// modal(build): build(close) returns the children of the pop-up card.
export function modal(build, { accent = null, dismissable = true } = {}) {
  let closed = false;
  const overlay = h("div", { class: "overlay", role: "dialog", "aria-modal": "true" });
  if (accent) overlay.dataset.accent = accent;
  else { const a = document.querySelector(".screen[data-accent]")?.dataset.accent; if (a) overlay.dataset.accent = a; }
  const close = async (result) => { if (closed) return; closed = true; await animateOut(overlay, card, "16px"); resolve(result); };
  let resolve;
  const done = new Promise((r) => (resolve = r));
  const card = px("div", "modal lg", build(close));
  overlay.appendChild(card);
  if (dismissable) overlay.addEventListener("click", (e) => { if (e.target === overlay) close(null); });
  document.body.appendChild(overlay);
  animateIn(overlay, card, "16px");
  setTimeout(() => card.querySelector("input,textarea")?.focus(), 230);
  return { close, done, el: card };
}

// sheet(build): a bottom sheet that always reaches the bottom edge (Section 24).
export function sheet(build, { accent = null } = {}) {
  let closed = false, resolve;
  const done = new Promise((r) => (resolve = r));
  const overlay = h("div", { class: "overlay sheet-overlay", role: "dialog", "aria-modal": "true" });
  const a = accent || document.querySelector(".screen[data-accent]")?.dataset.accent;
  if (a) overlay.dataset.accent = a;
  const close = async (result) => { if (closed) return; closed = true; await animateOut(overlay, card, "40px"); resolve(result); };
  const card = px("div", "sheet", build(close));
  overlay.appendChild(card);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(null); });
  document.body.appendChild(overlay);
  if (reduceMotion()) animateIn(overlay, card, "16px");
  else {     // the sheet springs up from the bottom edge
    overlay.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, easing: "ease-out" });
    card.animate([{ transform: "translateY(100%)" }, { transform: "translateY(-6px)", offset: .72 }, { transform: "none" }], { duration: 360, easing: "ease-out" });
  }
  return { close, done, el: card };
}

// confirm({...}) → Promise<true/false>. Danger confirms buzz "warning" (Section 23).
export function confirmBox({ icon: ic = null, iconColor = "var(--danger)", title, text, yes, no = "Keep it", danger = true, yesHaptic = "warning" }) {
  const m = modal((close) => [
    ic ? h("div", { class: "icon-top", style: { color: iconColor } }, icon(ic, "xl")) : null,
    h("h2", {}, title),
    h("p", { class: "lead" }, text),
    button(yes, () => { haptic(yesHaptic); close(true); }, danger ? "danger" : "primary"),
    button(no, () => close(false)),
  ]);
  return m.done.then((r) => r === true);
}

export function toast(text, ms = 2500) {
  document.querySelectorAll(".toast").forEach((t) => t.remove());
  const t = px("div", "toast", [text], { role: "status" });
  document.body.appendChild(t);
  const rm = reduceMotion();
  t.animate(rm ? [{ opacity: 0 }, { opacity: 1 }]
    : [{ opacity: 0, transform: "translate(-50%, 16px) scale(.8)" }, { opacity: 1, transform: "translate(-50%, -4px) scale(1.06)", offset: .65 }, { opacity: 1, transform: "translate(-50%, 0) scale(1)" }],
    { duration: rm ? 100 : 360, easing: "ease-out" });
  setTimeout(() => t.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, fill: "forwards" }).finished.then(() => t.remove()), ms);
}

// banner("error" | "info", text): the compact pill for form-level messages.
export function banner(kind, text) {
  return h("div", { class: "banner-wrap" },
    px("div", `banner ${kind}`, [icon(kind === "error" ? "alert" : "alert", "sm"), h("span", {}, text)], { role: kind === "error" ? "alert" : "status" }));
}

// ---------- Form fields ----------
// field({label, type, value, placeholder, hint, prefix, eye, labelRight, inputAttrs}) → {el, input, error(msg)}
export function field(o) {
  const input = h(o.type === "textarea" ? "textarea" : "input", {
    type: o.type === "textarea" ? null : (o.type || "text"), value: o.type === "textarea" ? null : (o.value ?? ""),
    placeholder: o.placeholder || "", id: o.id, autocomplete: o.autocomplete || "off",
    inputmode: o.inputmode, ...(o.inputAttrs || {}),
  });
  if (o.type === "textarea" && o.value) input.value = o.value;
  const err = h("div", { class: "err-msg hidden", role: "alert" });
  const hint = o.hint ? h("div", { class: "hint" }, o.hint) : null;
  let eyeBtn = null;
  if (o.eye) {
    eyeBtn = h("button", { type: "button", class: "eye press", "aria-label": "Show password" }, icon("eye"));
    eyeBtn.addEventListener("click", () => {
      const show = input.type === "password";
      input.type = show ? "text" : "password";
      eyeBtn.replaceChildren(icon(show ? "eyeoff" : "eye"));
      eyeBtn.setAttribute("aria-label", show ? "Hide password" : "Show password");
    });
  }
  const box = px("div", "input", [o.prefix ? h("span", { class: "prefix money" }, o.prefix) : null, input, eyeBtn]);
  const el = h("label", { class: "field" },
    h("div", { class: "field-label" }, h("span", {}, o.label), o.labelRight || null),
    box, err, hint);
  input.addEventListener("input", () => { el.classList.remove("error"); err.classList.add("hidden"); });
  return {
    el, input,
    error(msg) { el.classList.add("error"); err.textContent = msg; err.classList.remove("hidden"); },
    clear() { el.classList.remove("error"); err.classList.add("hidden"); },
  };
}

// Money input helper: keep only digits and show commas while typing.
export function moneyInput(f) {
  f.input.setAttribute("inputmode", "numeric");
  f.input.addEventListener("input", () => {
    const digits = f.input.value.replace(/\D/g, "");
    f.input.value = digits ? Number(digits).toLocaleString("en-NG") : "";
  });
  if (f.input.value) f.input.dispatchEvent(new Event("input"));
  return () => Number(f.input.value.replace(/\D/g, "") || 0);
}

// Choose chips (priority, status, sources...). Returns {el, get(), set()}.
export function chipChoice(options, value, { onChange, cls = (v) => "", haptics = false } = {}) {
  let current = value;
  const wrap = h("div", { class: "chips", role: "radiogroup" });
  const draw = (popped = false) => {
    wrap.replaceChildren(...options.map(([v, label]) => {
      const on = v === current;
      return px("button", `chip press ${on ? "on" : ""} ${cls(v, on)}`, [label],
        { type: "button", role: "radio", "aria-checked": String(on), onclick: () => { current = v; if (haptics) haptic("tick"); draw(true); onChange?.(v); } });
    }));
    if (popped) popChip(wrap.querySelector(".chip.on"));
  };
  draw();
  return { el: wrap, get: () => current, set: (v) => { current = v; draw(); } };
}

// A picked chip pops: squash, overshoot, settle.
export function popChip(el) {
  if (!el || reduceMotion()) return;
  el.animate([{ transform: "scale(.82)" }, { transform: "scale(1.14)", offset: .55 }, { transform: "scale(.97)", offset: .8 }, { transform: "none" }],
    { duration: 340, easing: "ease-out" });
}

export function statusChip(status) {
  return px("span", `chip flat status ${status}`, [h("span", { class: "dot" }), status]);
}
export function priorityChip(p) {
  return px("span", `chip flat prio ${p === "high" ? "priority-high" : ""}`, [p]);
}

// The big icon on empty / error cards: the icon on a stepped pixel box in the screen's accent.
export function bigIcon(name) {
  return h("div", { class: "big-icon" }, px("div", "ic-box big", [icon(name, "lg")]));
}

// A "first load failed" card (Section 20): offline or something went wrong.
export function errorCard(err, retry) {
  const offline = err?.offline;
  return px("div", "card state-card", [
    bigIcon(offline ? "wifi" : "alert"),
    h("h3", { class: "f-head" }, offline ? "You’re offline" : "Something went wrong"),
    h("p", {}, offline ? "RoomFund needs internet to load your list. Check your data or Wi-Fi, then try again."
                       : "That’s on us, not you. Try again in a moment."),
    button("Try again", retry, "primary"),
  ]);
}

// Show a skeleton only if loading takes longer than ~300ms (Section 20).
export function skeleton(lines = 3, cards = 3) {
  const wrap = h("div", { class: "loading-delay", "aria-busy": "true" });
  for (let c = 0; c < cards; c++) {
    wrap.appendChild(px("div", "skel-card flat", Array.from({ length: lines }, (_, i) =>
      h("div", { class: "skel", style: { height: i === 0 ? "18px" : "12px", width: `${[60, 40, 80, 50][i % 4]}%` } }))));
  }
  return wrap;
}
