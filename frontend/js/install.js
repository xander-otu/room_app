// ---------------------------------------------------------
// install.js: get people to INSTALL RoomFund (not just add a shortcut).
//   Android / Chrome / Edge: the browser hands us an install prompt; our
//     "Install app" button opens the REAL install (own icon, full screen).
//   iPhone / iPad: Apple doesn't let websites show an install button. There,
//     Share → "Add to Home Screen" IS the install, so we show those steps.
// Shown after every sign-in, unless RoomFund is already installed.
// ---------------------------------------------------------
import { h, px, button, modal, haptic, isIPhone, toast } from "./lib.js";
import { icon } from "./icons.js";

let deferredPrompt = null;                      // the browser's install prompt, saved for later
let installedElsewhere = false;                 // installed already, but we're in the browser tab
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();                           // don't let the browser show its own small banner
  deferredPrompt = e;
});
window.addEventListener("appinstalled", () => {
  deferredPrompt = null;
  installedElsewhere = true;
  showFindHelp();                               // tell them WHERE it went (some phones hide the icon)
});
// Android Chrome can tell a website "your app is installed on this phone" (see manifest.json).
navigator.getInstalledRelatedApps?.().then((apps) => { if (apps?.length) installedElsewhere = true; }).catch(() => {});

// Already running as the installed app?
export function isInstalled() {
  return window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone === true;
}
// "standalone" (we ARE the app) · "installed" (installed, but this is the browser) ·
// "available" (we can show the install box) · "iphone" (show the steps) · "none"
export function installStatus() {
  if (isInstalled()) return "standalone";
  if (installedElsewhere) return "installed";
  if (deferredPrompt) return "available";
  if (isIPhone()) return "iphone";
  return "none";
}
// Can we help this person install? (a real prompt, or the iPhone steps)
export function canInstall() {
  return ["available", "iphone"].includes(installStatus());
}

// "Where did it go?" Android puts installed apps in the APP LIST; on some phones
// (Tecno, Infinix, Xiaomi...) Chrome isn't allowed to put icons on the home screen.
export function showFindHelp() {
  const m = modal((close) => [
    appIcon(),
    h("h2", { style: { textAlign: "center" } }, "RoomFund is installed 🎉"),
    px("div", "card how", [h("ol", {},
      h("li", {}, "Swipe up on your home screen to open your ", h("strong", {}, "app list"), ", and look for RoomFund (the green house icon). Hold it and drag it to your home screen."),
      h("li", {}, "No icon anywhere? Some phones block Chrome from adding icons. Open phone ", h("strong", {}, "Settings → Apps → Chrome → Permissions"),
        " (or ", h("strong", {}, "Other permissions"), ") → turn on ", h("strong", {}, "Home screen shortcuts"), "."),
      h("li", {}, "Then come back here and install again: Settings → Install the RoomFund app."))]),
    button("Got it", () => close(true), "primary"),
  ], { accent: "items" });
  return m.done;
}

function appIcon() {
  return h("div", { class: "icon-top" }, h("img", { src: "/img/icon-192.png", alt: "", width: "72", height: "72", class: "install-icon" }));
}

// adviseInstall(): the pop-up. Resolves when it's closed.
export async function adviseInstall() {
  if (isInstalled() || installedElsewhere) return;      // already installed: don't nag
  if (deferredPrompt) {
    const m = modal((close) => [
      appIcon(),
      h("h2", { style: { textAlign: "center" } }, "Install RoomFund"),
      h("p", { class: "lead", style: { textAlign: "center" } },
        "Get the full app, not a shortcut: its own icon, full screen, and it opens faster. Takes 2 seconds."),
      button("Install app", async () => {
        haptic("tap");
        const prompt = deferredPrompt;
        deferredPrompt = null;                  // a prompt can only be used once
        close(true);
        prompt.prompt();                        // the browser's real install box
        try { await prompt.userChoice; } catch {}
      }, "primary"),
      button("Not now", () => close(false)),
    ], { accent: "items" });
    return m.done;
  }
  if (isIPhone()) {
    const step = (n, ...text) => h("li", {}, ...text);
    const m = modal((close) => [
      appIcon(),
      h("h2", { style: { textAlign: "center" } }, "Install RoomFund"),
      h("p", { class: "lead", style: { textAlign: "center" } },
        "On iPhone, this is how you install it as an app (full screen, its own icon):"),
      px("div", "card how", [h("ol", {},
        step(1, "Tap the Share button ", h("strong", {}, "⬆️"), " at the bottom of Safari."),
        step(2, "Scroll down and tap ", h("strong", {}, "Add to Home Screen"), "."),
        step(3, "Tap ", h("strong", {}, "Add"), ". Then open RoomFund from your home screen."))]),
      button("Got it", () => close(true), "primary"),
    ], { accent: "items" });
    return m.done;
  }
}
