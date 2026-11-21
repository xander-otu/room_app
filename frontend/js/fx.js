// ---------------------------------------------------------
// fx.js: the special animations.
//   shake()        wrong password / wrong code (Section 5)
//   showBadges()   "BADGE EARNED!" card + pixel confetti (Section 16)
//   stampItemPage / stampItemCard   the BOUGHT stamp (Section 22)
// All of them respect Reduce motion (Section 23).
// ---------------------------------------------------------
import { h, px, reduceMotion, haptic } from "./lib.js";
import { icon } from "./icons.js";

// Error shake: −10, +8, −5, +3, 0 (about 70ms each).
export function shake(el) {
  if (!el || reduceMotion()) return;
  el.classList.remove("shake");
  void el.offsetWidth;            // restart the animation
  el.classList.add("shake");
}

// The pixel icon for each badge, on a yellow octagon.
export const BADGE_ICONS = {
  first_naira: "target", on_a_roll: "flame", first_buy: "cart", halfway_there: "flag",
  price_watcher: "eye", room_builder: "house", payday_pro: "calendar", streak_master: "star",
  bargain_hunter: "tag", snapshot: "camera", comeback: "loop", room_planner: "room",
};
const BADGE_LINES = {
  first_naira: "Your first savings logged", on_a_roll: "4 weeks in a row", first_buy: "Your first item bought",
  halfway_there: "Half your room is bought", price_watcher: "5 prices logged", room_builder: "5 items bought",
  payday_pro: "3 payday check-ins answered", streak_master: "12 weeks in a row", bargain_hunter: "Bought below its price",
  snapshot: "3 items have a photo", comeback: "Back to saving after a break", room_planner: "Room imported",
};

// ---------- Confetti: squares, zigzag streamers and pixel ticks ----------
const COLORS = ["#0E7A4A", "#FF7AC6", "#FFC93C", "#B9A4FF", "#6CC6FF", "#111111"];
function confettiPiece() {
  const color = COLORS[Math.floor(Math.random() * COLORS.length)];
  const kind = Math.random();
  if (kind < 0.55) {            // small square, 1px black outline
    const s = 5 + Math.floor(Math.random() * 4);
    return h("div", { style: { position: "absolute", width: `${s}px`, height: `${s}px`, background: color, outline: "1px solid #111" } });
  }
  if (kind < 0.8) {             // zigzag streamer: stair-step string of 4px squares
    const wrap = h("div", { style: { position: "absolute" } });
    for (let i = 0; i < 5; i++) wrap.appendChild(h("div", { style: { position: "absolute", left: `${i * 4}px`, top: `${(i % 2) * 4}px`, width: "4px", height: "4px", background: color } }));
    return wrap;
  }
  const sp = h("span", { style: { position: "absolute", color } });   // pixel tick
  sp.appendChild(icon("tick", "sm"));
  return sp;
}
export function confetti(x, y, count = 50) {
  if (reduceMotion()) return;
  const layer = h("div", { class: "confetti", style: { width: "100vw", height: "100vh" } });
  document.body.appendChild(layer);
  const anims = [];
  for (let i = 0; i < count; i++) {
    const p = confettiPiece();
    p.style.left = `${x}px`; p.style.top = `${y}px`;
    layer.appendChild(p);
    const dx = (Math.random() - 0.5) * 260, up = 30 + Math.random() * 70, fall = 200 + Math.random() * 120;
    const rot = (Math.random() - 0.5) * 90;
    anims.push(p.animate([
      { transform: "translate(0,0) rotate(0)", opacity: 1 },
      { transform: `translate(${dx * 0.6}px, ${-up}px) rotate(${rot / 2}deg)`, opacity: 1, offset: 0.25 },
      { transform: `translate(${dx}px, ${fall}px) rotate(${rot}deg)`, opacity: 0 },
    ], { duration: 1600, easing: "cubic-bezier(.2,.6,.4,1)", fill: "forwards" }).finished);
  }
  Promise.all(anims).catch(() => {}).then(() => layer.remove());
}

// ---------- Badge earned pop-up: one after the other, never stacked ----------
const queue = [];
let showing = false;
export function showBadges(list) {
  for (const b of list || []) queue.push(b);
  if (!showing) next();
}
async function next() {
  const b = queue.shift();
  if (!b) { showing = false; return; }
  showing = true;
  await showOne(b);
  next();
}
function showOne(b) {
  return new Promise((resolve) => {
    const rm = reduceMotion();
    let done = false;
    const card = px("div", "badge-pop", [
      h("div", { class: "octagon" }, icon(BADGE_ICONS[b.key] || "star", "lg")),
      h("div", {}, h("div", { class: "lbl" }, "BADGE EARNED!"), h("div", { class: "nm" }, b.name), h("div", { class: "ln" }, BADGE_LINES[b.key] || b.description)),
    ], { role: "status", title: "Open Progress" });
    document.body.appendChild(card);
    haptic("celebrate");
    const exit = async (fast = false) => {
      if (done) return; done = true;
      await card.animate(rm ? [{ opacity: 1 }, { opacity: 0 }]
        : [{ transform: "translateX(0) rotate(0)" }, { transform: "translateX(calc(100% + 40px)) rotate(4deg)" }],
        { duration: fast ? 200 : 450, easing: "ease-in", fill: "forwards" }).finished.catch(() => {});
      card.remove();
      resolve();
    };
    card.addEventListener("click", () => { exit(true); location.hash = "/progress"; });
    let sx = null;     // swipe right to dismiss early
    card.addEventListener("pointerdown", (e) => { sx = e.clientX; });
    card.addEventListener("pointerup", (e) => { if (sx !== null && e.clientX - sx > 40) exit(true); sx = null; });
    if (rm) card.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200 });
    else {
      card.animate([{ transform: "translateX(calc(100% + 40px)) rotate(-6deg)" }, { transform: "translateX(0) rotate(0)" }],
        { duration: 550, easing: "cubic-bezier(.34,1.56,.64,1)" });
      const r = card.getBoundingClientRect();
      setTimeout(() => confetti(r.left + 20, r.top + r.height / 2), 120);
    }
    setTimeout(() => exit(), (rm ? 200 : 550) + 2200);     // stays 2.2s
  });
}

// ---------- The BOUGHT stamp (Section 22) ----------

// Big stamp on the item page photo: slam, jolt, bits, settle.
export async function stampItemPage(hero, page) {
  const stamp = hero.querySelector(".stamp-big");
  const corner = hero.querySelector(".tick-stamp");
  if (!stamp) return;
  if (reduceMotion()) {
    stamp.animate([{ opacity: 0 }, { opacity: 0.9 }], { duration: 250, fill: "both" });
    corner?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 250 });
    return;
  }
  if (corner) corner.style.opacity = "0";
  const base = "translate(-50%, -50%)";
  await stamp.animate([
    { transform: `${base} translateY(-24px) scale(2.4) rotate(-28deg)`, opacity: 0 },
    { transform: `${base} scale(.92) rotate(-12deg)`, opacity: 0.9 },
  ], { duration: 220, easing: "ease-in", fill: "both" }).finished.catch(() => {});
  haptic("thud");
  page.animate([{ transform: "translate(2px, 4px)" }, { transform: "none" }], { duration: 300, easing: "ease-out" });
  bits(hero, 14);
  stamp.animate([
    { transform: `${base} scale(.92) rotate(-12deg)`, opacity: 0.9 },
    { transform: `${base} scale(1) rotate(-12deg)`, opacity: 0.9 },
  ], { duration: 300, easing: "ease-out", fill: "both" });
  if (corner) {
    corner.style.opacity = "";
    corner.animate([{ transform: "scale(0) rotate(-10deg)" }, { transform: "scale(1.15) rotate(-10deg)" }, { transform: "scale(1) rotate(-10deg)" }], { duration: 300, easing: "ease-out" });
  }
}

// ~14 small green pixel bits burst out around the stamp.
function bits(container, n) {
  const r = container.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  const layer = h("div", { class: "confetti", style: { width: "100vw", height: "100vh" } });
  document.body.appendChild(layer);
  for (let i = 0; i < n; i++) {
    const b = h("div", { style: { position: "absolute", left: `${cx}px`, top: `${cy}px`, width: "6px", height: "6px", background: "#3DD68C", outline: "1px solid #111" } });
    layer.appendChild(b);
    const ang = (i / n) * Math.PI * 2, dist = 70 + Math.random() * 50;
    b.animate([{ transform: "translate(0,0)", opacity: 1 }, { transform: `translate(${Math.cos(ang) * dist}px, ${Math.sin(ang) * dist * 0.6}px)`, opacity: 0 }],
      { duration: 500, easing: "ease-out", fill: "forwards" });
  }
  setTimeout(() => layer.remove(), 600);
}

// Small tick stamp dropping onto an Items card (after a 250ms pause so you see it happen).
export function stampItemCard(card) {
  const stamp = card.querySelector(".tick-stamp");
  if (!stamp) return;
  if (reduceMotion()) { stamp.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 250, fill: "both" }); return; }
  stamp.animate([
    { transform: "scale(2.2) rotate(-35deg)", opacity: 0 },
    { transform: "scale(1) rotate(-10deg)", opacity: 1 },
  ], { duration: 220, delay: 250, easing: "ease-in", fill: "both" }).finished.then(() => haptic("thud")).catch(() => {});
}
