# ---------------------------------------------------------
# timeline.py: the "thinking" part of RoomFund. Pure Python:
# no database, no FastAPI. main.py fetches the items and
# hands them in; this file works out the buying order
# and WHEN each item can be bought.
# ---------------------------------------------------------
import math                                # (not used yet)
from decimal import Decimal, ROUND_HALF_UP # Decimal: exact maths for rounding to the nearest naira

# arrange_items: put items in BUYING ORDER.
# Rule: high priority first, then medium, then low.
#       Inside the same priority, cheapest first.
# Input:  all_items = a list of item dictionaries (name, price, priority...)
# Output: one new list of the same items, in buying order.
def arrange_items(all_items):
    # Step 1: three empty "baskets", made fresh on every call
    # (so calling the function twice never mixes old items in).
    high_unsorted=[]
    medium_unsorted=[]
    low_unsorted=[]

    # Drop each item into the basket that matches its priority.
    for item in all_items:
        if item["priority"] == "high":         # == asks "are these equal?"
            high_unsorted.append(item)
        elif item["priority"] == "medium":
            medium_unsorted.append(item)
        else:                                  # only "low" is left (Pydantic's Literal guarantees it)
            low_unsorted.append(item)

    # by_price: the "measuring tape" for sorted(). Give it one item, get its price.
    # It does NOT do the ordering; sorted() does. This only says WHAT to compare.
    def by_price(item):
        return item["price"]

    # Step 2: sort each basket by price, cheapest first.
    # sorted() hands back a NEW list, so we store each result.
    # key=by_price has no brackets: we hand over the function, sorted() runs it on each item.
    high = sorted(high_unsorted, key=by_price)
    medium = sorted(medium_unsorted, key=by_price)
    low = sorted(low_unsorted, key=by_price)

    # Step 3: join the baskets end to end: high first, then medium, then low.
    full_list = high + medium + low
    return full_list

# calculate_new_price: what an item will cost after some months of price rises.
# It's the COMPOUND INTEREST formula: each month's % is taken from the new, bigger price.
# e.g. 40,000 at 10% for 2 months: 40,000 × 1.1 × 1.1 = 48,400
# Always give it the ORIGINAL price, never an already-grown one (or it grows twice).
def calculate_new_price(current_price, monthly_increase_percent, months):
    rate = monthly_increase_percent / 100                  # 10 (%) → 0.10
    raw_price = current_price * ((1 + rate) ** months)     # ** = "to the power of": grow `months` times in one go
    # round to the nearest whole naira (.5 goes up) and turn it into an int
    return int(Decimal(str(raw_price)).quantize(Decimal('1'), rounding=ROUND_HALF_UP))

# buy_timeline: walk down the items in buying order and work out, for each,
# the MONTH you can buy it, the way you'd do it with real money:
#   - the money in your pocket grows every month
#   - the item's price ALSO grows every month (inflation), until you buy it
#   - when you buy, the money LEAVES your pocket; the next item starts from what's left
# Input:  all_items = items in ANY order (it sorts them itself)
#         income_available = money the user has saved right now (e.g. 100000)
#         monthly_income   = money the user adds every month (e.g. 50000)
#         (later, main.py will get these two from the settings table)
# Output: a list of small dictionaries, one per item: name, running total, month.
def buy_timeline(all_items, income_available, monthly_income):
    running_total = 0              # the "till" starts at zero
    running_total_list = []        # collects one result dictionary per item
    full_list = arrange_items(all_items)   # call our own sorter first, so the order handed in never matters
    money_i_have = income_available    # a COPY of what the user typed; it grows and shrinks
    month = 0                          # month 0 = today
    for item in full_list:
        item_price = int(item["price"])    # today's price, from the item
        running_total += item["price"]     # += means: running_total = running_total + price (today's prices, no inflation)
        name = item["name"]                # pull this item's name out of its dictionary
        percent = int(item["monthly_price_increase_pct"])   # how fast this item's price rises each month
        duplicate_price = item_price       # the ORIGINAL price, kept safe: the formula always starts from this
        # CATCH-UP: prices don't wait for you. If months already passed while saving for
        # earlier items, this item's price has been rising too, so grow it to "now".
        new_price = calculate_new_price(duplicate_price, percent, month)
        # Keep going WHILE the money is NOT enough yet for this item.
        # Each round = one more month: savings come in, a month passes, the price rises again.
        # month is NOT reset per item: the next item carries on from here.
        # (If there's already enough, the while is skipped and the item is bought this month.)
        while new_price > money_i_have:
            money_i_have += monthly_income   # the money grows by one month of savings
            month += 1                       # one more month has passed
            new_price = calculate_new_price(duplicate_price, percent, month)   # the price at THIS month

        # BUY IT: the money leaves your pocket (the price as it is NOW, not the old one)
        money_i_have = money_i_have - new_price
        # One "row" of the answer: labels are fixed text, values are variables
        family = {"Item" : name, "Running Total" : running_total, "Month": month}
        running_total_list.append(family)  # add this row to the results
        month_count = 0                    # (left over from an earlier idea; not used anymore)
    return running_total_list          # just the list of rows (each row already has its month)
