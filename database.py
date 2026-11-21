import os
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import sessionmaker
from models import Base
import env  # noqa: F401  (reads the .env file first, so DATABASE_URL below can come from it)


# Where the database lives:
#   - online (Render): DATABASE_URL = Neon's Postgres address, set in Render's settings
#   - on my laptop:    no DATABASE_URL → the SQLite file "roomfund.db" in this folder
DATABASE_URL = os.environ.get("DATABASE_URL") or "sqlite:///roomfund.db"
# Safety: Render forgets files on every restart, so a SQLite file there would quietly lose
# everyone's data. Render always sets RENDER=true, so if we're on Render without a real
# database address, stop with a clear message instead.
if os.environ.get("RENDER") and DATABASE_URL.startswith("sqlite"):
    raise RuntimeError("DATABASE_URL is missing on Render. Add your Neon connection string in Render → Environment.")
# Neon gives "postgresql://..."; SQLAlchemy needs to know which driver to use (psycopg).
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = "postgresql://" + DATABASE_URL[len("postgres://"):]
if DATABASE_URL.startswith("postgresql://"):
    DATABASE_URL = "postgresql+psycopg://" + DATABASE_URL[len("postgresql://"):]
IS_SQLITE = DATABASE_URL.startswith("sqlite")

# the engine: our app's connection to the database, made once
engine = create_engine(
    DATABASE_URL,
    # SQLite only: let FastAPI's threads share the file
    connect_args={"check_same_thread": False} if IS_SQLITE else {},
    # Neon closes idle connections (it sleeps after 5 min): test each one before using it
    pool_pre_ping=not IS_SQLITE,
)

#this is the session maker, it is a class used in creating sessions
SessionLocal = sessionmaker(bind=engine)

#this creates the tables in the database if they don't already exist
Base.metadata.create_all(engine)


# --- Migrations ---------------------------------------------------------
# create_all only makes MISSING TABLES. It never changes a table that already
# exists. So when we add a column to an old table, we add it ourselves here,
# instead of wiping the whole database.

# New columns for tables that already existed: table → [(column, SQL type + default)]
NEW_COLUMNS = {
    "settings": [
        ("show_room_tab", "BOOLEAN NOT NULL DEFAULT 0"),
        ("list_density", "VARCHAR NOT NULL DEFAULT 'moderate'"),
    ],
    "items": [
        ("notes", "VARCHAR"),
        ("photo_url", "VARCHAR"),
        ("bought_price", "INTEGER"),
        ("bought_on", "DATE"),
        ("room_id", "INTEGER REFERENCES rooms(id)"),
    ],
    "rooms": [
        ("created_at", "DATETIME"),
    ],
    "savings_logs": [
        ("source", "VARCHAR NOT NULL DEFAULT 'saved'"),
    ],
}


def add_missing_columns():
    for table, columns in NEW_COLUMNS.items():
        existing = [c["name"] for c in inspect(engine).get_columns(table)]
        for name, sql_type in columns:
            if name not in existing:
                with engine.begin() as conn:     # begin(): runs it and saves it in one go
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {name} {sql_type}"))


# The users table needs bigger changes: hashed_password must be ALLOWED to be empty
# (Google-only accounts have no password), plus 3 new columns. SQLite can't change
# a column like that, so we do SQLite's official recipe: build a new table, copy the
# rows across, drop the old one, rename the new one.
def upgrade_users_table():
    columns = {c["name"]: c for c in inspect(engine).get_columns("users")}
    if "google_sub" in columns:
        return                                   # already upgraded
    with engine.begin() as conn:
        conn.execute(text("""
            CREATE TABLE users_new (
                id INTEGER NOT NULL PRIMARY KEY,
                email VARCHAR NOT NULL UNIQUE,
                hashed_password VARCHAR,
                name VARCHAR NOT NULL DEFAULT '',
                google_sub VARCHAR UNIQUE,
                token_version INTEGER NOT NULL DEFAULT 0
            )"""))
        # Existing accounts get a name from their email: "ade@mail.com" → "ade"
        conn.execute(text("""
            INSERT INTO users_new (id, email, hashed_password, name, google_sub, token_version)
            SELECT id, email, hashed_password, substr(email, 1, instr(email, '@') - 1), NULL, 0
            FROM users"""))
        conn.execute(text("DROP TABLE users"))
        conn.execute(text("ALTER TABLE users_new RENAME TO users"))


# Only my old SQLite file needs upgrading. A new Postgres database (Neon) gets every
# table and column straight from create_all above.
if IS_SQLITE:
    upgrade_users_table()
    add_missing_columns()


#this is a function that creates a session, pauses it and then closes it when done
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
