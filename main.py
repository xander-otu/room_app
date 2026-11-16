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
from models import Item, Settings                     # the database table classes
from sqlalchemy import select                         # select: builds a "fetch rows" query
from timeline import arrange_items, buy_timeline

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