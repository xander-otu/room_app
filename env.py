# ---------------------------------------------------------
# env.py: reads the .env file (on my laptop) into the environment.
# Online (Render), there's no .env file: the same settings are typed
# into Render's "Environment" page instead, so this just does nothing.
# Import it first wherever a setting like SECRET_KEY or DATABASE_URL is read.
# ---------------------------------------------------------
import os


def load_env_file(path=".env"):
    if os.path.exists(path):
        with open(path) as f:                       # with: opens the file and closes it when done
            for line in f:
                line = line.strip()
                if "=" in line and not line.startswith("#"):
                    name, value = line.split("=", 1)           # split at the FIRST "=" only
                    name = name.strip()                        # allow "NAME = value" (spaces around =)
                    value = value.strip().strip('"').strip("'")   # allow quotes: NAME="value"
                    if name:
                        os.environ.setdefault(name, value)     # a real setting always wins over the file


load_env_file()
