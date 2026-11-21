// ---------------------------------------------------------
// items.js: the Items screen (home) and Search.
// Design PDF Sections 7B, 13, 17, 18, 20.
// ---------------------------------------------------------
import { h, px, bigIcon, button, iconButton, naira, money, api, store, prefs, statusChip, priorityChip, errorCard, skeleton, countUp, popChip } from "../lib.js";
import { icon } from "../icons.js";
import { go, back } from "../app.js";
import { stampItemCard } from "../fx.js";

// Items bought on the item page this session: their card stays where it was ONE time
// and the tick stamp drops onto it (Section 22).
export const justBought = new Set();

const FREQ_LABEL = { weekly: "week", biweekly: "2 weeks", monthly: "month" };

// ---------- The item card (used on Items, Search and My Room) ----------
function thumb(item, cls = "") {
  return h("div", { class: `thumb ${cls}` }, item.photo_url ? h("img", { src: item.photo_url, alt: "", loading: "lazy" }) : icon("photo", "lg"));
}
function detailLine(item) {
  if (item.status === "bought") return h("div", { class: "detail" }, "Bought for ", money(item.bought_price ?? item.price));
  if (item.monthly_price_increase_pct > 0) return h("div", { class: "detail" }, `↑ ${+item.monthly_price_increase_pct}%/month`);
  return h("div", { class: "detail" }, "No price rise logged");
}
// The name, with the matched search text drawn in deep pink and underlined.
function nameEl(item, q) {
  const n = h("div", { class: "name" });
  const i = q ? item.name.toLowerCase().indexOf(q.toLowerCase()) : -1;
  if (i < 0) n.textContent = item.name;
  else n.append(item.name.slice(0, i), h("span", { class: "hl" }, item.name.slice(i, i + q.length)), item.name.slice(i + q.length));
  return n;
}
export function itemCard(item, { q = "", density = store.settings?.list_density || "moderate", onclick } = {}) {
  const bought = item.status === "bought";
  const prio = bought ? null : h("span", { class: "prio" }, priorityChip(item.priority));
  const price = h("div", { class: "price money" }, naira(item.price));
  let children;
  if (density === "compact") {
    children = [thumb(item), h("div", { class: "content-fade", style: { minWidth: 0 } }, nameEl(item, q), price), h("div", { class: "right" }, statusChip(item.status))];
  } else if (density === "comfortable") {
    children = [thumb(item),
      h("div", { class: "comfy-row content-fade" }, nameEl(item, q), prio),
      h("div", { class: "comfy-row" }, h("span", { class: "content-fade" }, price), statusChip(item.status)),
      h("div", { class: "content-fade" }, detailLine(item))];
  } else {
    children = [
      h("div", { class: "content-fade", style: { minWidth: 0 } }, nameEl(item, q)), h("div", { class: "right" }, prio),
      h("div", { class: "content-fade" }, price), h("div", { class: "right" }, statusChip(item.status)),
      h("div", { class: "content-fade", style: { gridColumn: "1 / -1" } }, detailLine(item)),
    ];
  }
  const card = px("button", `item-card press ${bought ? "bought" : ""} ${density === "moderate" ? "no-thumb" : ""}`, children,
    { type: "button", onclick: onclick || (() => go(`/items/${item.id}`)), "aria-label": `${item.name}, ${naira(item.price)}, ${item.status}` });
  card.style.textAlign = "left";
  if (bought) card.appendChild(px("span", "tick-stamp", [icon("tick", "sm")], { "aria-hidden": "true" }));
  return card;
}

// Balance bar: "Available to spend ₦100,000" + "+₦50,000 / month" (payday amount, or monthly_savings).
function balanceBar(settings, schedule) {
  let per = null;
  if (schedule?.frequency && schedule.frequency !== "irregular" && schedule.amount != null) per = [schedule.amount, FREQ_LABEL[schedule.frequency]];
  else if (settings?.monthly_savings) per = [settings.monthly_savings, "month"];
  return px("div", "balance flat", [
    h("div", {}, h("div", { class: "lbl" }, "Available to spend"), h("div", { class: "amt" }, naira(settings?.saved_so_far || 0))),
    per ? h("div", { class: "per" }, `+${naira(per[0])} / ${per[1]}`) : null,
  ]);
}

// ---------- 03 Items ----------
export function itemsScreen(ctx) {
  const body = h("div");
  let filter = ctx.query.filter || "all";

  const draw = (items, settings, schedule) => {
    const counts = { all: items.length, wanted: items.filter((i) => i.status === "wanted").length, bought: items.filter((i) => i.status === "bought").length };
    // Bought items go to the bottom, except one that was JUST bought (it stays put one time).
    const sorted = [...items.filter((i) => i.status !== "bought" || justBought.has(i.id)), ...items.filter((i) => i.status === "bought" && !justBought.has(i.id))];
    const shown = filter === "all" ? sorted : sorted.filter((i) => i.status === filter);
    ctx.ui.setSub?.(filter === "all" ? `${items.length} ${items.length === 1 ? "thing" : "things"}` : `${shown.length} shown`);

    if (!items.length) {           // Items – empty (Section 18): what new users see after sign up
      body.replaceChildren(balanceBar(settings, schedule),
        px("div", "card state-card", [
          bigIcon("list"),
          h("h3", { class: "f-head" }, "Nothing on your list yet"),
          h("p", {}, "Add the first thing your room needs. RoomFund will tell you when you can afford it."),
          button("+ Add your first item", () => go("/items/new"), "primary"),
        ]));
      return;
    }
    const chips = h("div", { class: "chips filter-chips" }, ...[["all", "All"], ["wanted", "Wanted"], ["bought", "Bought"]].map(([k, label]) =>
      px("button", `chip press ${filter === k ? "on" : ""}`, [`${label} · ${counts[k]}`], { type: "button", "aria-pressed": String(filter === k),
        onclick: () => { filter = k; draw(items, settings, schedule); popChip(body.querySelector(".filter-chips .chip.on")); } })));
    const list = h("div", {}, shown.map((it) => itemCard(it)));
    if (!shown.length) list.appendChild(h("p", { class: "list-note" }, "Nothing here yet."));
    body.replaceChildren(balanceBar(settings, schedule), chips, list);

    // Play the small tick stamp once for anything just bought.
    for (const id of justBought) {
      const idx = shown.findIndex((i) => i.id === id);
      if (idx >= 0) stampItemCard(list.children[idx]);
    }
    justBought.clear();
  };

  const load = async () => {
    body.replaceChildren(px("div", "balance flat", [h("div", {}, h("div", { class: "lbl" }, "Available to spend"), h("div", { class: "skel", style: { height: "26px", width: "140px" } }))]), skeleton(3, 4));
    try {
      const [items, settings, schedule] = await Promise.all([store.loadItems(true), store.loadSettings(true), store.loadSchedule(true).catch(() => null)]);
      draw(items, settings, schedule);
      countUp(body.querySelector(".balance .amt"), settings.saved_so_far);   // the balance rolls up like a score
    } catch (e) {
      const bb = balanceBar(store.settings, store.schedule);
      bb.classList.add("dim");
      body.replaceChildren(bb, errorCard(e, load));
    }
  };
  load();

  const quick = h("div", { class: "quick" },
    iconButton("search", () => go("/search"), "Search your items", "round"),
    iconButton("plus", () => go("/items/new"), "Add item", "accent round"));
  return {
    accent: "items", tab: "items",
    header: { wordmark: true, title: "My items", sub: "" },
    el: h("div", {}, body, quick),
  };
}

// ---------- 03 Items – search (a mode of Items: pink accent, tab bar stays) ----------
function recent() { try { return JSON.parse(prefs.get("rf_recent_searches", "[]")); } catch { return []; } }
function remember(q) {
  q = q.trim();
  if (!q) return;
  const list = [q, ...recent().filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, 5);
  prefs.set("rf_recent_searches", JSON.stringify(list));
}

export function searchScreen(ctx) {
  const input = h("input", { type: "search", placeholder: "Search your items", "aria-label": "Search your items", autocomplete: "off" });
  const clear = h("button", { type: "button", class: "eye press", "aria-label": "Clear search", onclick: () => { input.value = ""; input.focus(); run(); } }, icon("close", "sm"));
  const bar = px("div", "input", [h("span", { style: { paddingLeft: "12px", display: "grid" } }, icon("search", "sm")), input, clear]);
  bar.style.flex = "1";
  const body = h("div");
  let items = store.items || [];
  let timer = null;

  const run = () => {
    const q = input.value.trim();
    clear.style.visibility = q ? "visible" : "hidden";
    if (!q) {
      const r = recent();
      body.replaceChildren(
        r.length ? h("div", { class: "chips", style: { margin: "4px 0 16px" } }, h("span", { class: "pixel-text sm muted", style: { alignSelf: "center" } }, "Recent:"),
          ...r.map((x) => px("button", "chip press", [x], { type: "button", onclick: () => { input.value = x; run(); } }))) : null,
        h("p", { class: "pixel-text muted" }, "Type to search names and notes. Results show as you type."));
      return;
    }
    const lower = q.toLowerCase();
    const found = items.filter((i) => i.name.toLowerCase().includes(lower) || (i.notes || "").toLowerCase().includes(lower));
    clearTimeout(timer);
    timer = setTimeout(() => remember(q), 1200);
    if (!found.length) {
      body.replaceChildren(
        h("p", { class: "search-head" }, `No items called “${q}”`),
        px("div", "card state-card", [
          bigIcon("search"),
          h("h3", { class: "f-head" }, "Not on your list yet"),
          h("p", {}, `Need a ${q}? Add it and RoomFund will plan when you can afford it.`),
          button(`+ Add "${q}"`, () => go(`/items/new?name=${encodeURIComponent(q)}`), "primary"),
        ]));
      return;
    }
    body.replaceChildren(
      h("p", { class: "search-head" }, `${found.length} ${found.length === 1 ? "item matches" : "items match"} “${q}”`),
      ...found.map((it) => itemCard(it, { q, onclick: () => { remember(q); go(`/items/${it.id}`); } })));
  };
  input.addEventListener("input", run);
  run();
  if (!store.items) store.loadItems().then((x) => { items = x; run(); }).catch(() => {});

  return {
    accent: "items", tab: "items",
    header: { back: "/items", custom: bar, gear: false },
    el: body,
    onShow: () => input.focus(),
  };
}
