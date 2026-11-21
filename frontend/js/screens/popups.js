// ---------------------------------------------------------
// popups.js: pop-ups and sheets used on more than one screen.
//   photoSheet()     Take a photo · Choose from gallery · Remove · Cancel (7D)
//   moneyPopup()     "Your money" (Timeline + Settings)
//   namePopup()      "Your name" (Settings)
//   paydayCheckin()  "Did your allowance land?" (7F)
//   calendar()       month grid used by payday setup + "Pick another date"
// ---------------------------------------------------------
import { h, px, button, field, moneyInput, modal, sheet, banner, api, store, haptic, prefs, naira, money,
         iso, today, addDays, parseDate, fmtDay, fmtMonthLong, ordinal } from "../lib.js";
import { icon } from "../icons.js";
import { go } from "../app.js";

// ---------- Photo sheet ----------
// Resolves to {file} (a picked photo), {remove: true}, or null (cancelled).
export function photoSheet({ hasPhoto = false } = {}) {
  const pick = (capture) => new Promise((resolve) => {
    const inp = h("input", { type: "file", accept: "image/jpeg,image/png,image/webp,image/*", capture: capture ? "environment" : null, style: { display: "none" } });
    inp.addEventListener("change", () => { resolve(inp.files[0] || null); inp.remove(); });
    document.body.appendChild(inp);
    inp.click();
  });
  const s = sheet((close) => [
    h("h2", {}, hasPhoto ? "Change photo" : "Add a photo"),
    h("p", { class: "lead" }, "One photo per item. JPG, PNG or WebP, under 5 MB."),
    px("button", "sheet-option press", [icon("camera"), "Take a photo"], { type: "button", onclick: async () => { const f = await pick(true); close(f ? { file: f } : null); } }),
    px("button", "sheet-option press", [icon("photo"), "Choose from gallery"], { type: "button", onclick: async () => { const f = await pick(false); close(f ? { file: f } : null); } }),
    hasPhoto ? px("button", "sheet-option danger press", [icon("trash"), "Remove photo"], { type: "button", onclick: () => close({ remove: true }) }) : null,
    button("Cancel", () => close(null)),
  ]);
  return s.done;
}

// Check a photo on this device first, with the same words as the backend.
export function photoProblem(file) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return "Use a JPG, PNG or WebP photo.";
  if (file.size > 5 * 1024 * 1024) return "That photo is too big. Pick one under 5 MB.";
  return null;
}

// ---------- "Your money" pop-up ----------
// focus: "saved" or "monthly". fromSettings adds the correction hint.
export function moneyPopup({ focus = "saved", fromSettings = false } = {}) {
  const s = store.settings || { saved_so_far: 0, monthly_savings: 0 };
  const saved = field({ label: "Saved so far", prefix: "₦", value: String(s.saved_so_far || "") , placeholder: "0" });
  const monthly = field({ label: "You save each month", prefix: "₦", value: String(s.monthly_savings || ""), placeholder: "0" });
  const getSaved = moneyInput(saved), getMonthly = moneyInput(monthly);
  const slot = h("div");
  const m = modal((close) => [
    h("h2", {}, "Your money"),
    fromSettings ? h("p", { class: "lead" }, "Changing Saved so far fixes your total. To log new money, use Savings → I saved money.") : null,
    slot, saved.el, monthly.el,
    h("p", { style: { margin: "0 0 16px" } }, h("a", { class: "link press pixel-text", href: "#/payday", onclick: (e) => { e.preventDefault(); close(null); go("/payday"); } }, "Paid on a set day? Set up payday instead →")),
    button("Save", async (e) => {
      const btn = e.currentTarget; btn.classList.add("loading");
      try {
        store.settings = await api("PUT", "/settings", { saved_so_far: getSaved(), monthly_savings: getMonthly() });
        haptic("tap");
        close(store.settings);
      } catch (err) { btn.classList.remove("loading"); haptic("error"); slot.replaceChildren(banner("error", err.offline ? "You’re offline. Try again." : err.detail)); }
    }, "primary"),
    button("Cancel", () => close(null)),
  ]);
  setTimeout(() => (focus === "monthly" ? monthly : saved).input.focus(), 240);
  return m.done;
}

// ---------- "Your name" pop-up ----------
export function namePopup() {
  const f = field({ label: "Name", value: store.me?.name || "", placeholder: "What should we call you?", hint: `RoomFund greets you with it: Hi ${store.me?.name || "Xander"}!` });
  const m = modal((close) => [
    h("h2", {}, "Your name"),
    f.el,
    button("Save", async (e) => {
      const v = f.input.value.trim();
      if (!v) { f.error("Please tell us your name."); haptic("error"); return; }
      if (v.length > 40) { f.error("Name must be 40 characters or less."); haptic("error"); return; }
      e.currentTarget.classList.add("loading");
      try { store.me = await api("PUT", "/me", { name: v }); haptic("tap"); close(store.me); }
      catch (err) { e.currentTarget.classList.remove("loading"); f.error(err.detail || "Something went wrong"); haptic("error"); }
    }, "primary"),
    button("Cancel", () => close(null)),
  ]);
  return m.done;
}

// ---------- Calendar (Mon-first month grid) ----------
// calendar({value, min, max, onPick}) → element. Today = dashed, picked = green.
export function calendar({ value = null, min = null, max = null, onPick }) {
  let shown = parseDate(value || today());
  shown = new Date(shown.getFullYear(), shown.getMonth(), 1);
  let picked = value ? iso(value) : null;
  const t = iso(today());
  const wrap = px("div", "card calendar", []);
  const inner = wrap.firstChild;
  const draw = () => {
    const first = new Date(shown.getFullYear(), shown.getMonth(), 1);
    const offset = (first.getDay() + 6) % 7;
    const days = new Date(shown.getFullYear(), shown.getMonth() + 1, 0).getDate();
    const cells = [];
    for (let i = 0; i < offset; i++) cells.push(h("span"));
    for (let d = 1; d <= days; d++) {
      const day = new Date(shown.getFullYear(), shown.getMonth(), d);
      const key = iso(day);
      const off = (min && key < iso(min)) || (max && key > iso(max));
      cells.push(h("button", {
        type: "button", class: `cal-day press ${key === t ? "today" : ""} ${key === picked ? "on" : ""}`, disabled: off,
        "aria-label": fmtDay(day), "aria-pressed": String(key === picked),
        onclick: () => { picked = key; draw(); onPick?.(key); },
      }, String(d)));
    }
    inner.replaceChildren(
      h("div", { class: "cal-head" },
        h("button", { type: "button", class: "cal-nav press", "aria-label": "Previous month", onclick: () => { shown = new Date(shown.getFullYear(), shown.getMonth() - 1, 1); draw(); } }, "<"),
        h("span", { class: "f-pixel" }, fmtMonthLong(shown)),
        h("button", { type: "button", class: "cal-nav press", "aria-label": "Next month", onclick: () => { shown = new Date(shown.getFullYear(), shown.getMonth() + 1, 1); draw(); } }, ">")),
      h("div", { class: "cal-grid cal-dow" }, ..."MTWTFSS".split("").map((c) => h("span", {}, c))),
      h("div", { class: "cal-grid" }, ...cells));
  };
  draw();
  return wrap;
}

// ---------- Payday check-in (7F) ----------
// Resolves to the backend's answer ({payday, next_payday, new_badges}) or null.
export function paydayCheckin(pending) {
  const amount = pending.amount || 0;
  const due = parseDate(pending.rescheduled_to || pending.expected_date);
  const usual = parseDate(pending.expected_date).getDate();
  let resolveOuter;
  const outer = new Promise((r) => (resolveOuter = r));

  const m = modal((close) => {
    const content = h("div");
    const err = h("div");
    const showError = (e) => { haptic("error"); err.replaceChildren(banner("error", e.offline ? "You’re offline. Try again." : e.detail)); };

    const ask = () => content.replaceChildren(
      h("div", { class: "icon-top" }, h("div", { class: "octagon big", style: { background: "var(--money)", color: "#fff" } }, icon("target", "lg"))),
      h("h2", { style: { textAlign: "center" } }, "Payday check-in 💸"),
      h("p", { class: "lead", style: { textAlign: "center" } }, "Did your allowance land? You usually save ", money(amount), ` on the ${ordinal(usual)}.`),
      button("Yes, I got paid", got, "money"),
      button("Not yet", notYet),
      h("p", { style: { textAlign: "center", margin: "16px 0 0" } }, h("button", { type: "button", class: "link press pixel-text", onclick: () => {
        prefs.set("rf_payday_snooze", iso(today()));          // nothing saved; ask again tomorrow
        close(null);
      } }, "Remind me tomorrow")));

    const got = () => {
      const f = field({ label: "How much are you adding to your savings?", prefix: "₦", value: String(amount || ""), hint: "Part of it is fine. Add what actually came in." });
      const get = moneyInput(f);
      content.replaceChildren(
        h("h2", {}, "Nice! 🎉"), err, f.el,
        button("Save", async (e) => {
          if (get() <= 0) { f.error("Enter an amount above ₦0"); haptic("error"); return; }
          e.currentTarget.classList.add("loading");
          try {
            const res = await api("POST", `/paydays/${pending.id}/received`, { amount: get() });
            haptic("success");
            store.settings = null;
            done(res, "Added to your savings", [money(get()), " is in. Your next payday is ", fmtDay(res.next_payday), "."]);
          } catch (x) { e.currentTarget.classList.remove("loading"); showError(x); }
        }, "money"),
        button("Back", ask));
      setTimeout(() => f.input.focus(), 50);
    };

    const notYet = () => {
      let chosen = null;
      const next = parseDate(pending.next_regular);
      const picks = [];
      for (let i = 1; i <= 5; i++) { const d = addDays(today(), i); if (d < next) picks.push(d); }
      const save = button("Save date", async (e) => {
        if (!chosen) { haptic("error"); err.replaceChildren(banner("error", "Pick a date before your next payday.")); return; }
        e.currentTarget.classList.add("loading");
        try {
          const res = await api("POST", `/paydays/${pending.id}/reschedule`, { date: chosen });
          haptic("tap");
          done(res, "Got it", [`We'll check in again on ${fmtDay(chosen)}. Your timeline only moves by those few days.`]);
        } catch (x) { e.currentTarget.classList.remove("loading"); showError(x); }
      }, "primary");
      const tiles = h("div", { class: "quick-dates" });
      const drawTiles = () => tiles.replaceChildren(...picks.map((d) => px("button", `qd press sm ${iso(d) === chosen ? "on" : ""}`,
        [h("span", { class: "w" }, fmtDay(d).split(" ")[0]), h("span", { class: "d" }, String(d.getDate()))],
        { type: "button", onclick: () => { chosen = iso(d); drawTiles(); calSlot.replaceChildren(); } })));
      drawTiles();
      const calSlot = h("div");
      content.replaceChildren(
        h("h2", {}, "When will it come?"),
        h("p", { class: "lead" }, "No wahala. Pick the day you expect it and we'll ask again then."),
        err, tiles,
        px("button", "btn press small", ["Pick another date"], { type: "button", onclick: () => calSlot.replaceChildren(
          calendar({ min: today(), max: addDays(next, -1), onPick: (k) => { chosen = k; drawTiles(); } })) }),
        calSlot,
        h("div", { style: { height: "12px" } }),
        save,
        button("Skip this month", async (e) => {
          e.currentTarget.classList.add("loading");
          try {
            const res = await api("POST", `/paydays/${pending.id}/skip`);
            haptic("tap");
            done(res, "Skipped", ["No wahala. We've moved your timeline back to match. Next payday: ", fmtDay(res.next_payday), "."]);
          } catch (x) { e.currentTarget.classList.remove("loading"); showError(x); }
        }),
        button("Back", ask));
    };

    const done = (res, title, text) => {
      store.schedule = null;
      content.replaceChildren(
        h("div", { class: "icon-top", style: { color: "var(--money-text)" } }, icon("tick", "xl")),
        h("h2", { style: { textAlign: "center" } }, title),
        h("p", { class: "lead", style: { textAlign: "center" } }, ...text),
        button("Okay", () => close(res), "primary"));
    };

    ask();
    return [content];
  }, { accent: "savings", dismissable: false });
  m.done.then(resolveOuter);
  return outer;
}
