from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import sessionmaker
from models import Base


#this is where the database lives, ":/// means 'in this very folder'"
DATABASE_URL = "sqlite:///roomfund.db"

# the engine: our app's connection to the database file, made once
engine = create_engine(
    DATABASE_URL,
    connect_args= {"check_same_thread": False},
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


upgrade_users_table()
add_missing_columns()


#this is a function that creates a session, pauses it and then closes it when done
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
