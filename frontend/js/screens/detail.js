// ---------------------------------------------------------
// detail.js: 05 Item detail. Design PDF Sections 7D, 7E, 10, 22, 24.
// ---------------------------------------------------------
import { h, px, button, field, moneyInput, chipChoice, banner, modal, sheet, confirmBox, api, store, haptic, naira, nairaK, money,
         statusChip, priorityChip, errorCard, skeleton, iso, today, parseDate, fmtShort, addMonths, fmtMonthLong } from "../lib.js";
import { icon } from "../icons.js";
import { go, back } from "../app.js";
import { photoSheet, photoProblem } from "./popups.js";
import { justBought } from "./items.js";
import { showBadges, stampItemPage } from "../fx.js";

// Month n on the Timeline → a real month: counted from today, or from the next payday when set.
export function monthDate(n, schedule) {
  if (schedule?.next_payday && schedule.frequency !== "irregular") return addMonths(parseDate(schedule.next_payday), Math.max(0, n - 1));
  return addMonths(today(), n);
}
function riseLine(pct) {
  if (pct === null || pct === undefined) return "Log prices over at least a month to see how fast it's rising.";
  if (pct > 0) return `Prices for this have been rising about ${+pct.toFixed(1)}% a month.`;
  if (pct < 0) return `Prices for this have been falling about ${+Math.abs(pct).toFixed(1)}% a month.`;
  return "Prices for this haven't moved.";
}

export function detailScreen(ctx) {
  const id = Number(ctx.params.id);
  const page = h("div");
  let item, report, plan, schedule;

  const load = async () => {
    page.replaceChildren(skeleton(3, 4));
    try {
      [item, report, plan, schedule] = await Promise.all([
        api("GET", `/items/${id}`), api("GET", `/items/${id}/prices`),
        api("GET", "/timeline").catch(() => []), store.loadSchedule(true).catch(() => null)]);
      ctx.ui.setTitle?.(item.name);
      draw();
    } catch (e) { page.replaceChildren(errorCard(e, load)); }
  };

  // ---------- Photo hero ----------
  function hero() {
    const bought = item.status === "bought";
    const inner = [];
    if (item.photo_url) inner.push(h("img", { src: item.photo_url, alt: item.name }));
    else if (!bought) inner.push(h("div", { class: "ph" }, h("div", {}, icon("photo", "xl"), `Tap to add a photo of your ${item.name.toLowerCase()}`)));
    if (bought) inner.push(h("div", { class: "stamp-big", "aria-label": "Bought" }, icon("tick", "lg"), "BOUGHT"));
    const box = px("div", "hero", inner);
    box.firstChild.style.setProperty("--fill", "var(--accent-soft)");
    if (!item.photo_url) box.firstChild.style.setProperty("--fill", "var(--sky-soft)");   // no photo: the sky-blue area (bought or not)
    box.appendChild(h("div", { class: "add-photo" }, px("button", "btn small auto press", [icon("camera", "sm"), item.photo_url ? "Change photo" : "Add photo"], { type: "button", onclick: changePhoto })));
    if (!bought && !item.photo_url) box.firstChild.addEventListener("click", changePhoto);
    if (bought) box.appendChild(px("span", "tick-stamp big", [icon("tick", "lg")]));
    return box;
  }
  async function changePhoto(e) {
    e?.stopPropagation?.();
    const r = await photoSheet({ hasPhoto: !!item.photo_url });
    if (!r) return;
    try {
      if (r.remove) { await api("DELETE", `/items/${id}/photo`); item.photo_url = null; }
      else {
        const problem = photoProblem(r.file);
        if (problem) throw { detail: problem };
        const fd = new FormData(); fd.append("photo", r.file);
        const res = await api("POST", `/items/${id}/photo`, fd);
        item.photo_url = res.photo_url;
        if (res.new_badges?.length) showBadges(res.new_badges);
      }
      store.items = null;
      draw();
    } catch (err) { haptic("error"); topErr.replaceChildren(banner("error", err.offline ? "You’re offline. Try again." : err.detail)); }
  }

  const topErr = h("div");

  // ---------- Verdict card ----------
  function verdict() {
    if (item.status === "bought") {
      const when = item.bought_on ? ` on ${fmtShort(item.bought_on)}` : "";
      return px("div", "card green", [
        px("div", "verdict-badge bought", ["BOUGHT"]),
        h("p", { class: "pixel-text" }, "You bought this for ", money(item.bought_price ?? item.price), `${when}. Nice one!`),
        h("p", { class: "pixel-text sm muted", style: { marginTop: "8px" } }, "It's off your timeline now. One step closer to your room."),
      ]);
    }
    const v = report.verdict;
    const cls = v === "BUY NOW" ? "green" : v === "HOLD" ? "yellow" : "";
    const badge = v === "BUY NOW" ? "buy" : v === "HOLD" ? "hold" : "nodata";
    return px("div", `card ${cls}`, [
      px("div", `verdict-badge ${badge}`, [v]),
      h("p", { class: "pixel-text" }, ...withMoney(report.reason)),
      h("p", { class: "pixel-text sm muted", style: { marginTop: "8px" } }, riseLine(report.estimated_monthly_pct)),
    ]);
  }
  // Keep every ₦ amount in Inter inside Pixelify sentences (Section 7G).
  function withMoney(text) {
    return text.split(/(₦[\d,]+)/).map((part) => part.startsWith("₦") ? h("span", { class: "money" }, part) : part);
  }

  // ---------- Timeline card (7E) ----------
  function timelineCard() {
    if (item.status === "bought") return null;
    const stop = plan.find((p) => p.item_id === id);
    if (!stop) return null;
    if (stop.Month === "never") {
      return px("div", "card red tl-card", [
        px("div", "ic-box red", [icon("alert")]),
        h("div", {}, h("div", { class: "f-head" }, "You can't catch this one yet"),
          h("div", { class: "pixel-text sm" }, "This price rises faster than you save. Buy it earlier (raise its priority), save more each month, or pick a cheaper one.")),
      ]);
    }
    const n = stop.Month;
    const card = px("div", "card tl-card", [
      px("div", "ic-box sky", [icon("calendar")]),
      h("div", {},
        h("div", { class: "f-head" }, n === 0 ? "You can afford this now" : ["You can afford this in ", h("strong", {}, `Month ${n}`)]),
        h("div", { class: "pixel-text sm muted" }, n === 0 ? "From your Timeline" : `About ${fmtMonthLong(monthDate(n, schedule))} · from your Timeline`)),
    ]);
    card.style.setProperty("--fill", "var(--sky-soft)");
    return card;
  }

  // ---------- Prices you've seen: bar chart + rows ----------
  function chart() {
    const checks = report.checks;
    if (!checks.length) return null;
    const max = Math.max(...checks.map((c) => c.price));
    const pct = report.estimated_monthly_pct;
    return px("div", "card chart", [
      h("div", { class: "cap" }, pct === null ? "Prices you logged, oldest first" : `${pct >= 0 ? "↑ rising" : "↓ falling"} about ${+Math.abs(pct).toFixed(1)}% a month`),
      h("div", { class: "bars" }, ...checks.slice(-8).map((c) => h("div", { class: "bar-col" },
        h("div", { class: "amt" }, nairaK(c.price)),
        h("div", { class: `bar ${c.id === report.lowest_check_id ? "low" : ""}`, style: { height: `${Math.max(8, (c.price / max) * 100)}px` } }),
        h("div", { class: "date" }, fmtShort(c.checked_on))))),
    ]);
  }
  function priceRows() {
    if (!report.checks.length) {
      return px("div", "card state-card", [h("p", { style: { margin: 0 } }, "No prices logged yet. Seen this somewhere? Log the price.")]);
    }
    return h("div", {}, ...[...report.checks].reverse().map((c) => {
      const low = c.id === report.lowest_check_id;
      return px("div", `price-row ${low ? "lowest" : ""}`, [
        h("div", { class: "grow" }, h("div", { class: "p" }, naira(c.price), low ? h("span", { class: "f-head", style: { fontSize: "14px" } }, "  · lowest") : null),
          h("div", { class: "m" }, `${c.source} · ${fmtShort(c.checked_on)}`)),
        c.link ? h("a", { class: "mini-btn press", href: c.link, target: "_blank", rel: "noopener", "aria-label": "Open the shop link" }, icon("link", "sm")) : null,
        h("button", { class: "mini-btn press", type: "button", "aria-label": "Delete this price", onclick: async () => {
          const yes = await confirmBox({ icon: "trash", title: "Delete this price?",
            text: `${naira(c.price)} at ${c.source} on ${fmtShort(c.checked_on)} comes off the chart. The buy advice can change.`, yes: "Yes, delete it" });
          if (!yes) return;
          try { await api("DELETE", `/items/${id}/prices/${c.id}`); await reloadPrices(); }
          catch (e) { haptic("error"); topErr.replaceChildren(banner("error", e.detail)); }
        } }, icon("trash", "sm")),
      ]);
    }));
  }
  async function reloadPrices() {
    report = await api("GET", `/items/${id}/prices`);
    draw();
  }

  // ---------- Log a price (bottom sheet) ----------
  function logPrice() {
    const priceF = field({ label: "Price (₦)", placeholder: "e.g. 38,000" });
    const getP = moneyInput(priceF);
    const other = field({ label: "Shop name", placeholder: "e.g. Balogun market" });
    other.el.classList.add("hidden");
    const where = chipChoice(["Jumia", "Jiji", "Konga", "Temu", "Market", "Other"].map((s) => [s, s]), "Jumia",
      { onChange: (v) => other.el.classList.toggle("hidden", v !== "Other") });
    const link = field({ label: "Link (optional)", placeholder: "https://…", type: "url" });
    const date = field({ label: "Date", type: "date", value: iso(today()), inputAttrs: { max: iso(today()) } });
    const err = h("div");
    sheet((close) => [
      h("h2", {}, "Log a price you saw"), err, priceF.el,
      h("div", { class: "field" }, h("div", { class: "field-label" }, "Where did you see it?"), where.el), other.el,
      link.el, date.el,
      button("Save price", async (e) => {
        if (getP() <= 0) { priceF.error("Enter a price above ₦0"); haptic("error"); return; }
        const source = where.get() === "Other" ? (other.input.value.trim() || "Other") : where.get();
        e.currentTarget.classList.add("loading");
        try {
          const res = await api("POST", `/items/${id}/prices`, { price: getP(), source, link: link.input.value.trim() || null, checked_on: date.input.value || null });
          haptic("tap");
          close(true);
          await reloadPrices();
          if (res.new_badges?.length) showBadges(res.new_badges);
        } catch (x) { e.currentTarget.classList.remove("loading"); haptic("error"); err.replaceChildren(banner("error", x.offline ? "You’re offline. Try again." : x.detail)); }
      }, "primary"),
      button("Cancel", () => close(null)),
    ], { accent: "detail" });
    setTimeout(() => priceF.input.focus(), 240);
  }

  // ---------- I bought it (pop-up) ----------
  function bought() {
    const saved = store.settings?.saved_so_far ?? 0;
    const amount = field({ label: "How much did you pay?", prefix: "₦", value: String(item.price) });
    const get = moneyInput(amount);
    const note = h("p", { class: "lead" });
    const updateNote = () => note.replaceChildren("This comes out of your savings (", money(saved), " → ", money(Math.max(0, saved - get())), ").");
    amount.input.addEventListener("input", updateNote);
    updateNote();
    const err = h("div");
    modal((close) => [
      h("div", { class: "icon-top", style: { color: "var(--text)" } }, icon("cart", "xl")),
      h("h2", {}, `You bought ${item.name}?`), err, amount.el, note,
      button("Confirm", async (e) => {
        if (get() <= 0) { amount.error("Enter a price above ₦0"); haptic("error"); return; }
        e.currentTarget.classList.add("loading");
        try {
          const res = await api("POST", `/items/${id}/buy`, { price_paid: get() });
          close(true);                               // the pop-up closes instantly…
          item = res;
          justBought.add(id);
          store.items = null; store.settings = null; store.loadSettings(true).catch(() => {});
          draw();                                    // …the page switches to Bought…
          await stampItemPage(page.querySelector(".hero"), page);   // …and the stamp slams down
          if (res.new_badges?.length) showBadges(res.new_badges);
        } catch (x) {
          e.currentTarget.classList.remove("loading");
          haptic("error");
          amount.el.classList.add("error");
          err.replaceChildren(banner("error", x.offline ? "You’re offline. Try again." : x.detail));   // word for word from the backend
        }
      }, "primary"),
      button("Cancel", () => close(null)),
    ], { accent: "detail" });
  }

  // ---------- Draw ----------
  function draw() {
    const isBought = item.status === "bought";
    page.replaceChildren(
      topErr, hero(),
      h("div", { class: "price-line" }, h("span", { class: "big money" }, naira(item.price)),
        h("span", { class: "chips" }, isBought ? null : priorityChip(item.priority), statusChip(item.status))),
      verdict(),
      timelineCard(),
      h("div", { class: "section-title" }, "Prices you’ve seen", px("button", "chip press", ["+ Log a price"], { type: "button", onclick: logPrice })),
      chart(), priceRows(),
      h("div", { style: { height: "16px" } }),
      isBought ? null : button("I bought it", bought, "primary"),
      isBought ? null : h("div", { style: { height: "12px" } }),
      button("Edit item", () => go(`/items/${id}/edit`)),
    );
  }

  load();
  return {
    accent: "detail",
    header: { back: "/items", title: "Item", sub: "Item details", gear: false },
    el: page,
  };
}
