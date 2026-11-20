# ---------------------------------------------------------
# progress.py: streaks and badges. Pure Python, like
# timeline.py and prices.py: main.py hands in plain
# numbers and dates, this file gives back answers.
# ---------------------------------------------------------
from datetime import date, timedelta


# week_start: the Monday of the week a day is in.
# Every day in the same week gives the SAME Monday, so it works as a "week label".
# e.g. Wed 19 Nov 2026 → Mon 17 Nov 2026.   .weekday(): Monday = 0, Tuesday = 1 ... Sunday = 6
def week_start(day: date) -> date:
    return day - timedelta(days=day.weekday())     # go back that many days to reach Monday


# savings_streak: how many weeks IN A ROW you saved at least once.
# Input:  save_days = the days you saved (any order, repeats are fine)
#         today     = today's date (passed in, so tests can pretend it's any day)
# Rule: count back week by week. If you haven't saved YET this week, the streak
#       isn't broken (the week isn't over), so start counting from last week.
def savings_streak(save_days, today: date) -> int:
    weeks_saved = {week_start(d) for d in save_days}   # a SET of Mondays: duplicates vanish automatically

    week = week_start(today)                           # this week's Monday
    if week not in weeks_saved:
        week = week - timedelta(weeks=1)               # nothing yet this week → start from last week

    streak = 0
    while week in weeks_saved:                         # keep stepping back while each week has a save
        streak += 1
        week = week - timedelta(weeks=1)
    return streak


# BADGES: every badge, and what it takes to earn it. One place to add new ones.
# Each one: (name, description, what to check, how many needed)
BADGES = [
    ("First Naira",   "Log your first savings",           "saves",  1),
    ("On a Roll",     "Save 4 weeks in a row",            "streak", 4),
    ("Price Watcher", "Log 5 prices you've seen",         "checks", 5),
    ("First Buy",     "Buy your first item",              "bought", 1),
    ("Room Builder",  "Buy 5 items",                      "bought", 5),
]


# badges: which badges you've earned.
# Input: your numbers so far, e.g. {"saves": 3, "streak": 2, "checks": 0, "bought": 1}
# Output: a list of {"name", "description", "earned": True/False}
def badges(stats):
    result = []
    for name, description, stat, needed in BADGES:   # unpack each badge's 4 parts into 4 names
        result.append({
            "name": name,
            "description": description,
            "earned": stats[stat] >= needed,         # True once your number reaches what's needed
        })
    return result
