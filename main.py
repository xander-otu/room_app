# ---------------------------------------------------------
# main.py: the FastAPI app. Holds the Pydantic models
# (shapes of data going in/out) and the routes (the "doors").
# ---------------------------------------------------------

# --- Imports ---
from typing import Literal                            # Literal: allow ONLY specific exact values
from fastapi import FastAPI, Depends, HTTPException   # FastAPI: the app; Depends: ask for a helper (get_db); HTTPException: send errors like 404
from pydantic import BaseModel, Field                 # BaseModel: parent of Pydantic models; Field: adds rules (gt=0, ge=0)
from sqlalchemy.orm import Session                    # the type of `db`, so VS Code knows what it is
from database import get_db                           # the gatekeeper: hands each request its own session
from models import Item, Settings, PriceCheck, SavingsLog   # the database table classes
from sqlalchemy import select, delete                 # select: "fetch rows" query; delete: "remove rows" query
from timeline import arrange_items, buy_timeline
from prices import buy_or_hold, estimate_monthly_pct  # the price-log "thinking" (prices.py)
from datetime import date                             # date: a calendar day (for price checks)
from progress import savings_streak, badges           # streaks + badges "thinking" (progress.py)

# Create the app. Every route below is attached to this object.
app = FastAPI()


# --- Pydantic models: the shapes of data going IN and OUT ---

# ItemCreate: the "order form" a visitor sends to add an item.
# Pydantic checks it at the door; bad input gets a 422 before our code runs.
class ItemCreate(BaseModel):
    name: str                                                        # required text
    width_cm: int | None = None                                      # optional; None = "not given"
    depth_cm: int | None = None                                      # optional
    height_cm: int | None = None                                     # optional
    price: int = Field(gt=0)                                         # whole naira, must be above 0
    priority: Literal["high", "medium", "low"]                       # only these three words allowed
    monthly_price_increase_pct: float = Field(default=0.0, ge=0)     # 0 or more; defaults to 0


# ItemOut: the "delivery note" we send back.
# Inherits every ItemCreate field, plus id and status (filled in by the database).
class ItemOut(ItemCreate):
    id: int
    status: str

    model_config = {"from_attributes": True}   # lets Pydantic read a SQLAlchemy object (item.name) instead of a dict

# ItemUpdate: the "change form". Every field optional: send only what changed.
class ItemUpdate(BaseModel):
    name: str | None = None
    price: int | None = Field(default=None, gt=0)
    priority: Literal["high", "medium", "low"] | None = None
    status: Literal["wanted", "saving", "bought"] | None = None   # status CAN change here
    width_cm: int | None = None
    depth_cm: int | None = None
    height_cm: int | None = None
    monthly_price_increase_pct: float | None = Field(default=None, ge=0)

# SettingsOut: the savings numbers we send back.
class SettingsOut(BaseModel):
    saved_so_far: int
    monthly_savings: int

    model_config = {"from_attributes": True}   # lets Pydantic read a SQLAlchemy object (settings.saved_so_far) instead of a dict

# SettingsUpdate: the change form for savings. Both optional; ge=0 = no negative naira.
class SettingsUpdate(BaseModel):
    saved_so_far: int | None = Field(default=None, ge=0)
    monthly_savings: int | None = Field(default=None, ge=0)


# PriceCheckCreate: the form for logging a price you saw.
# checked_on is optional: leave it out and it means "today".
class PriceCheckCreate(BaseModel):
    price: int = Field(gt=0)                 # whole naira, above 0
    source: str                              # "Jumia", "Jiji", "market"...
    link: str | None = None                  # optional web link
    checked_on: date | None = None           # e.g. "2026-11-20"; None → today

# PriceCheckOut: one logged price, as we send it back.
class PriceCheckOut(BaseModel):
    id: int
    item_id: int
    price: int
    checked_on: date
    source: str
    link: str | None

    model_config = {"from_attributes": True}   # can read a database row directly

# PriceReport: everything about one item's prices, plus the verdict.
class PriceReport(BaseModel):
    item_id: int
    item_name: str
    item_price: int                          # the price saved on the item (the starting point)
    checks: list[PriceCheckOut]              # every price logged, oldest first
    verdict: str                             # "BUY NOW" / "HOLD" / "NO DATA"
    reason: str                              # one plain sentence explaining the verdict
    estimated_monthly_pct: float | None      # how fast the price really moves (None = not enough data yet)


# SavingsCreate: the form for "I saved some money". saved_on optional → today.
class SavingsCreate(BaseModel):
    amount: int = Field(gt=0)                # whole naira, above 0
    saved_on: date | None = None

# SavingsOut: one savings log, as we send it back.
class SavingsOut(BaseModel):
    id: int
    amount: int
    saved_on: date

    model_config = {"from_attributes": True}

# BuyForm: marking an item as bought. price_paid optional → the item's saved price.
class BuyForm(BaseModel):
    price_paid: int | None = Field(default=None, gt=0)

# Badge + ProgressOut: your streak, totals and badges.
class Badge(BaseModel):
    name: str
    description: str
    earned: bool

class ProgressOut(BaseModel):
    streak_weeks: int            # weeks in a row with at least one save
    total_saved_logged: int      # all the money in your savings log added up
    items_bought: int
    badges: list[Badge]


# --- Helpers (NOT routes: no @app above them, so FastAPI never calls them) ---

# get_settings: "get or create" the single settings row.
# Both settings routes call this, so the logic lives in ONE place.
# Takes db as a plain input (no Depends): the route already has a session and passes it in.
# -> Settings is a label: "this function hands back a Settings object".
def get_settings(db: Session) -> Settings:
    settings = db.get(Settings, 1)  # look in locker 1 (there's only ever one settings row)
    if settings is None:            # first time ever: no row yet (NOT an error, so no 404)
        settings = Settings(id=1)   # make a blank row; 0 and 0 come from the defaults in models.py
        db.add(settings)            # new object → needs add()
        db.commit()                 # save it
        db.refresh(settings)        # re-read so the 0s are filled in
    return settings                 # outside the if: runs every time, old row or new one

# get_items: find ONE item by id, or stop with a 404.
# Used by GET one, PUT and DELETE, so the "find + 404" lines live in ONE place.
# The raise doesn't just stop this helper: it stops the ROUTE that called it too,
# and FastAPI turns it into the 404 reply. So routes don't need their own check.
def get_items(item_id: int, db: Session) -> Item:
    item = db.get(Item, item_id)    # find it in its "locker"
    if item is None:                # missing → 404
        raise HTTPException(status_code=404, detail="Item not found")
    return item                     # only reached when the item exists


# get_all_items: fetch EVERY item from the database, as a list.
# Kept in a helper so any route (GET /items, /timeline...) can reuse it.
def get_all_items(db: Session) -> list[Item]:
    # select(Item) = "SELECT * FROM items"; .scalars() unwraps rows into Item objects; .all() collects them in a list
    items = db.execute(select(Item)).scalars().all()
    return items                                       # a list of Item objects (rows)


# --- Routes ---

# Health check: visit / to confirm the server is alive.
@app.get("/")
def greeting():
    return {"message": "Welcome to the Room Fund API!"}


# Add a new item. 201 = "Created", the standard reply when something new is made.
@app.post("/items", response_model=ItemOut, status_code=201)
def create_item(item_in: ItemCreate, db: Session = Depends(get_db)):
    # Build a database row (an Item object) from the checked form.
    # model_dump() turns the form into a dict: {"name": "Rug", "price": 40000, ...}
    # ** unpacks that dict into named arguments: Item(name="Rug", price=40000, ...)
    # Works because the form's field names match the table's column names exactly.
    db_item = Item(**item_in.model_dump())
    db.add(db_item)        # put it in the cart (not saved yet)
    db.commit()            # pay at the counter: now it's saved in roomfund.db
    db.refresh(db_item)    # re-read the row so db_item gets its new id and status
    return db_item         # response_model=ItemOut turns the object into JSON

# List every item. list[ItemOut] = "send back a list of delivery notes".
@app.get("/items", response_model=list[ItemOut])
def display_items(db: Session = Depends(get_db)):
    items = get_all_items(db)   # the helper fetches every item; the route just passes its db in
    return items


# Get ONE item by its id (taken from the address, e.g. /items/3).
@app.get("/items/{item_id}", response_model=ItemOut)
def display_item(item_id: int, db: Session = Depends(get_db)):
    item = get_items(item_id, db)   # the helper finds it or stops with a 404
    return item

# Update an item. Send ONLY what changed, e.g. {"price": 230000}.
@app.put("/items/{item_id}", response_model=ItemOut)
def edit_item(item_id: int, item_in: ItemUpdate, db: Session = Depends(get_db)):
    item = get_items(item_id, db)

    # exclude_unset=True: keep ONLY the fields the visitor actually sent,
    # so the fields they left out aren't wiped to None.
    changes = item_in.model_dump(exclude_unset=True)   # e.g. {"price": 230000}

    # Take each (label, value) pair and write it into the matching box.
    # setattr(item, "price", 230000) is the same as item.price = 230000,
    # but works when the box name is stored in a variable.
    for field, value in changes.items():
        setattr(item, field, value)

    db.commit()            # save. No db.add(): the session is already watching this item
    db.refresh(item)       # re-read so we return exactly what's saved
    return item


# Delete an item. 204 = "done, nothing to send back".
@app.delete("/items/{item_id}", status_code=204)
def delete_item(item_id: int, db: Session = Depends(get_db)):
    item = get_items(item_id, db)
    # First remove this item's price checks, so no "orphan" prices are left pointing at nothing.
    db.execute(delete(PriceCheck).where(PriceCheck.item_id == item.id))
    db.delete(item)                 # put "remove this" in the cart
    db.commit()                    # pay: now it's gone from roomfund.db
                                    # no return: a 204 sends an empty reply

# See your savings numbers. No id in the address: there's only one settings row.
@app.get("/settings", response_model=SettingsOut)
def get_settings_route(db: Session = Depends(get_db)):
    current_setting = get_settings(db)   # the helper finds the row (or makes it with 0, 0)
    return current_setting               # whatever the row holds RIGHT NOW


# Change your savings numbers. Send only what changed, e.g. {"monthly_savings": 60000}.
@app.put("/settings", response_model=SettingsOut)
def update_settings(settings_in: SettingsUpdate, db: Session = Depends(get_db)):
    settings = get_settings(db)          # no 404 check needed: the helper always returns a row
    changes = settings_in.model_dump(exclude_unset=True)   # only the fields actually sent
    for field, element in changes.items():
        setattr(settings, field, element)                  # settings.<field> = element
    db.commit()                          # save (no add(): the session already watches this row)
    db.refresh(settings)                 # re-read so we return exactly what's saved
    return settings

# Timeline: WHEN can the user afford each item?
# The route is the "delivery guy": fetch what buy_timeline needs, hand it over, send the answer back.
@app.get("/timeline")
def sort_items(db: Session = Depends(get_db)):
    # Step 1: the ITEMS. The database gives rows (they use dots),
    # but timeline.py wants dictionaries (they use ["..."]), so we convert each one.
    all_items_unchanged = get_all_items(db)   # a list of database rows
    all_items = []                            # will collect the dictionaries
    for item in all_items_unchanged:          # one row at a time (these tools only take ONE)
        if item.status == "bought":           # already bought → nothing left to plan for it
            continue                          # continue = skip to the next item
        all_items_pydantic = ItemOut.model_validate(item)   # row → Pydantic (works thanks to from_attributes)
        one_item = all_items_pydantic.model_dump()          # Pydantic → dictionary
        all_items.append(one_item)

    # Step 2: the SETTINGS. Only one row, so no loop. Same two steps: row → Pydantic → dictionary.
    settings_unchanged = get_settings(db)
    settings_pydantic = SettingsOut.model_validate(settings_unchanged)
    settings = settings_pydantic.model_dump()

    # It's a dictionary now, so we read it with square brackets.
    income_available = settings["saved_so_far"]     # money saved right now
    monthly_income = settings["monthly_savings"]    # money added every month

    # Step 3: hand everything to timeline.py, which sorts and works out the months.
    sorted_items = buy_timeline(all_items, income_available, monthly_income)

    # Step 4: send the answer to the user (NOT saved in the database; we only read).
    return sorted_items


# --- Price log (Phase 5) ---

# Log a price you saw for an item, e.g. POST /items/3/prices with {"price": 39000, "source": "Jiji"}.
@app.post("/items/{item_id}/prices", response_model=PriceCheckOut, status_code=201)
def log_price(item_id: int, check_in: PriceCheckCreate, db: Session = Depends(get_db)):
    get_items(item_id, db)                          # 404 if the item doesn't exist (we don't need the item itself)
    data = check_in.model_dump()                    # form → dictionary
    if data["checked_on"] is None:                  # no date given → today
        data["checked_on"] = date.today()
    check = PriceCheck(item_id=item_id, **data)     # dictionary → database row (+ which item it belongs to)
    db.add(check)
    db.commit()
    db.refresh(check)                               # get its new id
    return check


# See an item's price history + BUY NOW / HOLD.
@app.get("/items/{item_id}/prices", response_model=PriceReport)
def price_report(item_id: int, db: Session = Depends(get_db)):
    item = get_items(item_id, db)                   # 404 if missing
    # Fetch ONLY this item's checks, oldest day first (id breaks ties on the same day).
    query = (select(PriceCheck)
             .where(PriceCheck.item_id == item_id)
             .order_by(PriceCheck.checked_on, PriceCheck.id))
    checks = db.execute(query).scalars().all()

    prices = [c.price for c in checks]              # just the numbers, oldest first: [45000, 42000, 39000]
    verdict, reason = buy_or_hold(item.price, prices)   # prices.py gives back TWO things; we catch both

    pct = None
    if len(checks) >= 2:                            # need a first AND a last to measure change
        pct = estimate_monthly_pct(checks[0].price, checks[0].checked_on,
                                   checks[-1].price, checks[-1].checked_on)

    return PriceReport(
        item_id=item.id,
        item_name=item.name,
        item_price=item.price,
        checks=checks,                              # Pydantic turns each row into a PriceCheckOut
        verdict=verdict,
        reason=reason,
        estimated_monthly_pct=pct,
    )


# Remove one wrong price log (typo, wrong item...). 204 = done, nothing to send back.
@app.delete("/prices/{check_id}", status_code=204)
def delete_price(check_id: int, db: Session = Depends(get_db)):
    check = db.get(PriceCheck, check_id)
    if check is None:
        raise HTTPException(status_code=404, detail="Price check not found")
    db.delete(check)
    db.commit()


# --- Savings, buying, streaks, badges (Phase 6) ---

# Log money you saved, e.g. {"amount": 10000}. It's ALSO added to your savings total.
@app.post("/savings", response_model=SavingsOut, status_code=201)
def log_savings(savings_in: SavingsCreate, db: Session = Depends(get_db)):
    data = savings_in.model_dump()
    if data["saved_on"] is None:
        data["saved_on"] = date.today()
    log = SavingsLog(**data)
    db.add(log)
    settings = get_settings(db)
    settings.saved_so_far += log.amount     # your pocket goes up
    db.commit()                             # ONE commit saves both changes together
    db.refresh(log)
    return log


# See every savings log, newest first.
@app.get("/savings", response_model=list[SavingsOut])
def list_savings(db: Session = Depends(get_db)):
    query = select(SavingsLog).order_by(SavingsLog.saved_on.desc(), SavingsLog.id.desc())   # .desc() = biggest/newest first
    return db.execute(query).scalars().all()


# Remove a wrong savings log. The amount comes back OUT of your total (never below 0).
@app.delete("/savings/{log_id}", status_code=204)
def delete_savings(log_id: int, db: Session = Depends(get_db)):
    log = db.get(SavingsLog, log_id)
    if log is None:
        raise HTTPException(status_code=404, detail="Savings log not found")
    settings = get_settings(db)
    settings.saved_so_far = max(0, settings.saved_so_far - log.amount)   # max(0, ...) = no negative naira
    db.delete(log)
    db.commit()


# Mark an item as BOUGHT. The money leaves your savings, and it drops off the timeline.
# Send {} to use the item's price, or {"price_paid": 38000} if you paid something else.
@app.post("/items/{item_id}/buy", response_model=ItemOut)
def buy_item(item_id: int, buy_in: BuyForm, db: Session = Depends(get_db)):
    item = get_items(item_id, db)
    if item.status == "bought":
        raise HTTPException(status_code=400, detail="Item is already bought")   # 400 = "bad request"
    price_paid = buy_in.price_paid or item.price       # `or`: use price_paid if given, else item.price
    settings = get_settings(db)
    if price_paid > settings.saved_so_far:
        raise HTTPException(status_code=400,
                            detail=f"Not enough savings: you have ₦{settings.saved_so_far:,}, it costs ₦{price_paid:,}")
    settings.saved_so_far -= price_paid                # money leaves your pocket
    item.status = "bought"
    db.commit()
    db.refresh(item)
    return item


# Your streak, totals and badges, all in one place.
@app.get("/progress", response_model=ProgressOut)
def progress(db: Session = Depends(get_db)):
    logs = db.execute(select(SavingsLog)).scalars().all()
    items = get_all_items(db)
    checks = db.execute(select(PriceCheck)).scalars().all()

    streak = savings_streak([log.saved_on for log in logs], date.today())
    bought = len([i for i in items if i.status == "bought"])     # count only the bought ones

    stats = {"saves": len(logs), "streak": streak, "checks": len(checks), "bought": bought}
    return ProgressOut(
        streak_weeks=streak,
        total_saved_logged=sum(log.amount for log in logs),     # sum() adds up all the amounts
        items_bought=bought,
        badges=badges(stats),
    )