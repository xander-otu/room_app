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
from models import Item, Settings, PriceCheck, SavingsLog, User, Room   # the database table classes
from pydantic import ValidationError                  # the error Pydantic raises when data has the wrong shape
from fastapi.security import OAuth2PasswordRequestForm  # the standard login form (username + password)
from auth import hash_password, verify_password, create_token, get_current_user   # login tools (auth.py)
from sqlalchemy import select, delete                 # select: "fetch rows" query; delete: "remove rows" query
from timeline import arrange_items, buy_timeline
from prices import buy_or_hold, estimate_monthly_pct  # the price-log "thinking" (prices.py)
from datetime import date                             # date: a calendar day (for price checks)
from progress import savings_streak, badges, percent  # streaks, badges, progress bars (progress.py)

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
    show_room_tab: bool                      # is the optional "My Room" tab switched on?

    model_config = {"from_attributes": True}   # lets Pydantic read a SQLAlchemy object (settings.saved_so_far) instead of a dict

# SettingsUpdate: the change form for savings. Both optional; ge=0 = no negative naira.
class SettingsUpdate(BaseModel):
    saved_so_far: int | None = Field(default=None, ge=0)
    monthly_savings: int | None = Field(default=None, ge=0)
    show_room_tab: bool | None = None        # send true / false to show or hide the My Room tab


# --- Room import (the optional "My Room" tab) ---

# RoomInfo: the room itself, inside a room code.
class RoomInfo(BaseModel):
    name: str = "My room"
    width_cm: int | None = Field(default=None, gt=0)
    length_cm: int | None = Field(default=None, gt=0)

# RoomCode: the exact shape a Claude artifact copies with "Copy for RoomFund".
# {"roomfund": 1, "room": {...}, "items": [ {name, price, priority, ...}, ... ]}
# Each item uses ItemCreate, so it gets the SAME checks as adding an item by hand.
class RoomCode(BaseModel):
    roomfund: Literal[1]                     # the version number: proves it's a RoomFund room code
    room: RoomInfo
    items: list[ItemCreate] = []

# What you paste into the import box (the raw copied text).
class PasteForm(BaseModel):
    code: str

# One item in the preview: the item, plus "is this already in your list?"
class PreviewItem(ItemCreate):
    already_exists: bool

class ImportPreview(BaseModel):
    room: RoomInfo
    items: list[PreviewItem]

class RoomOut(BaseModel):
    name: str
    width_cm: int | None
    length_cm: int | None

    model_config = {"from_attributes": True}

class ImportResult(BaseModel):
    room: RoomOut
    items_added: int


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

# RoomBar: "how much of my room have I bought?" (by money, so a lamp doesn't count like a bed)
class RoomBar(BaseModel):
    percent: int                 # 0–100
    bought_value: int            # ₦ of the items you've bought (their listed prices)
    total_value: int             # ₦ of ALL your items

# NextItemBar: "how close am I to the next thing on my list?"
class NextItemBar(BaseModel):
    item_id: int
    name: str
    price: int                   # its price today
    saved: int                   # what you have now
    percent: int                 # 0–100 (100 = you can buy it now!)

class ProgressOut(BaseModel):
    streak_weeks: int            # weeks in a row with at least one save
    total_saved_logged: int      # all the money in your savings log added up
    items_bought: int
    room: RoomBar
    next_item: NextItemBar | None   # None = nothing left to buy 🎉
    badges: list[Badge]


# --- Accounts (Phase 6.5) ---

# SignupForm: what you send to make an account.
class SignupForm(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=8, max_length=72)   # 8+ characters; 72 = the most bcrypt can blend

# UserOut: an account as we send it back. NO password, not even the blended one.
class UserOut(BaseModel):
    id: int
    email: str

    model_config = {"from_attributes": True}

# Token: the wristband we hand out at login.
class Token(BaseModel):
    access_token: str
    token_type: str      # always "bearer" = "whoever carries this wristband"


# --- Helpers (NOT routes: no @app above them, so FastAPI never calls them) ---

# get_settings: "get or create" THIS USER's settings row.
# Takes db and user as plain inputs (no Depends): the route already has them and passes them in.
# -> Settings is a label: "this function hands back a Settings object".
def get_settings(db: Session, user: User) -> Settings:
    settings = db.execute(select(Settings).where(Settings.user_id == user.id)).scalar_one_or_none()
    # scalar_one_or_none(): "give me the one row, or None if there isn't one"
    if settings is None:                  # this user's first time: no row yet (NOT an error, so no 404)
        settings = Settings(user_id=user.id)   # blank row for THIS user; 0 and 0 come from the defaults
        db.add(settings)                  # new object → needs add()
        db.commit()                       # save it
        db.refresh(settings)              # re-read so the 0s are filled in
    return settings                       # outside the if: runs every time, old row or new one

# get_items: find ONE of THIS USER's items by id, or stop with a 404.
# Someone else's item ALSO gets a 404 (not "forbidden"), so strangers can't even
# tell that item number exists.
# The raise stops the ROUTE that called it too, and FastAPI turns it into the 404 reply.
def get_items(item_id: int, db: Session, user: User) -> Item:
    item = db.get(Item, item_id)                     # find it in its "locker"
    if item is None or item.user_id != user.id:      # missing, OR not yours → 404
        raise HTTPException(status_code=404, detail="Item not found")
    return item                                      # only reached when it exists AND it's yours


# get_all_items: fetch ALL of THIS USER's items, as a list.
# Kept in a helper so any route (GET /items, /timeline...) can reuse it.
def get_all_items(db: Session, user: User) -> list[Item]:
    # select(Item) = "SELECT * FROM items"; .where(...) = only rows owned by this user;
    # .scalars() unwraps rows into Item objects; .all() collects them in a list
    items = db.execute(select(Item).where(Item.user_id == user.id)).scalars().all()
    return items                                       # a list of Item objects (rows)


# room_bar: the 🏠 room progress bar (money of bought items ÷ money of all items).
# A helper because both /progress and /room show it.
def room_bar(items) -> "RoomBar":
    total_value = sum(i.price for i in items)
    bought_value = sum(i.price for i in items if i.status == "bought")
    return RoomBar(percent=percent(bought_value, total_value),
                   bought_value=bought_value, total_value=total_value)


# get_room: THIS USER's room, or None if they haven't imported one.
def get_room(db: Session, user: User) -> Room | None:
    return db.execute(select(Room).where(Room.user_id == user.id)).scalar_one_or_none()


# --- Routes ---

# Health check: visit / to confirm the server is alive. (Public: no login needed.)
@app.get("/")
def greeting():
    return {"message": "Welcome to the Room Fund API!"}


# Make an account. Public: you can't be logged in before you have an account.
@app.post("/signup", response_model=UserOut, status_code=201)
def signup(form: SignupForm, db: Session = Depends(get_db)):
    email = form.email.strip().lower()            # " Tunde@Mail.com " and "tunde@mail.com" = same person
    taken = db.execute(select(User).where(User.email == email)).scalar_one_or_none()
    if taken:
        raise HTTPException(status_code=400, detail="That email already has an account")
    user = User(email=email, hashed_password=hash_password(form.password))   # store the BLENDED password only
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


# Log in: swap your email + password for a wristband (token).
# OAuth2PasswordRequestForm is the standard login form: it calls the email "username".
# That's what makes the 🔒 Authorize button in /docs work.
@app.post("/login", response_model=Token)
def login(form: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    email = form.username.strip().lower()
    user = db.execute(select(User).where(User.email == email)).scalar_one_or_none()
    # Same message for "no such email" and "wrong password", so strangers can't
    # test which emails have accounts.
    if user is None or not verify_password(form.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Wrong email or password")
    return Token(access_token=create_token(user.id), token_type="bearer")


# Who am I? Shows the account your wristband belongs to.
@app.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)):
    return user


# Add a new item. 201 = "Created", the standard reply when something new is made.
@app.post("/items", response_model=ItemOut, status_code=201)
def create_item(item_in: ItemCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    # Build a database row (an Item object) from the checked form.
    # model_dump() turns the form into a dict: {"name": "Rug", "price": 40000, ...}
    # ** unpacks that dict into named arguments: Item(name="Rug", price=40000, ...)
    # Works because the form's field names match the table's column names exactly.
    # user_id=user.id stamps the owner on it: the logged-in person (from their wristband).
    db_item = Item(**item_in.model_dump(), user_id=user.id)
    db.add(db_item)        # put it in the cart (not saved yet)
    db.commit()            # pay at the counter: now it's saved in roomfund.db
    db.refresh(db_item)    # re-read the row so db_item gets its new id and status
    return db_item         # response_model=ItemOut turns the object into JSON

# List every item. list[ItemOut] = "send back a list of delivery notes".
@app.get("/items", response_model=list[ItemOut])
def display_items(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    items = get_all_items(db, user)   # the helper fetches every item; the route just passes its db in
    return items


# Get ONE item by its id (taken from the address, e.g. /items/3).
@app.get("/items/{item_id}", response_model=ItemOut)
def display_item(item_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    item = get_items(item_id, db, user)   # the helper finds it or stops with a 404
    return item

# Update an item. Send ONLY what changed, e.g. {"price": 230000}.
@app.put("/items/{item_id}", response_model=ItemOut)
def edit_item(item_id: int, item_in: ItemUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    item = get_items(item_id, db, user)

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
def delete_item(item_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    item = get_items(item_id, db, user)
    # First remove this item's price checks, so no "orphan" prices are left pointing at nothing.
    db.execute(delete(PriceCheck).where(PriceCheck.item_id == item.id))
    db.delete(item)                 # put "remove this" in the cart
    db.commit()                    # pay: now it's gone from roomfund.db
                                    # no return: a 204 sends an empty reply

# See your savings numbers. No id in the address: there's only one settings row.
@app.get("/settings", response_model=SettingsOut)
def get_settings_route(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    current_setting = get_settings(db, user)   # the helper finds the row (or makes it with 0, 0)
    return current_setting               # whatever the row holds RIGHT NOW


# Change your savings numbers. Send only what changed, e.g. {"monthly_savings": 60000}.
@app.put("/settings", response_model=SettingsOut)
def update_settings(settings_in: SettingsUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    settings = get_settings(db, user)          # no 404 check needed: the helper always returns a row
    changes = settings_in.model_dump(exclude_unset=True)   # only the fields actually sent
    for field, element in changes.items():
        setattr(settings, field, element)                  # settings.<field> = element
    db.commit()                          # save (no add(): the session already watches this row)
    db.refresh(settings)                 # re-read so we return exactly what's saved
    return settings

# Timeline: WHEN can the user afford each item?
# The route is the "delivery guy": fetch what buy_timeline needs, hand it over, send the answer back.
@app.get("/timeline")
def sort_items(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    # Step 1: the ITEMS. The database gives rows (they use dots),
    # but timeline.py wants dictionaries (they use ["..."]), so we convert each one.
    all_items_unchanged = get_all_items(db, user)   # a list of database rows
    all_items = []                            # will collect the dictionaries
    for item in all_items_unchanged:          # one row at a time (these tools only take ONE)
        if item.status == "bought":           # already bought → nothing left to plan for it
            continue                          # continue = skip to the next item
        all_items_pydantic = ItemOut.model_validate(item)   # row → Pydantic (works thanks to from_attributes)
        one_item = all_items_pydantic.model_dump()          # Pydantic → dictionary
        all_items.append(one_item)

    # Step 2: the SETTINGS. Only one row, so no loop. Same two steps: row → Pydantic → dictionary.
    settings_unchanged = get_settings(db, user)
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
def log_price(item_id: int, check_in: PriceCheckCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    get_items(item_id, db, user)                          # 404 if the item doesn't exist (we don't need the item itself)
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
def price_report(item_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    item = get_items(item_id, db, user)                   # 404 if missing
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
def delete_price(check_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    check = db.get(PriceCheck, check_id)
    # A price check has no owner itself: its ITEM does. So check the item's owner.
    if check is None or db.get(Item, check.item_id).user_id != user.id:
        raise HTTPException(status_code=404, detail="Price check not found")
    db.delete(check)
    db.commit()


# --- Savings, buying, streaks, badges (Phase 6) ---

# Log money you saved, e.g. {"amount": 10000}. It's ALSO added to your savings total.
@app.post("/savings", response_model=SavingsOut, status_code=201)
def log_savings(savings_in: SavingsCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    data = savings_in.model_dump()
    if data["saved_on"] is None:
        data["saved_on"] = date.today()
    log = SavingsLog(**data, user_id=user.id)    # stamp the owner
    db.add(log)
    settings = get_settings(db, user)
    settings.saved_so_far += log.amount     # your pocket goes up
    db.commit()                             # ONE commit saves both changes together
    db.refresh(log)
    return log


# See every savings log, newest first.
@app.get("/savings", response_model=list[SavingsOut])
def list_savings(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    query = (select(SavingsLog)
             .where(SavingsLog.user_id == user.id)                            # only YOUR logs
             .order_by(SavingsLog.saved_on.desc(), SavingsLog.id.desc()))    # .desc() = biggest/newest first
    return db.execute(query).scalars().all()


# Remove a wrong savings log. The amount comes back OUT of your total (never below 0).
@app.delete("/savings/{log_id}", status_code=204)
def delete_savings(log_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    log = db.get(SavingsLog, log_id)
    if log is None or log.user_id != user.id:       # missing, or not yours → 404
        raise HTTPException(status_code=404, detail="Savings log not found")
    settings = get_settings(db, user)
    settings.saved_so_far = max(0, settings.saved_so_far - log.amount)   # max(0, ...) = no negative naira
    db.delete(log)
    db.commit()


# Mark an item as BOUGHT. The money leaves your savings, and it drops off the timeline.
# Send {} to use the item's price, or {"price_paid": 38000} if you paid something else.
@app.post("/items/{item_id}/buy", response_model=ItemOut)
def buy_item(item_id: int, buy_in: BuyForm, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    item = get_items(item_id, db, user)
    if item.status == "bought":
        raise HTTPException(status_code=400, detail="Item is already bought")   # 400 = "bad request"
    price_paid = buy_in.price_paid or item.price       # `or`: use price_paid if given, else item.price
    settings = get_settings(db, user)
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
def progress(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    logs = db.execute(select(SavingsLog).where(SavingsLog.user_id == user.id)).scalars().all()
    items = get_all_items(db, user)
    # Price checks have no owner column, so JOIN them to their item and keep the ones whose item is yours.
    checks = db.execute(select(PriceCheck).join(Item, PriceCheck.item_id == Item.id)
                        .where(Item.user_id == user.id)).scalars().all()

    streak = savings_streak([log.saved_on for log in logs], date.today())
    bought = len([i for i in items if i.status == "bought"])     # count only the bought ones

    stats = {"saves": len(logs), "streak": streak, "checks": len(checks), "bought": bought}

    # Bar 1: the ROOM. Money of bought items ÷ money of all items.
    room = room_bar(items)

    # Bar 2: the NEXT item = the first not-yet-bought item in buying order
    # (same order as the timeline: priority first, then cheapest).
    not_bought = [{"id": i.id, "name": i.name, "price": i.price, "priority": i.priority}
                  for i in items if i.status != "bought"]
    next_item = None
    if not_bought:                                    # an empty list counts as False
        first = arrange_items(not_bought)[0]          # [0] = the first one in the line
        saved = get_settings(db, user).saved_so_far
        next_item = NextItemBar(item_id=first["id"], name=first["name"], price=first["price"],
                                saved=saved, percent=percent(saved, first["price"]))

    return ProgressOut(
        streak_weeks=streak,
        total_saved_logged=sum(log.amount for log in logs),     # sum() adds up all the amounts
        items_bought=bought,
        room=room,
        next_item=next_item,
        badges=badges(stats),
    )


# --- My Room (optional tab): import a room planned with Claude ---

# RoomView: the "room imported" screen: the room + its progress bar.
class RoomView(BaseModel):
    room: RoomOut
    progress: RoomBar

# The one friendly message for any code that isn't a proper room code.
BAD_CODE = "That doesn't look like a RoomFund room code. Copy it again from Claude."


# STEP 1: paste the code → see what's inside. NOTHING is saved yet.
# Each item says already_exists=true if you already have an item with that name.
@app.post("/room/import/preview", response_model=ImportPreview)
def preview_room(paste: PasteForm, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    try:
        # model_validate_json: read the text as JSON AND check it has the RoomCode shape, in one step
        code = RoomCode.model_validate_json(paste.code.strip())
    except ValidationError:                      # not JSON, wrong shape, bad price, unknown priority...
        raise HTTPException(status_code=400, detail=BAD_CODE)
    if not code.items:
        raise HTTPException(status_code=400, detail="No items found in this room.")

    # Names you already have, in lowercase, so "Fan" and "fan" count as the same.
    my_names = {i.name.strip().lower() for i in get_all_items(db, user)}
    items = [PreviewItem(**item.model_dump(), already_exists=item.name.strip().lower() in my_names)
             for item in code.items]
    return ImportPreview(room=code.room, items=items)


# STEP 2: save it. Send the room + ONLY the items you kept ticked (edited if you like).
# If you already had a room, it's replaced. Your existing items are never touched.
@app.post("/room/import", response_model=ImportResult, status_code=201)
def import_room(code: RoomCode, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    room = get_room(db, user)
    if room is None:                             # first import → make the room row
        room = Room(user_id=user.id, name=code.room.name)
        db.add(room)
    room.name = code.room.name                   # import again → update it
    room.width_cm = code.room.width_cm
    room.length_cm = code.room.length_cm

    for item in code.items:                      # each ticked item becomes a normal item of yours
        db.add(Item(**item.model_dump(), user_id=user.id))

    db.commit()                                  # ONE commit: room + all items saved together
    db.refresh(room)
    return ImportResult(room=room, items_added=len(code.items))


# The "room imported" screen. 404 = no room yet → show the empty state with "Import my room".
@app.get("/room", response_model=RoomView)
def my_room(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    room = get_room(db, user)
    if room is None:
        raise HTTPException(status_code=404, detail="No room imported yet")
    return RoomView(room=room, progress=room_bar(get_all_items(db, user)))


# "Remove room": forgets the room, KEEPS all your items.
@app.delete("/room", status_code=204)
def remove_room(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    room = get_room(db, user)
    if room is None:
        raise HTTPException(status_code=404, detail="No room imported yet")
    db.delete(room)
    db.commit()