from sqlalchemy import create_engine
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

#this is a function that creates a session, pauses it and then closes it when done 
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally: 
        db.close()