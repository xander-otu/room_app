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
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();                           // don't let the browser show its own small banner
  deferredPrompt = e;
});
window.addEventListener("appinstalled", () => { deferredPrompt = null; toast("RoomFund is installed 🎉"); });

// Already running as the installed app?
export function isInstalled() {
  return window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone === true;
}
// Can we help this person install? (a real prompt, or the iPhone steps)
export function canInstall() {
  return !isInstalled() && (!!deferredPrompt || isIPhone());
}

function appIcon() {
  return h("div", { class: "icon-top" }, h("img", { src: "/img/icon-192.png", alt: "", width: "72", height: "72", class: "install-icon" }));
}

// adviseInstall(): the pop-up. Resolves when it's closed.
export async function adviseInstall() {
  if (isInstalled()) return;
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
