# ---------------------------------------------------------
# models.py: the database tables, written as Python classes.
# Each class = one table. Each attribute = one column.
# ---------------------------------------------------------

# DeclarativeBase: parent class for all tables
# Mapped: label saying "this column holds this Python type"
# mapped_column: extra settings for a column (primary key, default...)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


# Base: every table class inherits from this, so SQLAlchemy can find them all
# (database.py uses Base.metadata.create_all to build them).
class Base(DeclarativeBase):
    pass


# Item: one thing you want for your room (one row in the "items" table).
class Item(Base):
    __tablename__ = "items"                                   # the table's name inside SQLite

    id: Mapped[int] = mapped_column(primary_key=True)         # unique number per row, given by the database
    name: Mapped[str]                                         # required text
    status: Mapped[str] = mapped_column(default="wanted")     # wanted / saving / bought; starts as "wanted"
    width_cm: Mapped[int | None]                              # optional: footprint width (floor plan)
    depth_cm: Mapped[int | None]                              # optional: footprint depth (floor plan)
    height_cm: Mapped[int | None]                             # optional: how tall (cm), used later for the fit check
    price: Mapped[int]                                        # whole naira, required
    priority: Mapped[str]                                     # high / medium / low (Pydantic enforces this)
    monthly_price_increase_pct: Mapped[float | None] = mapped_column(default=0.0)  # inflation per month, %


# Settings: one row holding your savings info.
# (Becomes one row PER USER in Phase 6.5.)
class Settings(Base):
    __tablename__ = "settings"

    id: Mapped[int] = mapped_column(primary_key=True)
    saved_so_far: Mapped[int] = mapped_column(default=0)      # naira saved so far
    monthly_savings: Mapped[int] = mapped_column(default=0)   # naira you save each month
