# ---------------------------------------------------------
# prices.py: the "thinking" part of the price log. Pure Python,
# like timeline.py: no database, no FastAPI. main.py hands in
# plain numbers and dates; this file gives back answers.
# ---------------------------------------------------------
from datetime import date


# buy_or_hold: should you buy NOW, or HOLD (wait)?
# Rule: if the newest price is the LOWEST you've ever seen (or equal to it),
#       buy now. Otherwise you've seen it cheaper before, so hold.
# Input:  item_price = the price saved on the item when you added it (your starting point)
#         checks     = the prices you logged as (price, source) pairs, OLDEST first,
#                      e.g. [(45000, "Jumia"), (42000, "Jiji")]
# Output: two things: the verdict ("BUY NOW" / "HOLD" / "NO DATA") and a short reason.
def buy_or_hold(item_price, checks):
    if len(checks) == 0:                       # nothing logged yet: nothing to compare
        return "NO DATA", "Not enough prices yet to judge."

    newest = checks[-1][0]                     # [-1] = the LAST one = the newest; [0] = its price
    # Everything BEFORE the newest ([:-1] = all except the last), plus your planned price (no shop).
    earlier = [(item_price, None)] + checks[:-1]
    lowest_price, lowest_source = min(earlier, key=lambda c: c[0])   # the cheapest pair, by price

    # f"...{x:,}" puts commas in big numbers: 39000 → 39,000
    if newest <= lowest_price:
        return "BUY NOW", f"₦{newest:,} is the lowest price you've seen (before: ₦{lowest_price:,}). Grab it."
    where = f" on {lowest_source}" if lowest_source else ""
    return "HOLD", f"₦{newest:,} is more than the lowest you've seen (₦{lowest_price:,}{where})."


# estimate_monthly_pct: work out how fast the price is REALLY changing per month,
# from your own logs (no web scraper needed).
# It's the compound interest formula from timeline.py, run backwards:
#   last = first × (1 + rate) ** months   →   rate = (last / first) ** (1 / months) − 1
# Input:  first_price, first_day = the OLDEST log;  last_price, last_day = the NEWEST log
# Output: % per month (e.g. 3.2, or −1.5 if prices are falling), or None if the logs
#         are too close together to tell (under 30 days: one random discount would fool it).
def estimate_monthly_pct(first_price, first_day: date, last_price, last_day: date):
    days = (last_day - first_day).days        # how many days between the two logs
    if days < 30:
        return None                           # not enough time passed to trust it
    months = days / 30.44                     # 30.44 = average days in a month
    rate = (last_price / first_price) ** (1 / months) - 1
    return round(rate * 100, 2)               # 0.032 → 3.2 (%), 2 decimal places
