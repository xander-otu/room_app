// ---------------------------------------------------------
// timeline.js: 06 Timeline. Design PDF Sections 11, 17, 20.
// ---------------------------------------------------------
import { h, px, bigIcon, button, iconButton, api, store, naira, money, errorCard, skeleton, fmtMonthYear } from "../lib.js";
import { icon } from "../icons.js";
import { go } from "../app.js";
import { nextItemBar } from "./progress.js";
import { moneyPopup } from "./popups.js";
import { monthDate } from "./detail.js";

export function timelineScreen(ctx) {
  const body = h("div");

  const load = async () => {
    body.replaceChildren(skeleton(2, 4));
    try {
      const [plan, progress, settings, schedule, items] = await Promise.all([
        api("GET", "/timeline"), api("GET", "/progress"), store.loadSettings(true),
        store.loadSchedule(true).catch(() => null), store.loadItems(true)]);
      draw(plan, progress, settings, schedule, items);
    } catch (e) { body.replaceChildren(errorCard(e, load)); }
  };

  const moneyCard = (settings, schedule) => {
    const perMonth = schedule?.frequency ? schedule.average_monthly : settings.monthly_savings;
    return px("div", "money-card flat", [
      h("div", { class: "col" }, h("div", { class: "lbl" }, "Saved so far"), h("div", { class: "amt" }, naira(settings.saved_so_far))),
      h("div", { class: "col" }, h("div", { class: "lbl" }, "You save each month"), h("div", { class: "amt" }, naira(perMonth))),
      iconButton("pencil", async () => { if (await moneyPopup()) load(); }, "Edit your money"),
    ]);
  };

  const draw = (plan, progress, settings, schedule, items) => {
    const photos = Object.fromEntries(items.map((i) => [i.id, i.photo_url]));
    const bought = items.filter((i) => i.status === "bought");
    if (!plan.length) {
      body.replaceChildren(
        moneyCard(settings, schedule),
        h("div", { style: { height: "16px" } }),
        px("div", "card state-card", [
          bigIcon("calendar"),
          h("h3", { class: "f-head" }, "Your plan shows up here"),
          h("p", {}, "Add items and your savings to see when you can afford each thing."),
          button("Add an item", () => go("/items/new"), "primary"),
        ]),
        boughtNote(bought));
      return;
    }

    const now = plan.filter((s) => s.Month === 0);
    const later = plan.filter((s) => s.Month !== 0);
    const stops = [];
    stops.push(h("div", { class: "stop now" }, px("span", "pdot", []), px("div", "card", [
      h("div", { class: "top" }, px("span", "chip flat", ["NOW"]), h("span", { class: "when" }, "Today")),
      now.length
        ? h("div", {}, h("p", { class: "pixel-text" }, money(settings.saved_so_far), " saved. You can buy these now:"),
            ...now.map((s) => h("div", { class: "line", style: { marginTop: "6px" } }, h("span", { class: "nm" }, s.Item), h("span", { class: "pr money" }, naira(s.Price)))))
        : h("p", { class: "pixel-text" }, money(settings.saved_so_far), " saved. Nothing ready yet, keep going!"),
    ])));
    for (const s of later) {
      const photo = photos[s.item_id];
      if (s.Month === "never") {
        const c = px("div", "card red", [
          h("div", { class: "top" }, px("span", "chip flat wanted fixed", ["NEVER"])),
          h("div", { class: "line" }, h("span", { class: "nm" }, s.Item), h("span", { class: "pr money" }, `${naira(s["Original Price"])} now`)),
          h("div", { style: { display: "flex", gap: "8px", marginTop: "8px", color: "var(--danger)" } }, icon("alert", "sm"),
            h("span", { class: "pixel-text sm", style: { color: "var(--text)" } }, "This price rises faster than you save. Buy it earlier (raise its priority), save more each month, or pick a cheaper one.")),
        ], { role: "button", tabindex: "0" });
        c.classList.add("press");
        c.addEventListener("click", () => go(`/items/${s.item_id}`));
        stops.push(h("div", { class: "stop never" }, px("span", "pdot", []), c));
        continue;
      }
      const rose = s.Price !== s["Original Price"];
      const c = px("div", "card soft press", [
        store.settings?.list_density === "comfortable" ? h("div", { class: "thumb photo" }, photo ? h("img", { src: photo, alt: "" }) : icon("photo", "lg")) : null,
        h("div", { class: "top" }, px("span", "chip flat on", [`MONTH ${s.Month}`]), h("span", { class: "when" }, `≈ ${fmtMonthYear(monthDate(s.Month, schedule))}`)),
        h("div", { class: "line" }, h("span", { class: "nm" }, s.Item), h("span", { class: "pr money" }, naira(s.Price))),
        rose ? h("div", { class: "small was" }, "Was ", money(s["Original Price"]), ` · prices rise ${+s.Pct}%/month`) : null,
        h("div", { class: "small spent" }, "Total spent by then: ", money(s["Running Total"])),
      ], { role: "button", tabindex: "0" });
      c.addEventListener("click", () => go(`/items/${s.item_id}`));
      stops.push(h("div", { class: "stop" }, px("span", "pdot", []), c));
    }

    body.replaceChildren(
      nextItemBar(progress.next_item),
      moneyCard(settings, schedule),
      h("div", { class: "section-title" }, "Your buying plan"),
      h("div", { class: "plan" }, ...stops),
      boughtNote(bought));
  };

  const boughtNote = (bought) => {
    if (!bought.length) return null;
    const names = bought.slice(0, 3).map((i) => i.name).join(", ") + (bought.length > 3 ? "…" : "");
    return h("p", { class: "list-note" }, `${bought.length} bought ${bought.length === 1 ? "item isn't" : "items aren't"} shown (${names}). ${bought.length === 1 ? "It's" : "They're"} done!`);
  };

  load();
  return { accent: "timeline", tab: "timeline", header: { wordmark: true, title: "Timeline", sub: "When can I afford it?" }, el: body };
}
