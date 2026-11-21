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


# create_all only makes MISSING TABLES. It never adds a new column to a table that
# already exists. So for small additions we add the column ourselves, instead of
# wiping the whole database. (This is called a "migration".)
def add_missing_columns():
    settings_columns = [c["name"] for c in inspect(engine).get_columns("settings")]
    if "show_room_tab" not in settings_columns:
        with engine.begin() as conn:     # begin(): runs it and saves it in one go
            conn.execute(text("ALTER TABLE settings ADD COLUMN show_room_tab BOOLEAN NOT NULL DEFAULT 0"))

add_missing_columns()

#this is a function that creates a session, pauses it and then closes it when done 
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally: 
        db.close()