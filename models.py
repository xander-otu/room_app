# ---------------------------------------------------------
# models.py: the database tables, written as Python classes.
# Each class = one table. Each attribute = one column.
# ---------------------------------------------------------

# DeclarativeBase: parent class for all tables
# Mapped: label saying "this column holds this Python type"
# mapped_column: extra settings for a column (primary key, default...)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from sqlalchemy import ForeignKey, UniqueConstraint, LargeBinary   # ForeignKey: "this column points at a row in another table"
from datetime import date, datetime                   # date: a calendar day; datetime: a day + a time


# Base: every table class inherits from this, so SQLAlchemy can find them all
# (database.py uses Base.metadata.create_all to build them).
class Base(DeclarativeBase):
    pass


# User: one account. Everything else (items, settings, savings) belongs to a user.
class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(unique=True)           # unique=True: two accounts can't share an email
    hashed_password: Mapped[str | None]                       # the BLENDED password. None = Google-only account
    name: Mapped[str] = mapped_column(default="")             # "Hi Xander": what RoomFund calls you
    google_sub: Mapped[str | None] = mapped_column(unique=True)   # Google's id for you, if you used "Continue with Google"
    token_version: Mapped[int] = mapped_column(default=0)     # +1 on password reset → every old login token stops working


# Room: the room you planned (in ChatGPT) and imported (ONE per user, optional).
class Room(Base):
    __tablename__ = "rooms"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), unique=True)   # unique: one room per user
    name: Mapped[str]                                         # e.g. "My bedroom"
    width_cm: Mapped[int | None]                              # optional room size (for the floor plan later)
    length_cm: Mapped[int | None]
    created_at: Mapped[datetime | None] = mapped_column(default=datetime.now)


# Item: one thing you want for your room (one row in the "items" table).
class Item(Base):
    __tablename__ = "items"                                   # the table's name inside SQLite

    id: Mapped[int] = mapped_column(primary_key=True)         # unique number per row, given by the database
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))   # WHO owns this item
    name: Mapped[str]                                         # required text
    status: Mapped[str] = mapped_column(default="wanted")     # wanted / saving / bought; starts as "wanted"
    width_cm: Mapped[int | None]                              # optional: footprint width (floor plan)
    depth_cm: Mapped[int | None]                              # optional: footprint depth (floor plan)
    height_cm: Mapped[int | None]                             # optional: how tall (cm), used later for the fit check
    price: Mapped[int]                                        # whole naira, required
    priority: Mapped[str]                                     # high / medium / low (Pydantic enforces this)
    monthly_price_increase_pct: Mapped[float | None] = mapped_column(default=0.0)  # inflation per month, %
    notes: Mapped[str | None]                                 # optional notes, e.g. "6 inch foam" (search looks here too)
    photo_url: Mapped[str | None]                             # one photo per item, e.g. "/uploads/item_3_ab12.jpg"
    bought_price: Mapped[int | None]                          # what you REALLY paid (for "Bought for ₦175,000")
    bought_on: Mapped[date | None]                            # the day you bought it
    room_id: Mapped[int | None] = mapped_column(ForeignKey("rooms.id"))   # set when it came from a room import


# ItemPhoto: the photo itself (the picture's bytes), stored IN the database.
# Online, Render forgets files on every restart, so photos can't live in a folder there.
# After resizing (max 1200px) a photo is small, so the database holds them easily.
class ItemPhoto(Base):
    __tablename__ = "item_photos"

    id: Mapped[int] = mapped_column(primary_key=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("items.id"), unique=True)   # one photo per item
    token: Mapped[str]                                        # random part of the address: /photos/3/ab12cd34
    content_type: Mapped[str]                                 # "image/jpeg", "image/png" or "image/webp"
    data: Mapped[bytes] = mapped_column(LargeBinary)          # the picture itself


# Settings: one row PER USER holding their savings info.
class Settings(Base):
    __tablename__ = "settings"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), unique=True)   # unique: ONE settings row per user
    saved_so_far: Mapped[int] = mapped_column(default=0)      # naira saved so far
    monthly_savings: Mapped[int] = mapped_column(default=0)   # naira you save each month
    show_room_tab: Mapped[bool] = mapped_column(default=False)  # the optional "My Room" tab: off unless you switch it on
    list_density: Mapped[str] = mapped_column(default="moderate")   # compact / moderate / comfortable


# PriceCheck: one price you SAW for an item, somewhere, on some day (one row in "price_checks").
# One item can have many price checks: like a notebook page per item, one line per price seen.
# No user_id here: a price check belongs to an item, and the ITEM knows its owner.
class PriceCheck(Base):
    __tablename__ = "price_checks"

    id: Mapped[int] = mapped_column(primary_key=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("items.id"))   # WHICH item this price is for (its id)
    price: Mapped[int]                                             # whole naira you saw
    checked_on: Mapped[date]                                       # the day you saw it
    source: Mapped[str]                                            # where: "Jumia", "Jiji", "market"...
    link: Mapped[str | None]                                       # optional web link to the listing


# SavingsLog: one time you put money aside ("I saved ₦10,000 today").
# Used for the streak (weeks in a row) and badges.
class SavingsLog(Base):
    __tablename__ = "savings_logs"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))   # WHO saved it
    amount: Mapped[int]                                            # whole naira saved this time
    saved_on: Mapped[date]                                         # the day you saved it
    source: Mapped[str] = mapped_column(default="saved")           # "saved" (by hand) or "payday" (a payday check-in)


# PaySchedule: how and when money comes in (Settings → Money → Payday). One per user.
class PaySchedule(Base):
    __tablename__ = "pay_schedules"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), unique=True)
    frequency: Mapped[str]                                         # weekly / biweekly / monthly / irregular
    next_payday: Mapped[date | None]                               # the next payday we haven't asked about yet
    amount: Mapped[int | None]                                     # what you save from each payday (None if irregular)


# Payday: one payday we asked (or will ask) "did your money land?" about.
class Payday(Base):
    __tablename__ = "paydays"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    expected_date: Mapped[date]
    status: Mapped[str] = mapped_column(default="pending")         # pending / received / rescheduled / skipped
    rescheduled_to: Mapped[date | None]
    amount_received: Mapped[int | None]
    answered_at: Mapped[datetime | None]                           # when you first answered (any answer counts for Payday Pro)


# UserBadge: a badge you've earned, and when. Badges are never taken away.
class UserBadge(Base):
    __tablename__ = "user_badges"
    __table_args__ = (UniqueConstraint("user_id", "key"),)        # each badge only once per user

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    key: Mapped[str]                                               # e.g. "first_naira"
    earned_at: Mapped[datetime] = mapped_column(default=datetime.now)


# PasswordReset: a "set a new password" link. We store only a HASH of the secret token.
class PasswordReset(Base):
    __tablename__ = "password_resets"

    id: Mapped[int] = mapped_column(primary_key=True)
    token_hash: Mapped[str] = mapped_column(unique=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    expires_at: Mapped[datetime]                                   # 30 minutes after it was made
    used_at: Mapped[datetime | None]
