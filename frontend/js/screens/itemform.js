// ---------------------------------------------------------
// itemform.js: 04 Add item and 04 Edit item. Design PDF Section 9.
// ---------------------------------------------------------
import { h, px, button, iconButton, field, moneyInput, chipChoice, banner, confirmBox, api, store, haptic, errorCard, skeleton } from "../lib.js";
import { icon } from "../icons.js";
import { go, back } from "../app.js";
import { photoSheet, photoProblem } from "./popups.js";
import { showBadges } from "../fx.js";

function form({ item = null, presetName = "" }) {
  const editing = !!item;
  const errSlot = h("div");
  let pendingFile = null, removePhoto = false;

  // Photo picker card (soft cobalt)
  const thumbBox = h("div", { class: "thumb", style: { width: "56px", height: "56px", flex: "none" } });
  const photoTitle = h("div", { class: "t f-pixel" });
  const drawPhoto = (src) => {
    thumbBox.replaceChildren(src ? h("img", { src, alt: "" }) : icon("photo", "lg"));
    photoTitle.textContent = src || editing ? "Change photo" : "Add a photo";
  };
  drawPhoto(item?.photo_url || null);
  const photoCard = px("div", "card photo-card flat", [
    thumbBox,
    h("div", { style: { flex: 1 } }, photoTitle, h("div", { class: "pixel-text sm muted" }, "Optional · camera or gallery")),
    iconButton("camera", async () => {
      const r = await photoSheet({ hasPhoto: !!(pendingFile || (item?.photo_url && !removePhoto)) });
      if (!r) return;
      if (r.remove) { pendingFile = null; removePhoto = true; drawPhoto(null); return; }
      const problem = photoProblem(r.file);
      if (problem) { haptic("error"); errSlot.replaceChildren(banner("error", problem)); return; }
      errSlot.replaceChildren();
      pendingFile = r.file; removePhoto = false;
      drawPhoto(URL.createObjectURL(r.file));
    }, "Add photo", "accent"),
  ]);
  photoCard.style.setProperty("--fill", "var(--accent-soft)");

  const name = field({ label: "Name", placeholder: "e.g. Standing fan", value: item?.name || presetName });
  const price = field({ label: "Price (₦)", placeholder: "e.g. 40,000", value: item ? String(item.price) : "" });
  const getPrice = moneyInput(price);
  const prio = chipChoice([["high", "High"], ["medium", "Medium"], ["low", "Low"]], item?.priority || "medium", { cls: (v, on) => on ? "pick" : "" });
  const pct = field({ label: "Price rise per month (%)", value: String(item?.monthly_price_increase_pct ?? 0), inputmode: "decimal",
    hint: "How fast does this get more expensive? Leave 0 if unsure." });
  const status = editing ? chipChoice([["wanted", "Wanted"], ["saving", "Saving"], ["bought", "Bought"]], item.status,
    { cls: (v, on) => `status-pick ${on ? `status ${v}` : ""}` }) : null;
  if (status) status.el.querySelectorAll(".chip > .px").forEach((p, i) => p.prepend(h("span", { class: "dot" })));

  // Size is folded away behind "+ Add size".
  const w = field({ label: "Width (cm)", value: item?.width_cm ?? "", inputmode: "numeric" });
  const d = field({ label: "Depth (cm)", value: item?.depth_cm ?? "", inputmode: "numeric" });
  const ht = field({ label: "Height (cm)", value: item?.height_cm ?? "", inputmode: "numeric" });
  const sizeFields = h("div", { class: "size-fields hidden" }, h("div", { class: "size-grid" }, w.el, d.el, ht.el));
  const hasSize = item && (item.width_cm || item.depth_cm || item.height_cm);
  if (hasSize) sizeFields.classList.remove("hidden");
  const sizeToggle = px("button", "card press fold", [
    h("div", { style: { flex: 1 } }, h("div", { class: "f-head", style: { fontSize: "16px" } }, hasSize ? "Size" : "+ Add size"),
      h("div", { class: "pixel-text sm muted" }, "Width × depth × height in cm, for the floor plan later")),
    h("span", { "aria-hidden": "true" }, "▾"),
  ], { type: "button", "aria-expanded": String(!!hasSize), onclick: (e) => {
    const open = sizeFields.classList.toggle("hidden") === false;
    e.currentTarget.setAttribute("aria-expanded", String(open));
    if (open) w.input.focus();
  } });

  const num = (f) => { const v = String(f.input.value).replace(/\D/g, ""); return v ? Number(v) : null; };

  async function save(btn) {
    let bad = false;
    if (!name.input.value.trim()) { name.error("Give it a name"); bad = true; }
    if (getPrice() <= 0) { price.error("Enter a price above ₦0"); bad = true; }
    const p = Number(String(pct.input.value).replace(",", ".")) || 0;
    if (p < 0) { pct.error("Use 0 or more"); bad = true; }
    if (bad) { haptic("error"); return; }
    const body = { name: name.input.value.trim(), price: getPrice(), priority: prio.get(), monthly_price_increase_pct: p,
                   width_cm: num(w), depth_cm: num(d), height_cm: num(ht) };
    if (status) body.status = status.get();
    btn.classList.add("loading");
    try {
      const saved = editing ? await api("PUT", `/items/${item.id}`, body) : await api("POST", "/items", body);
      let newBadges = [];
      if (pendingFile) {
        const fd = new FormData(); fd.append("photo", pendingFile);
        const r = await api("POST", `/items/${saved.id}/photo`, fd);
        newBadges = r.new_badges || [];
      } else if (removePhoto && item?.photo_url) {
        await api("DELETE", `/items/${saved.id}/photo`);
      }
      haptic("tap");
      store.items = null;
      back(editing ? `/items/${item.id}` : "/items");
      if (newBadges.length) setTimeout(() => showBadges(newBadges), 400);
    } catch (e) {
      btn.classList.remove("loading");
      haptic("error");
      errSlot.replaceChildren(banner("error", e.offline ? "You’re offline. Your changes are still here, try again." : e.detail));
      errSlot.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }

  const del = editing ? button("Delete item", async () => {
    const yes = await confirmBox({ icon: "trash", title: `Delete ${item.name}?`, text: "This also deletes its price history. You can't undo this.", yes: "Yes, delete it" });
    if (!yes) return;
    try { await api("DELETE", `/items/${item.id}`); store.items = null; go("/items", "back"); }
    catch (e) { haptic("error"); errSlot.replaceChildren(banner("error", e.detail)); }
  }, "danger") : null;

  return h("div", {},
    errSlot, photoCard, name.el, price.el,
    h("div", { class: "field" }, h("div", { class: "field-label" }, "Priority"), prio.el, h("div", { class: "hint" }, "High = you need it first")),
    pct.el,
    status ? h("div", { class: "field" }, h("div", { class: "field-label" }, "Status"), status.el) : null,
    sizeToggle, sizeFields,
    h("div", { style: { height: "8px" } }),
    button(editing ? "Save changes" : "Save item", (e) => save(e.currentTarget), "primary"),
    h("div", { style: { height: "12px" } }),
    button("Cancel", () => back(editing ? `/items/${item.id}` : "/items")),
    del ? h("div", { style: { height: "12px" } }) : null, del);
}

export function addItemScreen(ctx) {
  return {
    accent: "add-item",
    header: { back: "/items", title: "Add item", sub: "Something new for your room", gear: false },
    el: form({ presetName: ctx.query.name || "" }),
  };
}

export function editItemScreen(ctx) {
  const body = h("div", {}, skeleton(2, 4));
  const load = async () => {
    try {
      const item = await api("GET", `/items/${ctx.params.id}`);
      ctx.ui.setSub?.(item.name);
      body.replaceChildren(form({ item }));
    } catch (e) { body.replaceChildren(errorCard(e, load)); }
  };
  load();
  return {
    accent: "add-item",
    header: { back: `/items/${ctx.params.id}`, title: "Edit item", sub: "", gear: false },
    el: body,
  };
}
