// ---------------------------------------------------------
// auth.js: Splash, Log in, Sign up, Continue with Google,
// Forgot password (+ email sent, set new password, link
// expired, password changed), and the logged-in greeting.
// Design PDF Sections 2, 4, 5, 7A, 20.
// ---------------------------------------------------------
import { h, px, bigIcon, button, field, banner, api, auth, store, haptic, reduceMotion, ApiError } from "../lib.js";
import { icon, logoMark } from "../icons.js";
import { go, back, wordmark, afterLogin } from "../app.js";
import { shake } from "../fx.js";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- Splash (plays once when the site loads, ~3.5s) ----------
// greet: when you're already logged in, a promise for your name. Then the splash flows into
// "Hi {name} 👋" and glides into Items, the same welcome as after logging in.
export async function playSplash(renderNext, { greet = null } = {}) {
  const mark = logoMark("mark");
  const word = wordmark("", "splash-word");
  const tag = h("div", { class: "tag" }, "The room planner that knows prices go up.");
  const lockup = h("div", { class: "lockup" }, mark, word);
  const group = h("div", { class: "group" }, lockup, tag);
  const splash = h("div", { class: "splash", "aria-hidden": "true" }, group);
  document.body.appendChild(splash);
  word.style.opacity = "0"; tag.style.opacity = "0"; mark.style.opacity = "0";
  const easeOutBack = "cubic-bezier(.34,1.56,.64,1)";

  // 1. Mark scales 0.25 → 0.9 at the centre and fades in (wait 0.2s, 0.5s).
  word.style.display = "none";
  await mark.animate([{ transform: "scale(.25)", opacity: 0 }, { transform: "scale(.9)", opacity: 1 }],
    { duration: 500, delay: 200, easing: easeOutBack, fill: "forwards" }).finished;
  // 2. Mark slides left + scales to 0.72; wordmark slides in from +24px (wait 0.3s, 0.5s).
  word.style.display = "";
  await wait(300);
  mark.animate([{ transform: `translateX(${word.offsetWidth / 2 + 5}px) scale(.9)` }, { transform: "translateX(0) scale(.72)" }],
    { duration: 500, easing: "ease-in-out", fill: "forwards" });
  await word.animate([{ transform: "translateX(24px)", opacity: 0 }, { transform: "none", opacity: 1 }],
    { duration: 500, easing: "ease-in-out", fill: "forwards" }).finished;
  // 3. Tagline fades in, moving up 8px (wait 0.1s, 0.4s).
  await tag.animate([{ transform: "translateY(8px)", opacity: 0 }, { transform: "none", opacity: 1 }],
    { duration: 400, delay: 100, easing: "ease-out", fill: "forwards" }).finished;
  // 4. Hold, then the mark and tagline fade out (mark shrinks a little) (wait 0.9s, 0.4s).
  await wait(900);
  mark.animate([{ transform: "scale(.72)", opacity: 1 }, { transform: "scale(.6)", opacity: 0 }], { duration: 400, easing: "ease-in", fill: "forwards" });
  await tag.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 400, easing: "ease-in", fill: "forwards" }).finished;

  // The wordmark leaves the flex layout and becomes a fixed, top-left-anchored layer,
  // so every glide below is one smooth transform (no jumps).
  const start = word.getBoundingClientRect();
  word.getAnimations().forEach((a) => a.cancel());
  Object.assign(word.style, { position: "fixed", left: `${start.left}px`, top: `${start.top}px`, margin: "0", opacity: "1", transformOrigin: "top left", zIndex: "101" });
  document.body.appendChild(word);
  let at = "none";                                   // where the wordmark currently is (a transform)
  const glide = (transform, ms = 700) => { const a = word.animate([{ transform: at }, { transform }], { duration: ms, easing: "ease-in-out", fill: "forwards" }); at = transform; return a.finished; };

  if (greet) {
    // Logged in already: wordmark glides to the centre and grows, "Hi {name} 👋" fades in, hold.
    const name = await Promise.race([greet.catch(() => null), wait(1500).then(() => null)]);
    const sc = 48.6 / 40;
    const cx = window.innerWidth / 2 - (start.width * sc) / 2, cy = window.innerHeight / 2 - (start.height * sc) / 2 - 24;
    await glide(`translate(${cx - start.left}px, ${cy - start.top}px) scale(${sc})`, 600);
    const hi = h("div", { class: "hi", style: { position: "fixed", left: "0", right: "0", top: `${cy + start.height * sc + 16}px`, opacity: "0" } },
      `Hi ${name || "there"} `, h("span", { class: "wave" }, "👋"));
    splash.appendChild(hi);
    await hi.animate([{ opacity: 0, transform: "translateY(8px)" }, { opacity: 1, transform: "none" }], { duration: 400, delay: 150, easing: "ease-out", fill: "forwards" }).finished;
    await wait(800);
    hi.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300, fill: "forwards" });
  }

  // 5. Only the wordmark glides to its place (top of Log in, or the top-left of Items),
  //    and the screen fades in around it (wait 0.1s, 0.7s).
  await renderNext();
  await wait(100);
  const target = document.querySelector(".auth .logo .wordmark") || document.querySelector(".header-wordmark");
  const screen = document.querySelector(".screen");
  if (target) {
    const to = target.getBoundingClientRect();
    target.style.visibility = "hidden";
    if (target.closest(".auth")) word.classList.add("pink");   // "Fund" turns pink on Log in
    glide(`translate(${to.left - start.left}px, ${to.top - start.top}px) scale(${to.height / start.height})`);
  }
  splash.animate([{ backgroundColor: getComputedStyle(splash).backgroundColor }, { backgroundColor: "rgba(0,0,0,0)" }],
    { duration: 700, easing: "ease-in-out", fill: "forwards" });
  screen?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 700, easing: "ease-in-out" });
  await wait(720);
  if (target) target.style.visibility = "";
  word.remove();
  splash.remove();
}

// ---------- Logged-in greeting (7A) ----------
// The form fades out; only the wordmark stays and glides to the centre (48.6px, Fund stays pink),
// "Hi {name} 👋" fades in, hold, then the wordmark glides to the top-left of Items (22px, Fund green).
async function greetAndEnter(name) {
  if (reduceMotion()) { await go("/items", "none"); afterLogin(); return; }
  const fromEl = document.querySelector(".auth .logo .wordmark");
  const from = fromEl?.getBoundingClientRect();
  const overlay = h("div", { class: "greeting" });
  overlay.style.background = "transparent";
  const word = wordmark("pink");
  word.style.cssText = `position:fixed; left:${from?.left ?? 0}px; top:${from?.top ?? 0}px; font-size:40px; transform-origin: top left; margin:0`;
  const hi = h("div", { class: "hi" }, `Hi ${name} `, h("span", { class: "wave" }, "👋"));
  hi.style.opacity = "0";
  overlay.append(word, hi);
  document.body.appendChild(overlay);
  fromEl && (fromEl.style.visibility = "hidden");

  // Form fades out (the overlay's page colour fades in), wordmark glides to the centre.
  overlay.animate([{ background: "transparent" }, { background: getComputedStyle(document.body).backgroundColor }], { duration: 400, fill: "forwards" });
  const w0 = word.getBoundingClientRect();
  const scaleUp = 48.6 / 40;
  const cx = window.innerWidth / 2 - (w0.width * scaleUp) / 2, cy = window.innerHeight / 2 - (w0.height * scaleUp) / 2 - 20;
  await word.animate([{ transform: "none" }, { transform: `translate(${cx - w0.left}px, ${cy - w0.top}px) scale(${scaleUp})` }],
    { duration: 700, easing: "ease-in-out", fill: "forwards" }).finished;
  hi.style.position = "fixed";
  hi.style.top = `${cy + w0.height * scaleUp + 16}px`; hi.style.left = "0"; hi.style.right = "0";
  await hi.animate([{ opacity: 0, transform: "translateY(8px)" }, { opacity: 1, transform: "none" }], { duration: 400, delay: 150, easing: "ease-out", fill: "forwards" }).finished;
  await wait(800);

  // Items appears underneath; the wordmark glides to its top-left spot and "Fund" turns green.
  await go("/items", "none");
  await wait(50);
  const target = document.querySelector(".header-wordmark");
  hi.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300, fill: "forwards" });
  overlay.animate([{ background: getComputedStyle(document.body).backgroundColor }, { background: "transparent" }], { duration: 700, easing: "ease-in-out", fill: "forwards" });
  if (target) {
    target.style.visibility = "hidden";
    const to = target.getBoundingClientRect();
    word.classList.remove("pink");
    await word.animate([{ transform: `translate(${cx - w0.left}px, ${cy - w0.top}px) scale(${scaleUp})` },
                        { transform: `translate(${to.left - w0.left}px, ${to.top - w0.top}px) scale(${to.height / w0.height})` }],
      { duration: 700, easing: "ease-in-out", fill: "forwards" }).finished;
    target.style.visibility = "";
  } else await wait(700);
  overlay.remove();
  afterLogin();
}

async function finishLogin(token) {
  auth.token = token;
  store.clear();
  let name = "";
  try { name = (await store.loadMe(true)).name; await store.loadSettings(true); } catch {}
  await greetAndEnter(name || "there");
}

// ---------- Continue with Google (Section 2B) ----------
let gisLoaded = null;
function loadGIS() {
  gisLoaded ??= new Promise((resolve, reject) => {
    const s = h("script", { src: "https://accounts.google.com/gsi/client", async: true });
    s.onload = resolve; s.onerror = reject;
    document.head.appendChild(s);
  });
  return gisLoaded;
}
function googleArea(showError) {
  const slot = h("div", { class: "g-slot" });
  const fallback = button(h("span", { style: { display: "flex", alignItems: "center", gap: "10px" } }, h("span", { class: "g-mark" }), "Continue with Google"),
    () => { haptic("error"); showError("Google sign-in didn't work. Please try again."); });
  slot.appendChild(fallback);
  api("GET", "/auth/config", null, { noAuth: true }).then(async (cfg) => {
    if (!cfg?.google_client_id) return;          // not set up: keep the placeholder button
    try {
      await loadGIS();
      window.google.accounts.id.initialize({
        client_id: cfg.google_client_id,
        callback: async (resp) => {
          try {
            const t = await api("POST", "/auth/google", { id_token: resp.credential }, { noAuth: true });
            await finishLogin(t.access_token);
          } catch (e) { haptic("error"); showError("Google sign-in didn't work. Please try again."); }
        },
      });
      const holder = h("div");
      slot.replaceChildren(holder);
      window.google.accounts.id.renderButton(holder, { theme: "outline", size: "large", shape: "rectangular", text: "continue_with", width: Math.min(343, window.innerWidth - 32) });
    } catch {}
  }).catch(() => {});
  return slot;
}

function authScreen(children) {
  return { accent: "items", el: h("div", { class: "auth" }, children) };
}
function logo() { return h("div", { class: "logo" }, wordmark("pink")); }

// ---------- 01 Log in ----------
export function loginScreen(ctx) {
  const bannerSlot = h("div");
  const showError = (msg, kind = "error") => {
    const b = banner(kind, msg);
    bannerSlot.replaceChildren(b);
    if (!reduceMotion()) {
      // the form slides down to make room for the banner, then banner + form shake left/right
      form.animate([{ transform: "translateY(-33px)" }, { transform: "none" }], { duration: 200, easing: "ease-out" });
      setTimeout(() => { shake(b.firstChild); shake(form); }, 200);
    }
  };
  if (ctx.query.expired) bannerSlot.appendChild(banner("info", "Your login expired, please log in again"));

  const email = field({ label: "Email", type: "email", placeholder: "you@example.com", autocomplete: "email", inputmode: "email" });
  const forgot = h("a", { class: "link press", href: "#/forgot", onclick: (e) => { e.preventDefault(); go("/forgot"); } }, "Forgot password?");
  const pw = field({ label: "Password", type: "password", placeholder: "Your password", autocomplete: "current-password", eye: true, labelRight: forgot });
  const submit = button("Log in", null, "primary", { type: "submit" });

  const form = h("form", { novalidate: true, onsubmit: async (e) => {
    e.preventDefault();
    if (!email.input.value.trim() || !pw.input.value) { haptic("error"); showError("Wrong email or password"); return; }
    submit.classList.add("loading");
    submit.querySelector(".px").textContent = "Logging in…";
    try {
      const t = await api("POST", "/login", { username: email.input.value.trim(), password: pw.input.value }, { form: true, noAuth: true });
      await finishLogin(t.access_token);
    } catch (err) {
      submit.classList.remove("loading");
      submit.querySelector(".px").textContent = "Log in";
      haptic("error");
      pw.input.value = "";                      // clear the password, keep the email
      showError(err.offline ? "You’re offline. Check your data or Wi-Fi." : err.status === 401 ? "Wrong email or password" : err.detail);
    }
  } }, email.el, pw.el, submit);

  return authScreen([
    logo(),
    h("h1", {}, "Welcome!"),
    h("p", { class: "sub" }, "Log in to see when you can afford your next thing."),
    bannerSlot, form,
    h("div", { class: "or" }, "or"),
    googleArea(showError),
    h("p", { class: "foot" }, "New here? ", h("a", { class: "link press", href: "#/signup" }, "Create an account")),
  ]);
}

// ---------- 02 Sign up ----------
export function signupScreen(ctx) {
  const bannerSlot = h("div");
  const showError = (msg) => bannerSlot.replaceChildren(banner("error", msg));
  const name = field({ label: "Name", placeholder: "What should we call you?", autocomplete: "given-name" });
  const email = field({ label: "Email", type: "email", placeholder: "you@example.com", autocomplete: "email", inputmode: "email" });
  const pw = field({ label: "Password", type: "password", placeholder: "Make a password", autocomplete: "new-password", eye: true, hint: "At least 8 characters" });
  const submit = button("Create account", null, "primary", { type: "submit" });

  const form = h("form", { novalidate: true, onsubmit: async (e) => {
    e.preventDefault();
    bannerSlot.replaceChildren();
    let bad = false;
    const n = name.input.value.trim();
    if (!n) { name.error("Please tell us your name."); bad = true; }
    else if (n.length > 40) { name.error("Name must be 40 characters or less."); bad = true; }
    if (!email.input.value.trim()) { email.error("Enter your email"); bad = true; }
    if (pw.input.value.length < 8) { pw.error("At least 8 characters"); bad = true; }
    if (bad) { haptic("error"); return; }
    submit.classList.add("loading");
    try {
      await api("POST", "/signup", { name: n, email: email.input.value.trim(), password: pw.input.value }, { noAuth: true });
      const t = await api("POST", "/login", { username: email.input.value.trim(), password: pw.input.value }, { form: true, noAuth: true });
      await finishLogin(t.access_token);
    } catch (err) {
      submit.classList.remove("loading");
      haptic("error");
      const d = err.detail || "";
      if (/email/i.test(d)) email.error(d);
      else if (/name/i.test(d)) name.error(d);
      else if (err.status === 422) pw.error("At least 8 characters");
      else showError(err.offline ? "You’re offline. Check your data or Wi-Fi." : d);
    }
  } }, name.el, email.el, pw.el, submit);

  return authScreen([
    logo(),
    h("h1", {}, "Oya, let's go!"),
    h("p", { class: "sub" }, "Make your account. It takes a minute."),
    bannerSlot, form,
    h("div", { class: "or" }, "or"),
    googleArea(showError),
    h("p", { class: "foot" }, "Already have an account? ", h("a", { class: "link press", href: "#/login" }, "Log in")),
  ]);
}

// ---------- 01 Forgot password ----------
export function forgotScreen(ctx) {
  const email = field({ label: "Email", type: "email", placeholder: "you@example.com", autocomplete: "email", inputmode: "email", value: ctx.query.email || "" });
  const submit = button("Send reset link", null, "primary", { type: "submit" });
  const form = h("form", { novalidate: true, onsubmit: async (e) => {
    e.preventDefault();
    const v = email.input.value.trim();
    if (!v) { email.error("Enter your email"); haptic("error"); return; }
    submit.classList.add("loading");
    try { await api("POST", "/auth/forgot", { email: v }, { noAuth: true }); } catch {}
    haptic("tap");
    go(`/forgot/sent?email=${encodeURIComponent(v)}`);   // always shown, even if the email isn't registered
  } }, email.el, submit);
  return authScreen([
    logo(),
    h("h1", {}, "Forgot it?"),
    h("p", { class: "sub" }, "Type your email. We’ll send you a link to set a new password."),
    form,
    h("p", { class: "note" }, "Signed up with Google? You don’t have a password. Use Continue with Google instead."),
    button("Back to log in", () => go("/login", "back")),
  ]);
}

export function forgotSentScreen(ctx) {
  const email = ctx.query.email || "your email";
  return authScreen([
    bigIcon("copy"),
    h("h1", {}, "Check your email"),
    h("p", { class: "sub" }, `We sent a link to ${email}. It works for 30 minutes.`),
    button("Back to log in", () => go("/login", "back"), "primary"),
    h("p", { class: "foot" }, h("button", { class: "link press", type: "button", onclick: async (e) => {
      try { await api("POST", "/auth/forgot", { email: ctx.query.email || "" }, { noAuth: true }); } catch {}
      e.target.textContent = "Sent again ✓";
    } }, "Didn’t get it? Send it again")),
  ]);
}

// ---------- 01 Set new password (from the email link) ----------
export function resetScreen(ctx) {
  const token = ctx.query.token || "";
  const wrap = h("div", { class: "auth" });
  const expired = () => wrap.replaceChildren(
    bigIcon("alert"),
    h("h1", {}, "Link expired"),
    h("p", { class: "sub" }, "Reset links work for 30 minutes. Ask for a new one."),
    button("Send a new link", () => go("/forgot"), "primary"),
  );
  const p1 = field({ label: "New password", type: "password", placeholder: "At least 8 characters", autocomplete: "new-password", eye: true });
  const p2 = field({ label: "Type it again", type: "password", placeholder: "Same password again", autocomplete: "new-password", eye: true });
  const submit = button("Save new password", null, "primary", { type: "submit" });
  const form = h("form", { novalidate: true, onsubmit: async (e) => {
    e.preventDefault();
    if (p1.input.value.length < 8) { p1.error("At least 8 characters"); haptic("error"); return; }
    if (p1.input.value !== p2.input.value) { p2.error("The passwords don’t match"); haptic("error"); return; }
    submit.classList.add("loading");
    try {
      await api("POST", "/auth/reset", { token, password: p1.input.value }, { noAuth: true });
      auth.token = null; store.clear();
      haptic("success");
      go("/password-changed");
    } catch (err) { submit.classList.remove("loading"); if (err.detail === "expired") expired(); else p1.error(err.detail); }
  } }, p1.el, p2.el, submit);
  wrap.append(logo(), h("h1", {}, "New password"), h("p", { class: "sub" }, "Pick a new password for RoomFund."), form);
  api("POST", "/auth/reset/check", { token }, { noAuth: true }).catch((e) => { if (e.detail === "expired" || e.status === 400) expired(); });
  return { accent: "items", el: wrap };
}

export function passwordChangedScreen() {
  return authScreen([
    bigIcon("tick"),
    h("h1", {}, "All set!"),
    h("p", { class: "sub" }, "Your new password is saved. Log in with it."),
    button("Log in", () => go("/login"), "primary"),
  ]);
}
