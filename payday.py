# ---------------------------------------------------------
# payday.py: the "thinking" for paydays. Pure Python, like
# timeline.py: no database. main.py hands in dates and
# amounts; this file works out when money should arrive.
# ---------------------------------------------------------
import calendar
import math
from datetime import date, timedelta

AVG_DAYS_IN_MONTH = 30.44
FREQUENCIES = ("weekly", "biweekly", "monthly", "irregular")


# add_months: the same day N months later, e.g. 31 Jan + 1 month → 28/29 Feb
# (if the day doesn't exist in that month, use the month's last day).
def add_months(day: date, months: int) -> date:
    month_index = day.month - 1 + months
    year = day.year + month_index // 12
    month = month_index % 12 + 1
    last_day = calendar.monthrange(year, month)[1]   # how many days that month has
    return date(year, month, min(day.day, last_day))


# advance: the regular payday AFTER this one.
def advance(day: date, frequency: str) -> date:
    if frequency == "weekly":
        return day + timedelta(weeks=1)
    if frequency == "biweekly":
        return day + timedelta(weeks=2)
    return add_months(day, 1)                        # monthly


# per_month: roughly how much one payday amount adds up to in a month.
# weekly → 52 paydays a year ÷ 12 months; every 2 weeks → 26 ÷ 12; monthly → 1.
def per_month(frequency: str, amount: int) -> int:
    if frequency == "weekly":
        return round(amount * 52 / 12)
    if frequency == "biweekly":
        return round(amount * 26 / 12)
    return amount


# month_number: which timeline month a day falls in. Month 1 = the next ~30 days, and so on.
# A payday that's already due (today or earlier) counts in month 1.
def month_number(today: date, day: date) -> int:
    days = (day - today).days
    return max(1, math.ceil(days / AVG_DAYS_IN_MONTH))


# monthly_incomes: money expected in each timeline month, from REAL payday dates.
# Input:  first_dates = the next payday(s) we already know (e.g. a rescheduled one first),
#         then the regular schedule carries on from `next_regular` at `frequency`.
# Output: a list: [money in month 1, money in month 2, ...] for `months` months.
def monthly_incomes(today: date, first_dates, next_regular: date, frequency: str,
                    amount: int, months: int = 120) -> list[int]:
    incomes = [0] * months
    for d in first_dates:                            # one-off dates (e.g. a rescheduled payday)
        m = month_number(today, d)
        if m <= months:
            incomes[m - 1] += amount
    d = next_regular
    while d is not None and month_number(today, d) <= months:
        incomes[month_number(today, d) - 1] += amount
        d = advance(d, frequency)
    return incomes
