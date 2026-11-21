// ---------------------------------------------------------
// progress.js: the progress bar component (Section 11) and
// the 08 Progress screen with badges (Section 12).
// ---------------------------------------------------------
import { h, px, button, api, store, naira, money, errorCard, skeleton, haptic, reduceMotion, countUp } from "../lib.js";
import { icon } from "../icons.js";
import { go } from "../app.js";
import { BADGE_ICONS, showBadges, confetti } from "../fx.js";

const BLOCK = 16, GAP = 3;      // square blocks, 16px wide with 3px gaps (Section 11)

// progressBar: label + % on one row, a pixel track of square blocks, a "₦X saved of ₦Y" line.
// As many blocks as fit the track; filled blocks = round(percent × block count).
// The filled blocks light up one after another when the bar appears, and the % rolls up.
// kind "next": 100% shows "You can buy it now!" + a link to that item.
export function progressBar({ label, percent, under, kind = "next", itemId = null }) {
  const full = percent >= 100;
  const blocks = h("div", { class: "blocks" });
  let drawnFor = 0;
  const fill = () => {
    const width = blocks.clientWidth;
    if (!width || width === drawnFor) return;
    drawnFor = width;
    const count = Math.max(4, Math.floor((width + GAP) / (BLOCK + GAP)));
    const on = Math.round((Math.min(100, percent) / 100) * count);
    blocks.replaceChildren(...Array.from({ length: count }, (_, i) => h("span", { class: `blk ${i < on ? "on" : ""}` })));
    if (!reduceMotion()) {
      [...blocks.children].slice(0, on).forEach((b, i) =>
        b.animate([{ transform: "scaleY(.2)", opacity: 0 }, { transform: "scaleY(1.25)", opacity: 1, offset: .7 }, { transform: "none", opacity: 1 }],
          { duration: 260, delay: 120 + i * 35, easing: "ease-out", fill: "backwards" }));
    }
  };
  new ResizeObserver(fill).observe(blocks);       // works out the count once it's on screen (and on resize)
  const pctEl = h("span", { class: "pct num" }, `${percent}%`);
  countUp(pctEl, percent, (v) => `${v}%`);          // the % rolls up while the blocks light up
  return h("div", { class: `pbar ${full ? "full" : ""}`, role: "progressbar", "aria-valuenow": String(percent), "aria-valuemin": "0", "aria-valuemax": "100", "aria-label": label },
    h("div", { class: "row" }, h("span", { class: "lbl" }, label), pctEl),
    px("div", "track", [blocks]),
    h("div", { class: "under" }, ...under),
    full && kind === "next" && itemId ? h("button", { type: "button", class: "ready link press", onclick: () => go(`/items/${itemId}`) }, "You can buy it now! →") : null,
  );
}
export function nextItemBar(next) {
  if (!next) return null;
  return progressBar({ label: `Next: ${next.name}`, percent: next.percent, itemId: next.item_id,
    under: [money(next.saved), " saved of ", money(next.price)] });
}
// under: optional custom line (My Room shows "1 of 6 bought · ₦85,000 of ₦503,000").
export function roomBar(room, label = "Done so far", under = null) {
  return progressBar({ label, percent: room.percent, kind: "room", under: under || [money(room.bought_value), " of ", money(room.total_value), " bought"] });
}

// ---------- 08 Progress ----------
export function progressScreen(ctx) {
  const body = h("div");
  const load = async () => {
    body.replaceChildren(skeleton(3, 3));
    try {
      const [p, settings] = await Promise.all([api("GET", "/progress"), store.loadSettings(true)]);
      draw(p, settings);
      if (p.new_badges?.length) showBadges(p.new_badges);
    } catch (e) { body.replaceChildren(errorCard(e, load)); }
  };

  const draw = (p, settings) => {
    const complete = p.room.total_value > 0 && p.room.percent >= 100;
    const roomCard = px("div", `card room-card ${complete ? "done" : ""}`, [
      h("div", { class: "head" }, px("div", `ic-box ${complete ? "done" : ""}`, [icon("house", "lg")]),
        h("div", {}, h("h3", {}, complete ? "Room complete! 🎉" : "My room"),
          h("div", { class: "pixel-text sm muted" }, complete ? "Everything on your list is bought." : "Measured by money, not item count"))),
      roomBar(p.room),
    ]);
    const stat = (ic, value, label, fill) => {
      const s = px("div", "stat", [icon(ic), h("div", { class: "v" }, value), h("div", { class: "k" }, label)]);
      s.style.setProperty("--fill", fill);
      return s;
    };
    const visible = p.badges.filter((b) => b.key !== "room_planner" || settings.show_room_tab);   // Room Planner only with the My Room tab
    body.replaceChildren(
      roomCard,
      complete ? null : nextItemBar(p.next_item),
      h("div", { class: "stats" },
        stat("flame", `${p.streak_weeks} ${p.streak_weeks === 1 ? "week" : "weeks"}`, "Streak", "var(--soft-yellow)"),
        stat("target", money(p.saved_so_far), "Total saved", "var(--soft-green)"),
        stat("cart", String(p.items_bought), "Items bought", "var(--soft-lilac)")),
      h("div", { class: "section-title" }, "Badges"),
      h("div", { class: "badges" }, ...visible.map((b) => px("div", `badge ${b.earned ? "" : "locked"}`, [
        px("div", `octagon big ${b.earned ? "" : "locked"}`, [icon(b.earned ? (BADGE_ICONS[b.key] || "star") : "lock", "lg")]),
        h("div", { class: "nm" }, b.name),
        h("div", { class: "ds" }, b.description, !b.earned && b.show_progress ? ` · ${b.progress}/${b.goal}` : ""),
      ]))),
    );
    if (complete && sessionStorage.getItem("rf_room_complete") !== "1") {   // celebrate once per visit
      sessionStorage.setItem("rf_room_complete", "1");
      haptic("celebrate");
      const r = roomCard.getBoundingClientRect();
      confetti(r.left + r.width / 2, r.top + 40, 50);
    }
  };
  load();
  return { accent: "progress", tab: "progress", header: { wordmark: true, title: "Progress", sub: "Your wins so far" }, el: body };
}
