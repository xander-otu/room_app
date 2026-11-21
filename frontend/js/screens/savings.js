// ---------------------------------------------------------
// savings.js: 07 Savings. Design PDF Sections 12, 17, 18, 20.
// ---------------------------------------------------------
import { h, px, bigIcon, button, field, moneyInput, banner, modal, confirmBox, api, store, haptic, naira, money, errorCard, skeleton, countUp,
         iso, today, fmtDay, weekStart, addDays, parseDate } from "../lib.js";
import { icon } from "../icons.js";
import { showBadges } from "../fx.js";

export function savingsScreen(ctx) {
  const body = h("div");
  let streak = 0;

  const load = async () => {
    body.replaceChildren(skeleton(2, 4));
    try {
      const [logs, progress, settings, schedule] = await Promise.all([
        api("GET", "/savings"), api("GET", "/progress"), store.loadSettings(true), store.loadSchedule(true).catch(() => null)]);
      streak = progress.streak_weeks;
      ctx.ui.setSub?.(streak ? `🔥 ${streak} ${streak === 1 ? "week" : "weeks"} in a row` : "No streak yet");
      draw(logs, settings, schedule);
      countUp(body.querySelector(".balance .amt"), settings.saved_so_far);
    } catch (e) { body.replaceChildren(errorCard(e, load)); }
  };

  const streakCard = (logs) => {
    // 8 boxes, oldest left, ticked for weeks with savings.
    const weeks = new Set(logs.map((l) => iso(weekStart(l.saved_on))));
    const thisWeek = weekStart(today());
    const boxes = [];
    for (let i = 7; i >= 0; i--) {
      const wk = iso(addDays(thisWeek, -7 * i));
      const on = weeks.has(wk);
      boxes.push(px("span", `wk st1 ${on ? "on" : ""}`, [on ? icon("tick", "sm") : null], { title: `Week of ${fmtDay(wk)}` }));
    }
    const c = px("div", "card streak-card", [
      h("div", { style: { display: "flex", gap: "12px", alignItems: "center" } },
        px("div", "ic-box yellow", [icon("flame", "lg")]),
        h("div", {}, h("div", { class: "big" }, streak ? `${streak} ${streak === 1 ? "week" : "weeks"} in a row` : "No streak yet"),
          h("div", { class: "pixel-text sm muted" }, "Save something every week to keep it going."))),
      h("div", { class: "weeks", "aria-label": "Last 8 weeks" }, ...boxes),
      h("div", { class: "pixel-text sm muted", style: { marginTop: "8px" } }, "Last 8 weeks"),
    ]);
    return c;
  };

  const savedBar = (settings, schedule) => px("div", "balance flat", [
    h("div", {}, h("div", { class: "lbl" }, "Saved so far"), h("div", { class: "amt" }, naira(settings.saved_so_far))),
    schedule?.next_payday && schedule.frequency !== "irregular"
      ? h("div", { class: "per", style: { textAlign: "right" } }, "Next payday", h("br"), fmtDay(schedule.next_payday)) : null,   // not rendered at all when there's no payday
  ]);

  const addButton = () => button("+ I saved money", savePopup, "money");

  const draw = (logs, settings, schedule) => {
    const parts = [streakCard(logs), savedBar(settings, schedule), h("div", { style: { height: "16px" } }), addButton()];
    if (!logs.length) {
      parts.push(h("div", { style: { height: "16px" } }), px("div", "card state-card", [
        bigIcon("coin"),
        h("h3", { class: "f-head" }, "No savings logged yet"),
        h("p", { style: { margin: 0 } }, "Even ", money(1000), " counts. Start your streak!"),
      ]));
    } else {
      parts.push(h("div", { class: "section-title" }, "History"),
        ...logs.map((l) => px("div", "saving-row", [
          px("div", "coin st1", [icon("target")]),
          h("div", { style: { flex: 1 } }, h("div", { class: "amt" }, `+${naira(l.amount)}`),
            h("div", { class: "meta" }, `${fmtDay(l.saved_on)} · ${l.source === "payday" ? "Payday ✓" : "Saved"}`)),
          h("button", { class: "mini-btn press", type: "button", "aria-label": "Delete this entry", onclick: async () => {
            const yes = await confirmBox({ icon: "trash", title: "Delete this entry?",
              text: `+${naira(l.amount)} on ${fmtDay(l.saved_on)} comes out of your total. Your streak can change.`, yes: "Yes, delete it" });
            if (!yes) return;
            try { await api("DELETE", `/savings/${l.id}`); store.settings = null; load(); }
            catch (e) { haptic("error"); body.prepend(banner("error", e.detail)); }
          } }, icon("trash", "sm")),
        ])),
        h("p", { class: "list-note" }, "Deleting an entry takes that money back out of your total."));
    }
    body.replaceChildren(...parts);
  };

  // "Nice! How much? 💰"
  const savePopup = () => {
    const amount = field({ label: "Amount (₦)", prefix: "₦", placeholder: "e.g. 20,000" });
    const get = moneyInput(amount);
    const date = field({ label: "Date", type: "date", value: iso(today()), inputAttrs: { max: iso(today()) } });
    const err = h("div");
    const hint = streak
      ? `Saving this week keeps your ${streak}-week streak alive 🔥`
      : "Saving this week starts your streak 🔥";
    modal((close) => [
      h("h2", {}, "Nice! How much? 💰"), err, amount.el, date.el,
      h("p", { class: "lead" }, hint),
      button("Save", async (e) => {
        if (get() <= 0) { amount.error("Enter an amount above ₦0"); haptic("error"); return; }
        e.currentTarget.classList.add("loading");
        try {
          const res = await api("POST", "/savings", { amount: get(), saved_on: date.input.value || null });
          haptic("success");
          close(true);
          store.settings = null;
          await load();
          if (res.new_badges?.length) showBadges(res.new_badges);
        } catch (x) { e.currentTarget.classList.remove("loading"); haptic("error"); err.replaceChildren(banner("error", x.offline ? "You’re offline. Try again." : x.detail)); }
      }, "money"),
      button("Cancel", () => close(null)),
    ], { accent: "savings" });
  };

  load();
  return { accent: "savings", tab: "savings", header: { wordmark: true, title: "Savings", sub: "" }, el: body };
}
