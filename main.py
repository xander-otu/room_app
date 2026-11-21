# ---------------------------------------------------------
# main.py: the FastAPI app. Holds the Pydantic models
# (shapes of data going in/out) and the routes (the "doors").
# It also serves the web page (the frontend/ folder) at "/".
# ---------------------------------------------------------

# --- Imports ---
import io
import os
import secrets as pysecrets
from datetime import date, datetime, timedelta        # date: a calendar day; datetime: a day + time
from typing import Literal                            # Literal: allow ONLY specific exact values

from fastapi import FastAPI, Depends, HTTPException, Request, UploadFile, File, Response   # the app, helpers, errors, uploads, raw replies
from fastapi.security import OAuth2PasswordRequestForm  # the standard login form (username + password)
from fastapi.staticfiles import StaticFiles           # serves plain files (the web page, photos)
from pydantic import BaseModel, Field, ValidationError  # BaseModel: parent of Pydantic models; Field: adds rules
from sqlalchemy import select, delete, func           # select: "fetch rows"; delete: "remove rows"; func: count()
from sqlalchemy.orm import Session                    # the type of `db`, so VS Code knows what it is

from database import get_db                           # the gatekeeper: hands each request its own session
from models import (Item, ItemPhoto, Settings, PriceCheck, SavingsLog, User, Room,   # the database table classes
                    PaySchedule, Payday, UserBadge, PasswordReset)
from auth import (hash_password, verify_password, create_token, get_current_user,   # login tools (auth.py)
                  verify_google_token, make_reset_token, hash_reset_token, GOOGLE_CLIENT_ID)
from timeline import arrange_items, buy_timeline
from prices import buy_or_hold, estimate_monthly_pct  # the price-log "thinking" (prices.py)
from progress import savings_streak, badges, percent, came_back   # streaks, badges, progress bars (progress.py)
from payday import advance, per_month, monthly_incomes  # payday "thinking" (payday.py)

# Create the app. Every route below is attached to this object.
app = FastAPI()

UPLOADS_DIR = "uploads"                               # item photos are saved here (git-ignored)
os.makedirs(UPLOADS_DIR, exist_ok=True)


# --- Pydantic models: the shapes of data going IN and OUT ---

# ItemCreate: the "order form" a visitor sends to add an item.
# Pydantic checks it at the door; bad input gets a 422 before our code runs.
class ItemCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)                   # required text
    width_cm: int | None = Field(default=None, gt=0)                 # optional; None = "not given"
    depth_cm: int | None = Field(default=None, gt=0)                 # optional
    height_cm: int | None = Field(default=None, gt=0)                # optional
    price: int = Field(gt=0)                                         # whole naira, must be above 0
    priority: Literal["high", "medium", "low"]                       # only these three words allowed
    monthly_price_increase_pct: float = Field(default=0.0, ge=0)     # 0 or more; defaults to 0
    notes: str | None = Field(default=None, max_length=500)          # optional, e.g. "6 inch foam"


# ItemOut: the "delivery note" we send back.
# Inherits every ItemCreate field, plus what the database fills in.
class ItemOut(ItemCreate):
    id: int
    status: str
    photo_url: str | None = None             # "/uploads/item_3_ab12.jpg" or None
    bought_price: int | None = None          # what you really paid
    bought_on: date | None = None
    room_id: int | None = None               # set when it came from a room import

    model_config = {"from_attributes": True}   # lets Pydantic read a SQLAlchemy object (item.name) instead of a dict

# ItemUpdate: the "change form". Every field optional: send only what changed.
class ItemUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    price: int | None = Field(default=None, gt=0)
    priority: Literal["high", "medium", "low"] | None = None
    status: Literal["wanted", "saving", "bought"] | None = None   # status CAN change here
    width_cm: int | None = Field(default=None, gt=0)
    depth_cm: int | None = Field(default=None, gt=0)
    height_cm: int | None = Field(default=None, gt=0)
    monthly_price_increase_pct: float | None = Field(default=None, ge=0)
    notes: str | None = Field(default=None, max_length=500)

# SettingsOut: the savings numbers (and display choices) we send back.
class SettingsOut(BaseModel):
    saved_so_far: int
    monthly_savings: int
    show_room_tab: bool                      # is the optional "My Room" tab switched on?
    list_density: str                        # compact / moderate / comfortable

    model_config = {"from_attributes": True}   # lets Pydantic read a SQLAlchemy object (settings.saved_so_far) instead of a dict

# SettingsUpdate: the change form. All optional; ge=0 = no negative naira.
class SettingsUpdate(BaseModel):
    saved_so_far: int | None = Field(default=None, ge=0)
    monthly_savings: int | None = Field(default=None, ge=0)
    show_room_tab: bool | None = None        # send true / false to show or hide the My Room tab
    list_density: Literal["compact", "moderate", "comfortable"] | None = None


# --- Badges ---
class BadgeOut(BaseModel):
    key: str                     # e.g. "first_naira"
    name: str                    # "First Naira"
    description: str             # how to earn it
    earned: bool
    earned_at: datetime | None
    progress: int                # e.g. 3 (of 5)
    goal: int                    # e.g. 5
    show_progress: bool          # show "3/5" on the locked badge?

# Every action that can earn a badge sends back the NEW ones, so the
# "Badge earned!" pop-up can show straight away.
class WithBadges(BaseModel):
    new_badges: list[BadgeOut] = []


# --- Room import (the optional "My Room" tab) ---

# RoomInfo: the room itself, inside a room code.
class RoomInfo(BaseModel):
    name: str = "My room"
    width_cm: int | None = Field(default=None, gt=0)
    length_cm: int | None = Field(default=None, gt=0)

# RoomCode: the room + the ticked items. The frontend reads ChatGPT's code and sends
# this; each item uses ItemCreate, so it gets the SAME checks as adding an item by hand.
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
    id: int
    name: str
    width_cm: int | None
    length_cm: int | None
    created_at: datetime | None = None

    model_config = {"from_attributes": True}

class ImportResult(WithBadges):
    room: RoomOut
    items_added: int


# --- Price log ---

# PriceCheckCreate: the form for logging a price you saw.
# checked_on is optional: leave it out and it means "today".
class PriceCheckCreate(BaseModel):
    price: int = Field(gt=0)                 # whole naira, above 0
    source: str = Field(min_length=1, max_length=40)   # "Jumia", "Jiji", "Market"...
    link: str | None = Field(default=None, max_length=500)   # optional web link
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

class PriceCheckSaved(PriceCheckOut, WithBadges):
    pass

# PriceReport: everything about one item's prices, plus the verdict.
class PriceReport(BaseModel):
    item_id: int
    item_name: str
    item_price: int                          # the price saved on the item (the starting point)
    checks: list[PriceCheckOut]              # every price logged, oldest first
    lowest_check_id: int | None              # the cheapest logged price (gets "· lowest")
    verdict: str                             # "BUY NOW" / "HOLD" / "NO DATA"
    reason: str                              # one plain sentence explaining the verdict
    estimated_monthly_pct: float | None      # how fast the price really moves (None = not enough data yet)


# --- Savings, buying, progress ---

# SavingsCreate: the form for "I saved some money". saved_on optional → today.
class SavingsCreate(BaseModel):
    amount: int = Field(gt=0)                # whole naira, above 0
    saved_on: date | None = None

# SavingsOut: one savings log, as we send it back.
class SavingsOut(BaseModel):
    id: int
    amount: int
    saved_on: date
    source: str                              # "saved" or "payday" (shows "Payday ✓")

    model_config = {"from_attributes": True}

class SavingsSaved(SavingsOut, WithBadges):
    pass

# BuyForm: marking an item as bought. price_paid optional → the item's saved price.
class BuyForm(BaseModel):
    price_paid: int | None = Field(default=None, gt=0)

class ItemSaved(ItemOut, WithBadges):
    pass

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
    saved_so_far: int            # what's in your pocket now
    items_bought: int
    room: RoomBar
    next_item: NextItemBar | None   # None = nothing left to buy 🎉
    badges: list[BadgeOut]
    new_badges: list[BadgeOut]   # earned since the last check (show the pop-up)


# --- Accounts ---

# SignupForm: what you send to make an account. The name is checked by hand
# (not by Field) so we can send the exact friendly messages from the design.
class SignupForm(BaseModel):
    name: str = ""
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=8, max_length=72)   # 8+ characters; 72 = the most bcrypt can blend

# UserOut: an account as we send it back. NO password, not even the blended one.
class UserOut(BaseModel):
    id: int
    name: str
    email: str
    signed_in_with: str          # "Email" or "Google"

class NameForm(BaseModel):
    name: str

# Token: the wristband we hand out at login.
class Token(BaseModel):
    access_token: str
    token_type: str      # always "bearer" = "whoever carries this wristband"

class GoogleForm(BaseModel):
    id_token: str

class ForgotForm(BaseModel):
    email: str

class ResetForm(BaseModel):
    token: str
    password: str = Field(min_length=8, max_length=72)

class ResetCheck(BaseModel):
    token: str


# --- Payday ---
class ScheduleIn(BaseModel):
    frequency: Literal["weekly", "biweekly", "monthly", "irregular"]
    next_payday: date | None = None
    amount: int | None = Field(default=None, ge=0)

class ScheduleOut(BaseModel):
    frequency: str | None        # None = payday not set up
    next_payday: date | None
    amount: int | None
    average_monthly: int         # what the Timeline uses per month

class PaydayOut(BaseModel):
    id: int
    expected_date: date
    status: str
    rescheduled_to: date | None
    amount: int | None           # what you usually save from a payday
    next_regular: date           # the payday after this one (reschedule must be before it)
    frequency: str

class ReceivedForm(BaseModel):
    amount: int = Field(gt=0)

class RescheduleForm(BaseModel):
    date: date

class PaydayAnswer(WithBadges):
    payday: PaydayOut
    next_payday: date | None


# --- Helpers (NOT routes: no @app above them, so FastAPI never calls them) ---

# get_settings: "get or create" THIS USER's settings row.
# Takes db and user as plain inputs (no Depends): the route already has them and passes them in.
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
def get_items(item_id: int, db: Session, user: User) -> Item:
    item = db.get(Item, item_id)                     # find it in its "locker"
    if item is None or item.user_id != user.id:      # missing, OR not yours → 404
        raise HTTPException(status_code=404, detail="Item not found")
    return item                                      # only reached when it exists AND it's yours


# get_all_items: fetch ALL of THIS USER's items, as a list.
def get_all_items(db: Session, user: User) -> list[Item]:
    items = db.execute(select(Item).where(Item.user_id == user.id)).scalars().all()
    return items                                       # a list of Item objects (rows)


# room_bar: the 🏠 room progress bar (money of bought items ÷ money of all items).
def room_bar(items) -> RoomBar:
    total_value = sum(i.price for i in items)
    bought_value = sum(i.price for i in items if i.status == "bought")
    return RoomBar(percent=percent(bought_value, total_value),
                   bought_value=bought_value, total_value=total_value)


# get_room: THIS USER's room, or None if they haven't imported one.
def get_room(db: Session, user: User) -> Room | None:
    return db.execute(select(Room).where(Room.user_id == user.id)).scalar_one_or_none()


# clean_name: trim spaces and check the length, with the design's exact messages.
def clean_name(name: str) -> str:
    name = (name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Please tell us your name.")
    if len(name) > 40:
        raise HTTPException(status_code=400, detail="Name must be 40 characters or less.")
    return name


def user_out(user: User) -> UserOut:
    return UserOut(id=user.id, name=user.name, email=user.email,
                   signed_in_with="Google" if user.google_sub else "Email")


def get_schedule(db: Session, user: User) -> PaySchedule | None:
    return db.execute(select(PaySchedule).where(PaySchedule.user_id == user.id)).scalar_one_or_none()


# open_payday: a payday we asked about but isn't finished (still pending, or moved to a new date).
def open_payday(db: Session, user: User) -> Payday | None:
    return db.execute(select(Payday).where(Payday.user_id == user.id,
                                           Payday.status.in_(["pending", "rescheduled"]))
                      .order_by(Payday.id.desc())).scalars().first()


# average_monthly: how much comes in per month, for the Timeline.
#   payday set (weekly / 2 weeks / monthly) → the payday amount turned into a monthly figure
#   "It varies" → what you REALLY saved per month over the last 3 months
#   no payday → "You save each month" from Settings
def average_monthly(db: Session, user: User, settings: Settings, schedule: PaySchedule | None) -> int:
    if schedule and schedule.frequency != "irregular" and schedule.amount is not None:
        return per_month(schedule.frequency, schedule.amount)
    if schedule and schedule.frequency == "irregular":
        since = date.today() - timedelta(days=91)
        total = db.execute(select(func.sum(SavingsLog.amount)).where(
            SavingsLog.user_id == user.id, SavingsLog.saved_on >= since)).scalar() or 0
        return round(total / 3) if total else settings.monthly_savings
    return settings.monthly_savings


# projected_incomes: money expected in each future month from the real payday dates,
# or None when there's no fixed payday (then the Timeline uses the flat average).
def projected_incomes(db: Session, user: User, schedule: PaySchedule | None) -> list[int] | None:
    if not schedule or schedule.frequency == "irregular" or not schedule.next_payday or schedule.amount is None:
        return None
    first_dates, next_regular = [], schedule.next_payday
    row = open_payday(db, user)
    if row and row.status == "rescheduled":            # this payday moved: count it on its new date
        first_dates = [row.rescheduled_to]
        next_regular = advance(row.expected_date, schedule.frequency)
    return monthly_incomes(date.today(), first_dates, next_regular, schedule.frequency, schedule.amount)


# sync_badges: work out every badge, SAVE any newly earned ones (badges are never taken
# away), and return (all badges, earned first) + (just the new ones).
def sync_badges(db: Session, user: User) -> tuple[list[BadgeOut], list[BadgeOut]]:
    logs = db.execute(select(SavingsLog).where(SavingsLog.user_id == user.id)).scalars().all()
    items = get_all_items(db, user)
    checks = db.execute(select(func.count(PriceCheck.id)).join(Item, PriceCheck.item_id == Item.id)
                        .where(Item.user_id == user.id)).scalar() or 0
    answers = db.execute(select(func.count(Payday.id)).where(
        Payday.user_id == user.id, Payday.answered_at.is_not(None))).scalar() or 0
    save_days = [log.saved_on for log in logs]
    stats = {
        "saves": len(logs),
        "streak": savings_streak(save_days, date.today()),
        "checks": checks,
        "bought": len([i for i in items if i.status == "bought"]),
        "room_percent": room_bar(items).percent,
        "payday_answers": answers,
        "bargains": len([i for i in items if i.status == "bought" and i.bought_price is not None
                         and i.bought_price < i.price]),
        "photos": len([i for i in items if i.photo_url]),
        "comeback": 1 if came_back(save_days) else 0,
        "room_imported": 1 if get_room(db, user) else 0,
    }

    stored = {b.key: b.earned_at for b in
              db.execute(select(UserBadge).where(UserBadge.user_id == user.id)).scalars().all()}
    new_keys = []
    for b in badges(stats):
        if b["reached"] and b["key"] not in stored:      # just earned it
            row = UserBadge(user_id=user.id, key=b["key"])
            db.add(row)
            db.flush()                                   # flush: fill in earned_at without a full commit
            stored[b["key"]] = row.earned_at
            new_keys.append(b["key"])
    if new_keys:
        db.commit()

    all_badges = []
    for b in badges(stats):
        earned = b["key"] in stored
        all_badges.append(BadgeOut(key=b["key"], name=b["name"], description=b["description"],
                                   earned=earned, earned_at=stored.get(b["key"]),
                                   progress=b["goal"] if earned else b["progress"], goal=b["goal"],
                                   show_progress=b["show_progress"]))
    # Earned first (oldest first), then the locked ones in their normal order.
    earned_list = sorted([b for b in all_badges if b.earned], key=lambda b: b.earned_at)
    locked_list = [b for b in all_badges if not b.earned]
    return earned_list + locked_list, [b for b in all_badges if b.key in new_keys]


# delete_photo: forget an item's photo: the stored picture in the database, plus any
# old-style file in the uploads/ folder (photos from before they moved into the database).
def delete_photo(db: Session, item: Item):
    db.execute(delete(ItemPhoto).where(ItemPhoto.item_id == item.id))
    if item.photo_url and item.photo_url.startswith("/uploads/"):
        path = os.path.join(UPLOADS_DIR, os.path.basename(item.photo_url))
        if os.path.exists(path):
            os.remove(path)


def payday_out(row: Payday, schedule: PaySchedule) -> PaydayOut:
    return PaydayOut(id=row.id, expected_date=row.expected_date, status=row.status,
                     rescheduled_to=row.rescheduled_to, amount=schedule.amount,
                     next_regular=advance(row.expected_date, schedule.frequency),
                     frequency=schedule.frequency)


# --- Routes ---

# Health check: confirm the server is alive. (Public: no login needed.)
# Also answers HEAD (a "just checking" request with no body), which uptime monitors
# like UptimeRobot use. A monitor visiting this every 5 minutes keeps Render from sleeping.
@app.api_route("/health", methods=["GET", "HEAD"])
def greeting():
    return {"message": "Welcome to the Room Fund API!"}


# What the login page needs to know before anyone logs in (e.g. is Google login set up?).
@app.get("/auth/config")
def auth_config():
    return {"google_client_id": GOOGLE_CLIENT_ID}


# Make an account. Public: you can't be logged in before you have an account.
@app.post("/signup", response_model=UserOut, status_code=201)
def signup(form: SignupForm, db: Session = Depends(get_db)):
    name = clean_name(form.name)
    email = form.email.strip().lower()            # " Tunde@Mail.com " and "tunde@mail.com" = same person
    taken = db.execute(select(User).where(User.email == email)).scalar_one_or_none()
    if taken:
        raise HTTPException(status_code=400, detail="That email already has an account")
    user = User(name=name, email=email, hashed_password=hash_password(form.password))   # BLENDED password only
    db.add(user)
    db.commit()
    db.refresh(user)
    return user_out(user)


# Log in: swap your email + password for a wristband (token).
# OAuth2PasswordRequestForm is the standard login form: it calls the email "username".
@app.post("/login", response_model=Token)
def login(form: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    email = form.username.strip().lower()
    user = db.execute(select(User).where(User.email == email)).scalar_one_or_none()
    # Same message for "no such email", "wrong password" and "Google-only account (no password)",
    # so strangers can't test which emails have accounts.
    if user is None or not user.hashed_password or not verify_password(form.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Wrong email or password")
    return Token(access_token=create_token(user), token_type="bearer")


# Continue with Google: the page gets an ID token from Google; we check it with Google's
# library, then find or make the account, and hand back the SAME kind of wristband as /login.
@app.post("/auth/google", response_model=Token)
def google_login(form: GoogleForm, db: Session = Depends(get_db)):
    info = verify_google_token(form.id_token)
    if info is None:
        raise HTTPException(status_code=400, detail="Google sign-in didn't work. Please try again.")
    sub, email = info["sub"], info["email"].strip().lower()
    user = db.execute(select(User).where(User.google_sub == sub)).scalar_one_or_none()
    if user is None:
        user = db.execute(select(User).where(User.email == email)).scalar_one_or_none()
        if user is not None:
            user.google_sub = sub                 # linking rule: same verified email → link the accounts
        else:
            name = (info.get("given_name") or info.get("name") or email.split("@")[0]).strip()[:40]
            user = User(email=email, name=name, hashed_password=None, google_sub=sub)
            db.add(user)
        db.commit()
        db.refresh(user)
    return Token(access_token=create_token(user), token_type="bearer")


# Forgot password: ALWAYS says OK (so nobody can test which emails exist).
# If the account exists and has a password, make a 30-minute link. There's no email
# sender set up yet, so the link is printed in the server window (development).
@app.post("/auth/forgot")
def forgot_password(form: ForgotForm, request: Request, db: Session = Depends(get_db)):
    email = form.email.strip().lower()
    user = db.execute(select(User).where(User.email == email)).scalar_one_or_none()
    if user is not None and user.hashed_password:
        token, token_hash = make_reset_token()
        db.add(PasswordReset(token_hash=token_hash, user_id=user.id,
                             expires_at=datetime.now() + timedelta(minutes=30)))
        db.commit()
        link = f"{str(request.base_url).rstrip('/')}/#/reset?token={token}"
        print(f"\n[RoomFund] Password reset link for {email} (valid 30 minutes):\n  {link}\n", flush=True)
    return {"ok": True}


def find_reset(db: Session, token: str) -> PasswordReset:
    row = db.execute(select(PasswordReset).where(PasswordReset.token_hash == hash_reset_token(token))
                     ).scalar_one_or_none()
    if row is None or row.used_at is not None or row.expires_at < datetime.now():
        raise HTTPException(status_code=400, detail="expired")
    return row


# Is this reset link still good? (So the page can show "Link expired" straight away.)
@app.post("/auth/reset/check")
def check_reset(form: ResetCheck, db: Session = Depends(get_db)):
    find_reset(db, form.token)
    return {"ok": True}


# Set a new password from the email link. Marks the link used and logs out every
# other device (token_version + 1 makes all old wristbands invalid).
@app.post("/auth/reset")
def reset_password(form: ResetForm, db: Session = Depends(get_db)):
    row = find_reset(db, form.token)
    user = db.get(User, row.user_id)
    user.hashed_password = hash_password(form.password)
    user.token_version += 1
    row.used_at = datetime.now()
    db.commit()
    return {"ok": True}


# Who am I? Shows the account your wristband belongs to.
@app.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)):
    return user_out(user)


# Change your name (Settings → Account → Name).
@app.put("/me", response_model=UserOut)
def update_me(form: NameForm, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    user.name = clean_name(form.name)
    db.commit()
    db.refresh(user)
    return user_out(user)


# Add a new item. 201 = "Created", the standard reply when something new is made.
@app.post("/items", response_model=ItemOut, status_code=201)
def create_item(item_in: ItemCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    # model_dump() turns the form into a dict; ** unpacks it into Item(name=..., price=...).
    # user_id=user.id stamps the owner on it: the logged-in person (from their wristband).
    db_item = Item(**item_in.model_dump(), user_id=user.id)
    db.add(db_item)        # put it in the cart (not saved yet)
    db.commit()            # pay at the counter: now it's saved in roomfund.db
    db.refresh(db_item)    # re-read the row so db_item gets its new id and status
    return db_item         # response_model=ItemOut turns the object into JSON

# List every item. list[ItemOut] = "send back a list of delivery notes".
@app.get("/items", response_model=list[ItemOut])
def display_items(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return get_all_items(db, user)


# Get ONE item by its id (taken from the address, e.g. /items/3).
@app.get("/items/{item_id}", response_model=ItemOut)
def display_item(item_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return get_items(item_id, db, user)   # the helper finds it or stops with a 404

# Update an item. Send ONLY what changed, e.g. {"price": 230000}.
@app.put("/items/{item_id}", response_model=ItemOut)
def edit_item(item_id: int, item_in: ItemUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    item = get_items(item_id, db, user)
    changes = item_in.model_dump(exclude_unset=True)   # only the fields actually sent
    for field, value in changes.items():
        setattr(item, field, value)                    # item.<field> = value
    # Status changed by hand on the Edit screen:
    if changes.get("status") == "bought" and item.bought_on is None:
        item.bought_on = date.today()                  # bought today, at its listed price
        item.bought_price = item.price
    elif changes.get("status") in ("wanted", "saving"):
        item.bought_on = None                          # not bought any more
        item.bought_price = None
    db.commit()            # save. No db.add(): the session is already watching this item
    db.refresh(item)       # re-read so we return exactly what's saved
    return item


# Delete an item. 204 = "done, nothing to send back".
@app.delete("/items/{item_id}", status_code=204)
def delete_item(item_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    item = get_items(item_id, db, user)
    # First remove this item's price checks, so no "orphan" prices are left pointing at nothing.
    db.execute(delete(PriceCheck).where(PriceCheck.item_id == item.id))
    delete_photo(db, item)          # and its photo
    db.delete(item)                 # put "remove this" in the cart
    db.commit()                     # pay: now it's gone from roomfund.db


# One photo per item. JPG, PNG or WebP, max 5 MB. It's shrunk to max 1200px on its
# longest side and replaces any old photo.
MAX_PHOTO_BYTES = 5 * 1024 * 1024
FORMATS = {"JPEG": "jpg", "PNG": "png", "WEBP": "webp"}

@app.post("/items/{item_id}/photo", response_model=ItemSaved)
def upload_photo(item_id: int, photo: UploadFile = File(...), db: Session = Depends(get_db),
                 user: User = Depends(get_current_user)):
    from PIL import Image, ImageOps                # Pillow: opens and resizes pictures
    item = get_items(item_id, db, user)
    data = photo.file.read(MAX_PHOTO_BYTES + 1)    # read at most 5 MB + 1 byte
    if len(data) > MAX_PHOTO_BYTES:
        raise HTTPException(status_code=400, detail="That photo is too big. Pick one under 5 MB.")
    try:
        img = Image.open(io.BytesIO(data))
        fmt = img.format
        if fmt not in FORMATS:
            raise ValueError
        img = ImageOps.exif_transpose(img)        # phone photos: turn them the right way up
        img.thumbnail((1200, 1200))               # shrink (never enlarge) to fit 1200 × 1200
    except Exception:
        raise HTTPException(status_code=400, detail="Use a JPG, PNG or WebP photo.")
    if fmt == "JPEG" and img.mode not in ("RGB", "L"):
        img = img.convert("RGB")
    out = io.BytesIO()
    img.save(out, format=fmt)                     # the resized picture, as bytes
    delete_photo(db, item)                        # replace the old photo
    token = pysecrets.token_hex(8)                # random, so nobody can guess other people's photo addresses
    db.add(ItemPhoto(item_id=item.id, token=token, content_type=f"image/{FORMATS[fmt].replace('jpg', 'jpeg')}", data=out.getvalue()))
    item.photo_url = f"/photos/{item.id}/{token}"
    db.commit()
    db.refresh(item)
    _, new = sync_badges(db, user)                # Snapshot badge
    return ItemSaved(**ItemOut.model_validate(item).model_dump(), new_badges=new)


@app.delete("/items/{item_id}/photo", status_code=204)
def remove_photo(item_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    item = get_items(item_id, db, user)
    delete_photo(db, item)
    item.photo_url = None
    db.commit()


# Show a photo. Public (an <img> can't send the login token), but the address has a
# random token in it, so only someone who was shown the address can open it.
# A new upload gets a new address, so browsers may keep a copy for a long time.
@app.get("/photos/{item_id}/{token}")
def get_photo(item_id: int, token: str, db: Session = Depends(get_db)):
    photo = db.execute(select(ItemPhoto).where(ItemPhoto.item_id == item_id)).scalar_one_or_none()
    if photo is None or not pysecrets.compare_digest(photo.token, token):
        raise HTTPException(status_code=404, detail="Photo not found")
    return Response(content=photo.data, media_type=photo.content_type,
                    headers={"Cache-Control": "public, max-age=31536000, immutable"})


# See your savings numbers and display choices.
@app.get("/settings", response_model=SettingsOut)
def get_settings_route(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return get_settings(db, user)


# Change your settings. Send only what changed, e.g. {"monthly_savings": 60000}.
# Changing saved_so_far here is a CORRECTION, not a savings entry (no streak, no history).
@app.put("/settings", response_model=SettingsOut)
def update_settings(settings_in: SettingsUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    settings = get_settings(db, user)
    for field, element in settings_in.model_dump(exclude_unset=True).items():
        setattr(settings, field, element)                  # settings.<field> = element
    db.commit()
    db.refresh(settings)
    return settings

# Timeline: WHEN can the user afford each item?
# The route is the "delivery guy": fetch what buy_timeline needs, hand it over, send the answer back.
@app.get("/timeline")
def sort_items(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    # Step 1: the ITEMS. The database gives rows (they use dots),
    # but timeline.py wants dictionaries (they use ["..."]), so we convert each one.
    all_items = []
    for item in get_all_items(db, user):
        if item.status == "bought":           # already bought → nothing left to plan for it
            continue                          # continue = skip to the next item
        all_items.append(ItemOut.model_validate(item).model_dump())   # row → Pydantic → dictionary

    # Step 2: the MONEY: what you have now, and what comes in each month.
    settings = get_settings(db, user)
    schedule = get_schedule(db, user)
    average = average_monthly(db, user, settings, schedule)      # the flat monthly figure
    incomes = projected_incomes(db, user, schedule)              # real paydays, month by month (or None)

    # Step 3: hand everything to timeline.py, which sorts and works out the months.
    return buy_timeline(all_items, settings.saved_so_far, average, incomes)


# --- Price log ---

# Log a price you saw for an item, e.g. POST /items/3/prices with {"price": 39000, "source": "Jiji"}.
@app.post("/items/{item_id}/prices", response_model=PriceCheckSaved, status_code=201)
def log_price(item_id: int, check_in: PriceCheckCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    get_items(item_id, db, user)                    # 404 if the item doesn't exist (or isn't yours)
    data = check_in.model_dump()                    # form → dictionary
    if data["checked_on"] is None:                  # no date given → today
        data["checked_on"] = date.today()
    check = PriceCheck(item_id=item_id, **data)     # dictionary → database row (+ which item it belongs to)
    db.add(check)
    db.commit()
    db.refresh(check)                               # get its new id
    _, new = sync_badges(db, user)                  # Price Watcher badge
    return PriceCheckSaved(**PriceCheckOut.model_validate(check).model_dump(), new_badges=new)


# See an item's price history + BUY NOW / HOLD.
@app.get("/items/{item_id}/prices", response_model=PriceReport)
def price_report(item_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    item = get_items(item_id, db, user)             # 404 if missing
    query = (select(PriceCheck)
             .where(PriceCheck.item_id == item_id)
             .order_by(PriceCheck.checked_on, PriceCheck.id))   # oldest day first
    checks = db.execute(query).scalars().all()

    verdict, reason = buy_or_hold(item.price, [(c.price, c.source) for c in checks])
    pct = None
    if len(checks) >= 2:                            # need a first AND a last to measure change
        pct = estimate_monthly_pct(checks[0].price, checks[0].checked_on,
                                   checks[-1].price, checks[-1].checked_on)
    lowest = min(checks, key=lambda c: (c.price, c.checked_on)) if checks else None

    return PriceReport(item_id=item.id, item_name=item.name, item_price=item.price,
                       checks=checks, lowest_check_id=lowest.id if lowest else None,
                       verdict=verdict, reason=reason, estimated_monthly_pct=pct)


def delete_check(check_id: int, db: Session, user: User, item_id: int | None = None):
    check = db.get(PriceCheck, check_id)
    # A price check has no owner itself: its ITEM does. So check the item's owner.
    if (check is None or (item_id is not None and check.item_id != item_id)
            or db.get(Item, check.item_id).user_id != user.id):
        raise HTTPException(status_code=404, detail="Price check not found")
    db.delete(check)
    db.commit()


# Remove one wrong price log. 204 = done, nothing to send back.
@app.delete("/items/{item_id}/prices/{price_id}", status_code=204)
def delete_item_price(item_id: int, price_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    delete_check(price_id, db, user, item_id)

@app.delete("/prices/{check_id}", status_code=204)   # the older address, kept so nothing breaks
def delete_price(check_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    delete_check(check_id, db, user)


# --- Savings, buying, streaks, badges ---

# Log money you saved, e.g. {"amount": 10000}. It's ALSO added to your savings total.
@app.post("/savings", response_model=SavingsSaved, status_code=201)
def log_savings(savings_in: SavingsCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    data = savings_in.model_dump()
    if data["saved_on"] is None:
        data["saved_on"] = date.today()
    log = SavingsLog(**data, user_id=user.id, source="saved")    # stamp the owner
    db.add(log)
    settings = get_settings(db, user)
    settings.saved_so_far += log.amount     # your pocket goes up
    db.commit()                             # ONE commit saves both changes together
    db.refresh(log)
    _, new = sync_badges(db, user)
    return SavingsSaved(**SavingsOut.model_validate(log).model_dump(), new_badges=new)


# See every savings log, newest first.
@app.get("/savings", response_model=list[SavingsOut])
def list_savings(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    query = (select(SavingsLog)
             .where(SavingsLog.user_id == user.id)                            # only YOUR logs
             .order_by(SavingsLog.saved_on.desc(), SavingsLog.id.desc()))    # .desc() = newest first
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
@app.post("/items/{item_id}/buy", response_model=ItemSaved)
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
    item.bought_price = price_paid                     # remembered for "Bought for ₦..." and Bargain Hunter
    item.bought_on = date.today()
    db.commit()
    db.refresh(item)
    _, new = sync_badges(db, user)
    return ItemSaved(**ItemOut.model_validate(item).model_dump(), new_badges=new)


# Your streak, totals, progress bars and badges, all in one place.
@app.get("/progress", response_model=ProgressOut)
def progress(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    logs = db.execute(select(SavingsLog).where(SavingsLog.user_id == user.id)).scalars().all()
    items = get_all_items(db, user)
    settings = get_settings(db, user)
    all_badges, new = sync_badges(db, user)

    # The NEXT item = the first not-yet-bought item in buying order (same order as the timeline).
    not_bought = [{"id": i.id, "name": i.name, "price": i.price, "priority": i.priority}
                  for i in items if i.status != "bought"]
    next_item = None
    if not_bought:                                    # an empty list counts as False
        first = arrange_items(not_bought)[0]          # [0] = the first one in the line
        saved = settings.saved_so_far
        next_item = NextItemBar(item_id=first["id"], name=first["name"], price=first["price"],
                                saved=saved, percent=percent(saved, first["price"]))

    return ProgressOut(
        streak_weeks=savings_streak([log.saved_on for log in logs], date.today()),
        total_saved_logged=sum(log.amount for log in logs),     # sum() adds up all the amounts
        saved_so_far=settings.saved_so_far,
        items_bought=len([i for i in items if i.status == "bought"]),
        room=room_bar(items),
        next_item=next_item,
        badges=all_badges,
        new_badges=new,
    )


# --- Payday (income isn't always on time) ---

@app.get("/payday/schedule", response_model=ScheduleOut)
def read_schedule(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    schedule = get_schedule(db, user)
    average = average_monthly(db, user, get_settings(db, user), schedule)
    if schedule is None:
        return ScheduleOut(frequency=None, next_payday=None, amount=None, average_monthly=average)
    return ScheduleOut(frequency=schedule.frequency, next_payday=schedule.next_payday,
                       amount=schedule.amount, average_monthly=average)


@app.put("/payday/schedule", response_model=ScheduleOut)
def save_schedule(form: ScheduleIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if form.frequency != "irregular":
        if form.next_payday is None:
            raise HTTPException(status_code=400, detail="Pick your next payday.")
        if form.amount is None:
            raise HTTPException(status_code=400, detail="Enter how much you save from each payday.")
    schedule = get_schedule(db, user)
    if schedule is None:
        schedule = PaySchedule(user_id=user.id, frequency=form.frequency)
        db.add(schedule)
    schedule.frequency = form.frequency
    # "It varies": no check-ins, no calendar, no amount.
    schedule.next_payday = None if form.frequency == "irregular" else form.next_payday
    schedule.amount = None if form.frequency == "irregular" else form.amount
    # A new schedule replaces any check-in that was waiting to be asked.
    db.execute(delete(Payday).where(Payday.user_id == user.id, Payday.status == "pending"))
    db.commit()
    return read_schedule(db, user)


# The payday to ask about right now ("Did your allowance land?"), or null.
@app.get("/payday/pending", response_model=PaydayOut | None)
def pending_payday(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    schedule = get_schedule(db, user)
    if not schedule or schedule.frequency == "irregular" or not schedule.next_payday:
        return None
    today = date.today()
    row = open_payday(db, user)
    if row:
        due = row.rescheduled_to if row.status == "rescheduled" else row.expected_date
        return payday_out(row, schedule) if due <= today else None
    if schedule.next_payday <= today:                # a payday is due and we haven't asked yet
        row = Payday(user_id=user.id, expected_date=schedule.next_payday, status="pending")
        db.add(row)
        db.commit()
        db.refresh(row)
        return payday_out(row, schedule)
    return None


def my_open_payday(payday_id: int, db: Session, user: User) -> tuple[Payday, PaySchedule]:
    row = db.get(Payday, payday_id)
    schedule = get_schedule(db, user)
    if row is None or row.user_id != user.id or row.status not in ("pending", "rescheduled") or schedule is None:
        raise HTTPException(status_code=404, detail="Payday not found")
    return row, schedule


def mark_answered(row: Payday):
    if row.answered_at is None:
        row.answered_at = datetime.now()             # any answer counts for Payday Pro


# "Yes, I got paid": add the money (as a savings entry tagged Payday ✓) and move on.
@app.post("/paydays/{payday_id}/received", response_model=PaydayAnswer)
def payday_received(payday_id: int, form: ReceivedForm, db: Session = Depends(get_db),
                    user: User = Depends(get_current_user)):
    row, schedule = my_open_payday(payday_id, db, user)
    db.add(SavingsLog(user_id=user.id, amount=form.amount, saved_on=date.today(), source="payday"))
    get_settings(db, user).saved_so_far += form.amount
    row.status = "received"
    row.amount_received = form.amount
    mark_answered(row)
    schedule.next_payday = advance(row.expected_date, schedule.frequency)   # schedule the next one
    db.commit()
    _, new = sync_badges(db, user)
    return PaydayAnswer(payday=payday_out(row, schedule), next_payday=schedule.next_payday, new_badges=new)


# "Not yet": it'll come on another day (must be today or later, and before the next payday).
@app.post("/paydays/{payday_id}/reschedule", response_model=PaydayAnswer)
def payday_reschedule(payday_id: int, form: RescheduleForm, db: Session = Depends(get_db),
                      user: User = Depends(get_current_user)):
    row, schedule = my_open_payday(payday_id, db, user)
    next_regular = advance(row.expected_date, schedule.frequency)
    if form.date < date.today() or form.date >= next_regular:
        raise HTTPException(status_code=400, detail="Pick a date before your next payday.")
    row.status = "rescheduled"
    row.rescheduled_to = form.date
    mark_answered(row)
    db.commit()
    _, new = sync_badges(db, user)
    return PaydayAnswer(payday=payday_out(row, schedule), next_payday=schedule.next_payday, new_badges=new)


# "Skip this month": no money this time; the next payday moves to the next period.
@app.post("/paydays/{payday_id}/skip", response_model=PaydayAnswer)
def payday_skip(payday_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row, schedule = my_open_payday(payday_id, db, user)
    row.status = "skipped"
    mark_answered(row)
    schedule.next_payday = advance(row.expected_date, schedule.frequency)
    db.commit()
    _, new = sync_badges(db, user)
    return PaydayAnswer(payday=payday_out(row, schedule), next_payday=schedule.next_payday, new_badges=new)


# --- My Room (optional tab): import a room planned with ChatGPT ---

# RoomView: the "room imported" screen: the room + its progress bar (only this room's items).
class RoomView(BaseModel):
    room: RoomOut
    progress: RoomBar
    item_count: int

# The one friendly message for any code that isn't a proper room code.
BAD_CODE = "That doesn't look like a RoomFund code. Copy the whole code block from ChatGPT and try again."


# Paste the code → see what's inside. NOTHING is saved yet. (The web page reads the code
# itself; this route is kept for /docs and other apps.)
@app.post("/room/import/preview", response_model=ImportPreview)
def preview_room(paste: PasteForm, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    text_in = paste.code.strip()
    start, end = text_in.find("{"), text_in.rfind("}")     # ChatGPT may add words around the code
    try:
        code = RoomCode.model_validate_json(text_in[start:end + 1] if start != -1 else text_in)
    except ValidationError:                      # not JSON, wrong shape, bad price, unknown priority...
        raise HTTPException(status_code=400, detail=BAD_CODE)
    if not code.items:
        raise HTTPException(status_code=400, detail="No items found in this room.")
    my_names = {i.name.strip().lower() for i in get_all_items(db, user)}
    items = [PreviewItem(**item.model_dump(), already_exists=item.name.strip().lower() in my_names)
             for item in code.items]
    return ImportPreview(room=code.room, items=items)


# Save it: the room + ONLY the items you kept ticked (edited if you like), in ONE transaction.
# Importing again updates the room's name and size and adds newly ticked items,
# but never adds an item that's already in this room (no doubles).
@app.post("/room/import", response_model=ImportResult, status_code=201)
def import_room(code: RoomCode, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if not code.items:
        raise HTTPException(status_code=400, detail="No items found in this room.")
    room = get_room(db, user)
    if room is None:                             # first import → make the room row
        room = Room(user_id=user.id, name=code.room.name, created_at=datetime.now())
        db.add(room)
        db.flush()                               # flush: give the room its id now
    room.name = code.room.name                   # import again → update it
    room.width_cm = code.room.width_cm
    room.length_cm = code.room.length_cm

    in_room = {i.name.strip().lower() for i in get_all_items(db, user) if i.room_id == room.id}
    added = 0
    for item in code.items:
        key = item.name.strip().lower()
        if key in in_room:
            continue                             # already in this room: don't double it
        db.add(Item(**item.model_dump(), user_id=user.id, room_id=room.id))
        in_room.add(key)
        added += 1

    db.commit()                                  # ONE commit: room + all items saved together
    db.refresh(room)
    _, new = sync_badges(db, user)               # Room Planner badge
    return ImportResult(room=RoomOut.model_validate(room), items_added=added, new_badges=new)


# The "room imported" screen. 404 = no room yet → show the empty state.
@app.get("/room", response_model=RoomView)
def my_room(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    room = get_room(db, user)
    if room is None:
        raise HTTPException(status_code=404, detail="No room imported yet")
    room_items = [i for i in get_all_items(db, user) if i.room_id == room.id]
    return RoomView(room=room, progress=room_bar(room_items), item_count=len(room_items))


# "Remove room": forgets the room, KEEPS all your items.
@app.delete("/room", status_code=204)
def remove_room(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    room = get_room(db, user)
    if room is None:
        raise HTTPException(status_code=404, detail="No room imported yet")
    for item in get_all_items(db, user):
        if item.room_id == room.id:
            item.room_id = None                  # the item stays, it just isn't "in a room" any more
    db.delete(room)
    db.commit()


# --- The web page ---
# Tell browsers to always check for a newer copy of the page's files (html/css/js/svg).
# Without this, a normal reload can quietly reuse OLD scripts from the browser's cache.
@app.middleware("http")
async def no_stale_page_files(request: Request, call_next):
    response = await call_next(request)
    path = request.url.path
    if path == "/" or path.endswith((".html", ".js", ".css", ".svg", ".json")):
        response.headers["Cache-Control"] = "no-cache"   # "you may keep it, but ask me first"
    return response

# Mounted LAST, so every API route above is matched first.
# /uploads → item photos; / → the frontend folder (index.html, css, js).
app.mount("/uploads", StaticFiles(directory=UPLOADS_DIR), name="uploads")
FRONTEND_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "frontend")   # next to main.py
if os.path.isdir(FRONTEND_DIR):
    app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
