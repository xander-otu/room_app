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
# Each one: (key, name, description, what to check, how many needed, show "3/5"?)
# The descriptions are the exact words on the Progress screen.
BADGES = [
    ("first_naira",    "First Naira",    "Log your first savings",           "saves",          1,  False),
    ("on_a_roll",      "On a Roll",      "Save 4 weeks in a row",            "streak",         4,  False),
    ("first_buy",      "First Buy",      "Buy your first item",              "bought",         1,  False),
    ("halfway_there",  "Halfway There",  "Reach 50% of your room",           "room_percent",  50,  False),
    ("price_watcher",  "Price Watcher",  "Log 5 prices you've seen",         "checks",         5,  True),
    ("room_builder",   "Room Builder",   "Buy 5 items",                      "bought",         5,  True),
    ("payday_pro",     "Payday Pro",     "Answer 3 payday check-ins",        "payday_answers", 3,  True),
    ("streak_master",  "Streak Master",  "Save 12 weeks in a row",           "streak",        12,  True),
    ("bargain_hunter", "Bargain Hunter", "Buy something below its price",    "bargains",       1,  False),
    ("snapshot",       "Snapshot",       "Add photos to 3 items",            "photos",         3,  True),
    ("comeback",       "Comeback",       "Start saving again after a break", "comeback",       1,  False),
    ("room_planner",   "Room Planner",   "Import a room from ChatGPT",       "room_imported",  1,  False),
]


# came_back: True if you ever saved in a week right after a week with NO saving,
# having saved at some point before that (your streak restarted). That's "Comeback".
def came_back(save_days) -> bool:
    weeks = sorted({week_start(d) for d in save_days})   # every week you saved, oldest first
    for earlier, later in zip(weeks, weeks[1:]):          # zip pairs each week with the next one
        if later - earlier > timedelta(weeks=1):          # a gap of at least one empty week
            return True
    return False


# percent: "how full is the bar?" as a whole number from 0 to 100.
# e.g. 25,000 of 40,000 → 62.  Never above 100, and 0 if there's nothing to fill.
def percent(part, whole) -> int:
    if whole <= 0:
        return 0
    return min(100, int(part / whole * 100))   # min(100, ...) = cap it at a full bar


# badges: which badges your numbers have reached RIGHT NOW.
# Input: your numbers so far, e.g. {"saves": 3, "streak": 2, "checks": 0, "bought": 1, ...}
# Output: a list of {"key", "name", "description", "reached", "progress", "goal", "show_progress"}
# (main.py remembers earned badges in the database, so they're never taken away.)
def badges(stats):
    result = []
    for key, name, description, stat, needed, show in BADGES:   # unpack each badge's 6 parts
        result.append({
            "key": key,
            "name": name,
            "description": description,
            "reached": stats[stat] >= needed,        # True once your number reaches what's needed
            "progress": min(stats[stat], needed),    # e.g. 3 (of 5), never more than the goal
            "goal": needed,
            "show_progress": show,                   # only some badges show "3/5"
        })
    return result
