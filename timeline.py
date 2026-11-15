# ---------------------------------------------------------
# timeline.py: the "thinking" part of RoomFund. Pure Python:
# no database, no FastAPI. main.py fetches the items and
# hands them in; this file works out the buying order.
# ---------------------------------------------------------


# sort_items: put items in BUYING ORDER.
# Rule: high priority first, then medium, then low.
#       Inside the same priority, cheapest first.
# Input:  all_items = a list of item dictionaries (name, price, priority...)
# Output: one new list of the same items, in buying order.
def sort_items(all_items):
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

