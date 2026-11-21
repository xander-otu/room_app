// ---------------------------------------------------------
// settings.js: 09 Settings and 11 Payday setup.
// Design PDF Sections 7C, 7F, 12, 18, 19, 23, 24.
// ---------------------------------------------------------
import { h, px, button, field, moneyInput, banner, confirmBox, api, store, auth, prefs, haptic, naira, money, errorCard, skeleton,
         canVibrate, isIPhone, applyTheme, applyReduceMotion, reduceMotion, iso, today, fmtDay, fmtShort, parseDate, toast } from "../lib.js";
import { icon } from "../icons.js";
import { go, back, tabBar, refreshTabbar } from "../app.js";
import { moneyPopup, namePopup, calendar } from "./popups.js";
import { canInstall, adviseInstall, installStatus, showFindHelp } from "../install.js";

const FREQ = { weekly: "Weekly", biweekly: "Every 2 weeks", monthly: "Monthly", irregular: "It varies" };

// Toggle switch: 56×32 pixel track, money green when on, 120ms slide.
function toggle(on, onChange, { disabled = false, label = "" } = {}) {
  const t = px("button", `toggle press ${on ? "on" : ""}`, [px("span", "knob", [])],
    { type: "button", role: "switch", "aria-checked": String(on), "aria-label": label, disabled });
  t.addEventListener("click", () => {
    on = !on;
    t.classList.toggle("on", on);
    t.setAttribute("aria-checked", String(on));
    onChange(on);
  });
  return t;
}
function segmented(options, value, onPick) {
  const wrap = h("div", { class: "seg", role: "radiogroup" });
  const draw = () => wrap.replaceChildren(...options.map(([v, label]) =>
    px("button", `btn press ${v === value ? "on" : ""}`, [label], { type: "button", role: "radio", "aria-checked": String(v === value),
      onclick: () => { if (v === value) return; value = v; draw(); onPick(v); } })));
  draw();
  return wrap;
}
// A row that opens something: dims slightly while pressed, has a chevron.
function row(k, v, onclick) {
  return h(onclick ? "button" : "div", { class: `set-row ${onclick ? "row-press" : ""}`, type: onclick ? "button" : null, onclick, style: { width: "100%", textAlign: "left" } },
    h("span", { class: "k" }, k), h("span", { class: "v" }, v), onclick ? icon("chevron", "sm") : null);
}
function card(children) { return px("div", "card settings-card", children); }
function block(label, control, hint, cls = "") {
  return h("div", { class: `set-block ${cls}` }, h("div", { class: "head" }, h("span", { class: "k" }, label), control), hint ? h("div", { class: "hint" }, hint) : null);
}

// ---------- 09 Settings ----------
export function settingsScreen(ctx) {
  const body = h("div");
  const load = async () => {
    body.replaceChildren(skeleton(3, 4));
    try {
      const [me, settings, schedule] = await Promise.all([store.loadMe(true), store.loadSettings(true), store.loadSchedule(true).catch(() => null)]);
      draw(me, settings, schedule);
    } catch (e) { body.replaceChildren(errorCard(e, load)); }
  };

  const draw = (me, settings, schedule) => {
    const paydayText = !schedule?.frequency ? "Not set"
      : schedule.frequency === "irregular" ? "It varies"
      : `${FREQ[schedule.frequency]} · ${fmtDay(schedule.next_payday)}`;

    // Bottom bar preview (4 or 5 tabs), updates straight away.
    const preview = h("div", { style: { marginTop: "12px" } }, h("div", { class: "pixel-text sm muted", style: { marginBottom: "8px" } }, "Your bottom bar"), tabBar("items", settings.show_room_tab, true));
    const roomToggle = toggle(settings.show_room_tab, async (on) => {
      haptic("tick");
      try {
        store.settings = await api("PUT", "/settings", { show_room_tab: on });
        preview.replaceChildren(preview.firstChild, tabBar("items", on, true));
        refreshTabbar();
      } catch (e) { haptic("error"); }
    }, { label: "Show My Room tab" });

    // Haptics: greyed out where web vibration isn't supported (e.g. iPhone).
    const vib = canVibrate();
    const hapticsHint = vib ? "A little buzz on important taps, like saving, buying or changing a setting."
      : isIPhone() ? "Haptics aren’t available on iPhone. Apple doesn’t let websites buzz the phone."
      : "Haptics aren’t available on this device.";
    const hapticsToggle = toggle(vib && prefs.get("rf_haptics", "1") === "1", (on) => {
      prefs.set("rf_haptics", on ? "1" : "0");
      if (on) haptic("tick");            // turning it on plays a preview
    }, { disabled: !vib, label: "Haptics" });

    const motionToggle = toggle(reduceMotion(), (on) => {
      prefs.set("rf_reduce_motion", on ? "1" : "0");
      applyReduceMotion();
      haptic("tick");
    }, { label: "Reduce motion" });

    body.replaceChildren(
      h("div", { class: "section-label" }, "Account"),
      card([
        row("Name", me.name, async () => { if (await namePopup()) load(); }),
        row("Email", me.email),
        row("Signed in with", me.signed_in_with),
      ]),
      h("div", { class: "section-label" }, "Money"),
      card([
        row("Saved so far", money(settings.saved_so_far), async () => { if (await moneyPopup({ focus: "saved", fromSettings: true })) load(); }),
        row("You save each month", money(settings.monthly_savings), async () => { if (await moneyPopup({ focus: "monthly", fromSettings: true })) load(); }),
        row("Payday", paydayText, () => go("/payday")),
      ]),
      h("div", { class: "section-label" }, "Display"),
      card([
        h("div", { class: "set-block" }, h("div", { class: "k" }, "List size"),
          segmented([["compact", "Compact"], ["moderate", "Moderate"], ["comfortable", "Comfortable"]], settings.list_density, async (v) => {
            haptic("tick");
            document.getElementById("app").className = `density-${v}`;
            try { store.settings = await api("PUT", "/settings", { list_density: v }); } catch {}
          })),
        h("div", { class: "set-block" }, h("div", { class: "k" }, "Appearance"),
          segmented([["system", "System"], ["light", "Light"], ["dark", "Dark"]], prefs.get("rf_theme", "system"), (v) => {
            haptic("tick");
            prefs.set("rf_theme", v);
            applyTheme();
          })),
      ]),
      h("div", { class: "section-label" }, "Feel"),
      card([
        block("Reduce motion", motionToggle, "Fewer animations: no splash, shake or stamp slam."),
        block("Haptics", hapticsToggle, hapticsHint, vib ? "" : "disabled"),
        // A test button: buzzes even if Haptics is off, so you can check the phone itself.
        vib ? h("div", { class: "set-block" }, px("button", "btn small auto press", ["📳 Test vibration"], { type: "button", onclick: () => {
          try { navigator.vibrate([60, 80, 60]); } catch {}
          toast("Felt it? If not, check your phone isn’t on silent, Do Not Disturb or battery saver.", 4000);
        } })) : null,
      ]),
      h("div", { class: "section-label" }, "Bottom bar"),
      card([
        h("div", { class: "set-block" },
          h("div", { class: "head" }, h("span", { class: "k" }, "Show My Room tab"), roomToggle),
          h("div", { class: "hint" }, "Turn on if you want to import a room you planned with ChatGPT."),
          preview),
      ]),
      h("div", { style: { height: "8px" } }),
      canInstall() ? button("📲 Install the RoomFund app", () => adviseInstall(), "primary") : null,
      installStatus() === "installed" ? button("📲 RoomFund is installed: where is it?", () => showFindHelp()) : null,
      ["available", "iphone", "installed"].includes(installStatus()) ? h("div", { style: { height: "12px" } }) : null,
      button("Log out", async () => {
        const yes = await confirmBox({ title: "Log out?", text: "You can log back in any time with your email or Google.", yes: "Log out", no: "Cancel" });
        if (!yes) return;
        auth.token = null;
        store.clear();
        go("/login", "back", { replace: true });
      }),
    );
  };
  load();
  return { accent: "settings", header: { back: "/items", title: "Settings", sub: "Make RoomFund yours", gear: false }, el: body };
}

// ---------- 11 Payday – set up ----------
export function paydaySetupScreen(ctx) {
  const body = h("div");
  const load = async () => {
    body.replaceChildren(skeleton(2, 3));
    try { draw(await store.loadSchedule(true)); } catch (e) { body.replaceChildren(errorCard(e, load)); }
  };
  const draw = (schedule) => {
    let freq = schedule?.frequency || "monthly";
    let next = schedule?.next_payday || null;
    const err = h("div");
    const amount = field({ label: "How much do you save from each payday?", prefix: "₦", value: schedule?.amount ? String(schedule.amount) : "", placeholder: "e.g. 50,000" });
    const getAmount = moneyInput(amount);
    const legend = h("div", { class: "pixel-text sm muted", style: { marginTop: "-8px", marginBottom: "16px" } });
    const drawLegend = () => legend.textContent = `Dashed = today (${fmtShort(today())})${next ? ` · Green = payday (${fmtShort(next)})` : ""}`;
    drawLegend();
    const regular = h("div", {},
      h("div", { class: "section-title" }, "Next payday"),
      calendar({ value: next, min: today(), onPick: (k) => { next = k; drawLegend(); } }),
      legend, amount.el);
    const varies = px("div", "card soft", [
      h("h3", {}, "No fixed payday? No wahala."),
      h("p", { class: "pixel-text" }, "Log money with “I saved money” whenever it comes. Your Timeline uses what you really saved over the last 3 months."),
    ]);
    const detail = h("div");
    const drawDetail = () => detail.replaceChildren(freq === "irregular" ? varies : regular);
    const chips = h("div", { class: "chips" });
    const drawChips = () => chips.replaceChildren(...Object.entries(FREQ).map(([k, label]) =>
      px("button", `chip press freq ${k === freq ? "on" : ""}`, [label], { type: "button", role: "radio", "aria-checked": String(k === freq),
        onclick: () => { freq = k; drawChips(); drawDetail(); } })));
    drawChips(); drawDetail();

    body.replaceChildren(
      h("p", { class: "pixel-text" }, "Tell RoomFund when your allowance or salary comes, so your timeline follows real life."),
      h("div", { class: "section-title" }, "How often do you get paid?"),
      chips, detail, err,
      h("div", { style: { height: "8px" } }),
      button("Save payday", async (e) => {
        const payload = { frequency: freq };
        if (freq !== "irregular") {
          if (!next) { haptic("error"); err.replaceChildren(banner("error", "Pick your next payday.")); return; }
          if (getAmount() <= 0) { amount.error("Enter how much you save from each payday."); haptic("error"); return; }
          payload.next_payday = next; payload.amount = getAmount();
        }
        e.currentTarget.classList.add("loading");
        try {
          store.schedule = await api("PUT", "/payday/schedule", payload);
          haptic("tap");
          back("/settings");
        } catch (x) { e.currentTarget.classList.remove("loading"); haptic("error"); err.replaceChildren(banner("error", x.offline ? "You’re offline. Try again." : x.detail)); }
      }, "primary"),
    );
  };
  load();
  return { accent: "savings", header: { back: "/settings", title: "Payday", sub: "Settings · Money", gear: false }, el: body };
}
