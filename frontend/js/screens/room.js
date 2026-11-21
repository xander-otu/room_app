// ---------------------------------------------------------
// room.js: 10 My Room (the optional 5th tab). Plan the room in
// ChatGPT with our prompt, paste its RoomFund code, preview,
// import. Design PDF Sections 14, 15, 17, 18, 20.
// ---------------------------------------------------------
import { h, px, button, iconButton, field, moneyInput, banner, modal, sheet, confirmBox, toast, api, store, haptic, naira, money,
         errorCard, skeleton } from "../lib.js";
import { icon } from "../icons.js";
import { go } from "../app.js";
import { itemCard } from "./items.js";
import { roomBar } from "./progress.js";
import { showBadges, shake } from "../fx.js";

// The prompt (copy exactly, Section 15). One constant so it can be tweaked without touching anything else.
export const ROOM_PROMPT = `You are helping me plan and furnish a room in Nigeria on a budget, for an
app called RoomFund. Use simple English.

1. First ask me, one short question at a time:
   - what to call the room (e.g. "My bedroom")
   - the room size: I may give measurements, doodle/sketch it, or upload
     a photo. If I'm not sure, estimate it and tell me it's an estimate.
   - my total budget in naira and my city
   - what I already have, and anything I must have
2. Suggest a simple layout. Draw it as a top-down text grid (1 square =
   50 cm) with the furniture labelled. If you can also make a sketch
   image, add it, but keep the text grid.
3. List only the items I still need (skip what I already have). For each:
   a short name (2-3 words, e.g. "Standing fan"), a realistic current
   price in naira for my city, a priority (high, medium or low) and a
   size if it matters. Must-haves first. If you can search the web,
   check current Nigerian prices; otherwise say prices are estimates.
   Tell me the total and whether it fits my budget; if not, mark what
   can wait (low priority).
4. End your answer with my RoomFund code: ONE code block with only valid
   JSON (double quotes, no comments, no trailing commas), in exactly
   this shape:

{"roomfund": 1,
 "room": {"name": "My bedroom", "width_cm": 300, "length_cm": 360},
 "items": [
  {"name": "Mattress", "price": 180000, "priority": "high",
   "size": "180 x 200 cm", "notes": "6 inch foam"}
 ]}

Rules for the code: prices and sizes in cm are whole numbers with no
commas or currency sign; priority is "high", "medium" or "low"; leave
size or notes out if unknown; at most 30 items. If I change anything
later, give me the full updated code again.`;

const WRONG = "That doesn't look like a RoomFund code. Copy the whole code block from ChatGPT and try again.";
const NO_ITEMS = "No items found in this room. Ask ChatGPT: give me the RoomFund code with my items.";

// Read ChatGPT's answer: take everything from the first { to the last }, JSON.parse,
// accept prices like "₦180,000", lower-case priority (default medium). Throws WRONG / NO_ITEMS.
export function parseRoomCode(text) {
  const start = text.indexOf("{"), end = text.lastIndexOf("}");
  let data;
  try { data = JSON.parse(text.slice(start, end + 1)); } catch { throw new Error(WRONG); }
  if (start < 0 || !data || data.roomfund != 1 || typeof data !== "object") throw new Error(WRONG);
  if (!Array.isArray(data.items) || !data.items.length) throw new Error(NO_ITEMS);
  const toInt = (v) => { const n = Number(String(v ?? "").replace(/[^\d]/g, "")); return n > 0 ? n : null; };
  const room = data.room || {};
  const items = data.items.slice(0, 30).map((it) => {
    const sizes = String(it.size || "").match(/\d+/g)?.map(Number) || [];
    let priority = String(it.priority || "").toLowerCase().trim();
    if (!["high", "medium", "low"].includes(priority)) priority = "medium";
    return {
      name: String(it.name || "").trim().slice(0, 80), price: toInt(it.price), priority,
      width_cm: sizes[0] || null, depth_cm: sizes[1] || null, height_cm: sizes[2] || null,
      notes: it.notes ? String(it.notes).slice(0, 500) : null, size: it.size || null,
    };
  }).filter((it) => it.name && it.price);
  if (!items.length) throw new Error(NO_ITEMS);
  return { room: { name: String(room.name || "My room").trim().slice(0, 80) || "My room", width_cm: toInt(room.width_cm), length_cm: toInt(room.length_cm) }, items };
}

const sizeText = (r) => r.width_cm && r.length_cm ? `${r.width_cm} × ${r.length_cm} cm` : "Size not given";

export function roomScreen(ctx) {
  const body = h("div");
  let room = null;           // the saved room (GET /room) or null
  let lastPaste = "";

  const load = async () => {
    body.replaceChildren(skeleton(2, 3));
    try {
      await store.loadItems(true);
      try { room = await api("GET", "/room"); } catch (e) { if (e.status === 404) room = null; else throw e; }
      room ? imported() : empty();
    } catch (e) { body.replaceChildren(errorCard(e, load)); }
  };

  // ---------- Empty ----------
  const empty = () => {
    ctx.ui.setSub?.("Plan it with ChatGPT");
    body.replaceChildren(px("div", "card state-card", [
      h("div", { class: "big-icon" }, icon("room", "xl")),
      h("h3", { class: "f-head" }, "Plan your room with ChatGPT"),
      h("p", {}, "Copy our prompt, describe or doodle your room in ChatGPT, then bring its list back here."),
      button("Get started", () => paste(), "primary"),
    ]));
  };

  // ---------- Paste code ----------
  const paste = (problem = null) => {
    ctx.ui.setSub?.("Bring your room in");
    const copyBtn = button("Copy prompt", null, "primary");
    copyBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(ROOM_PROMPT);
        haptic("tap");
        copyBtn.querySelector(".px").textContent = "Copied ✓";
        toast("Prompt copied! Now paste it in ChatGPT");
        setTimeout(() => { copyBtn.querySelector(".px").textContent = "Copy prompt"; }, 2000);
      } catch {
        // Clipboard blocked: show the whole prompt, selected, so it can be copied by hand.
        const ta = h("textarea", { readonly: true, style: { width: "100%", height: "50vh", fontFamily: "Pixelify Sans, monospace", fontSize: "13px" } });
        ta.value = ROOM_PROMPT;
        sheet((close) => [h("h2", {}, "Copy the prompt"), h("p", { class: "lead" }, "Press and hold, then Copy."), ta, h("div", { style: { height: "12px" } }), button("Done", () => close())]);
        setTimeout(() => { ta.focus(); ta.select(); }, 250);
      }
    });
    const code = field({ type: "textarea", label: "Paste the RoomFund code from ChatGPT", placeholder: '{"roomfund": 1, "room": …, "items": […]}', value: lastPaste });
    const err = h("div");
    const tip = h("p", { class: "hint hidden" }, "Copy only the code block at the end of ChatGPT's answer. If it's missing, ask: give me the RoomFund code.");
    const show = (msg) => {
      haptic("error");
      const b = banner("error", msg);
      err.replaceChildren(b);
      code.el.classList.add("error");
      tip.classList.toggle("hidden", msg !== WRONG);
      shake(b.firstChild);
    };
    body.replaceChildren(
      px("div", "card how", [h("h3", {}, "How it works"), h("ol", {},
        h("li", {}, "Copy the RoomFund prompt below."),
        h("li", {}, "Paste it in ChatGPT, answer its questions, doodle your room or send a photo."),
        h("li", {}, "ChatGPT ends with a RoomFund code. Copy it and paste it here."))]),
      px("div", "card", [
        h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px" } },
          h("h3", { style: { margin: 0 } }, "The RoomFund prompt"), px("span", "chip flat", ["for ChatGPT"])),
        h("div", { class: "prompt-preview" }, ROOM_PROMPT),
        h("div", { class: "btn-row" }, copyBtn, button("Open ChatGPT", () => window.open("https://chatgpt.com/", "_blank", "noopener"))),
      ]),
      err, code.el, tip,
      button("Import", () => {
        lastPaste = code.input.value;
        try { preview(parseRoomCode(code.input.value)); haptic("tap"); }
        catch (e) { show(e.message); }
      }, "primary"),
      room ? h("div", { style: { height: "12px" } }) : null,
      room ? button("Cancel", () => imported()) : null,
    );
    if (problem) show(problem);
  };

  // ---------- Preview ----------
  const preview = (parsed) => {
    ctx.ui.setSub?.("Check before adding");
    const mine = new Set((store.items || []).map((i) => i.name.trim().toLowerCase()));
    const rows = parsed.items.map((it) => ({ ...it, exists: mine.has(it.name.toLowerCase()), on: !mine.has(it.name.toLowerCase()) }));
    const list = h("div");
    const addBtn = button("", null, "primary");
    const count = () => rows.filter((r) => r.on).length;
    const drawBtn = () => {
      const n = count();
      addBtn.querySelector(".px").textContent = n ? `Add ${n} ${n === 1 ? "item" : "items"} to RoomFund` : "Tick something to add";
      addBtn.disabled = !n;
    };
    const editPrice = async (r) => {
      const f = field({ label: `Price of ${r.name} (₦)`, prefix: "₦", value: String(r.price) });
      const get = moneyInput(f);
      const m = modal((close) => [h("h2", {}, "Change the price"), f.el,
        button("Save", () => { if (get() > 0) close(get()); else f.error("Enter a price above ₦0"); }, "primary"),
        button("Cancel", () => close(null))]);
      const v = await m.done;
      if (v) { r.price = v; draw(); }
    };
    const draw = () => {
      list.replaceChildren(...rows.map((r) => {
        const rowEl = px("div", `check-row ${r.on ? "" : "off"}`, [
          h("button", { type: "button", class: `cbox press ${r.on ? "on" : ""}`, role: "checkbox", "aria-checked": String(r.on), "aria-label": `Add ${r.name}`,
            onclick: () => { r.on = !r.on; draw(); } }, r.on ? icon("tick", "sm") : null),
          h("div", { class: "grow" },
            h("div", { class: "nm" }, r.name),
            h("div", { class: "meta" }, h("button", { type: "button", class: "link press", style: { color: "inherit" }, onclick: () => editPrice(r) }, money(r.price)),
              r.width_cm ? ` · ${[r.width_cm, r.depth_cm, r.height_cm].filter(Boolean).join(" × ")} cm` : ""),
            r.exists ? h("div", { style: { marginTop: "4px" } }, px("span", "chip flat yellow", ["Already in your items"])) : null),
          px("button", `chip press ${r.priority === "high" ? "priority-high" : ""}`, [r.priority], { type: "button", "aria-label": `Priority ${r.priority}, tap to change`,
            onclick: () => { r.priority = { high: "medium", medium: "low", low: "high" }[r.priority]; draw(); } }),
        ]);
        return rowEl;
      }));
      drawBtn();
    };
    draw();
    addBtn.addEventListener("click", async () => {
      const ticked = rows.filter((r) => r.on).map(({ exists, on, size, ...it }) => it);
      if (!ticked.length) return;
      addBtn.classList.add("loading");
      try {
        const res = await api("POST", "/room/import", { roomfund: 1, room: parsed.room, items: ticked });
        haptic("success");
        store.items = null;
        room = await api("GET", "/room");
        await store.loadItems(true);
        imported();
        toast(`${res.items_added} ${res.items_added === 1 ? "item" : "items"} added 🎉`, 2500);
        if (res.new_badges?.length) setTimeout(() => showBadges(res.new_badges), 600);
      } catch (e) {
        addBtn.classList.remove("loading");
        haptic("error");
        body.prepend(banner("error", e.offline ? "You’re offline. Try again." : e.detail));
      }
    });
    body.replaceChildren(
      px("div", "card soft", [h("h3", {}, parsed.room.name), h("div", { class: "pixel-text sm muted" }, `${sizeText(parsed.room)} · ${parsed.items.length} ${parsed.items.length === 1 ? "item" : "items"} found`)]),
      h("p", { class: "pixel-text sm muted" }, "Tap a price or priority to change it before adding."),
      list, addBtn, h("div", { style: { height: "12px" } }),
      button("Cancel", () => paste()));
  };

  // ---------- Imported ----------
  const imported = () => {
    ctx.ui.setSub?.("Your room");
    const items = (store.items || []).filter((i) => i.room_id === room.room.id);
    const menuBtn = iconButton("dots", () => openMenu(), "Room menu");
    const openMenu = () => {
      const s = sheet((close) => [
        h("h2", {}, room.room.name),
        px("button", "sheet-option press", [icon("loop"), "Import again / update"], { type: "button", onclick: () => { close(); paste(); } }),
        px("button", "sheet-option danger press", [icon("trash"), "Remove room"], { type: "button", onclick: async () => {
          close();
          const yes = await confirmBox({ icon: "trash", title: "Remove this room?",
            text: `Your ${room.item_count} ${room.item_count === 1 ? "item stays" : "items stay"} on your list. Only the room, its size and floor plan go.`, yes: "Yes, remove it" });
          if (!yes) return;
          try { await api("DELETE", "/room"); room = null; store.items = null; empty(); }
          catch (e) { haptic("error"); body.prepend(banner("error", e.detail)); }
        } }),
        button("Cancel", () => close()),
      ], { accent: "room" });
    };
    const shown = items.slice(0, 3);
    body.replaceChildren(
      h("div", { style: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "12px" } },
        h("div", {}, h("h2", { class: "f-head", style: { margin: "0 0 2px", fontSize: "22px" } }, room.room.name),
          h("div", { class: "pixel-text sm muted" }, sizeText(room.room))), menuBtn),
      h("div", { style: { height: "12px" } }),
      roomBar(room.progress, "Room done"),
      px("div", "card floor-ph", [h("div", { class: "grid" }), h("span", { class: "lbl" }, "Floor plan coming soon")]),
      h("div", { class: "section-title" }, "In this room"),
      items.length ? h("div", {}, ...shown.map((it) => itemCard(it))) : h("p", { class: "list-note" }, "No items from this room yet."),
      items.length > 3 ? h("button", { type: "button", class: "link press list-note", style: { display: "block", margin: "0 auto 16px" }, onclick: (e) => {
        e.target.replaceWith(...items.slice(3).map((it) => itemCard(it)));
      } }, `+ ${items.length - 3} more`) : null,
    );
  };

  load();
  return { accent: "room", tab: "room", header: { wordmark: true, title: "My Room", sub: "" }, el: body };
}
