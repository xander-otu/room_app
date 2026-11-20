# ---------------------------------------------------------
# models.py: the database tables, written as Python classes.
# Each class = one table. Each attribute = one column.
# ---------------------------------------------------------

# DeclarativeBase: parent class for all tables
# Mapped: label saying "this column holds this Python type"
# mapped_column: extra settings for a column (primary key, default...)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from sqlalchemy import ForeignKey   # ForeignKey: "this column points at a row in another table"
from datetime import date           # date: a calendar day like 2026-11-20 (no time)


# Base: every table class inherits from this, so SQLAlchemy can find them all
# (database.py uses Base.metadata.create_all to build them).
class Base(DeclarativeBase):
    pass


# User: one account. Everything else (items, settings, savings) belongs to a user.
class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(unique=True)           # unique=True: two accounts can't share an email
    hashed_password: Mapped[str]                              # the BLENDED password, never the real one


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


# Settings: one row PER USER holding their savings info.
class Settings(Base):
    __tablename__ = "settings"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), unique=True)   # unique: ONE settings row per user
    saved_so_far: Mapped[int] = mapped_column(default=0)      # naira saved so far
    monthly_savings: Mapped[int] = mapped_column(default=0)   # naira you save each month


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
