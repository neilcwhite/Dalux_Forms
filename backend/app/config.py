"""Configuration loader - reads .env file at startup."""
from dotenv import load_dotenv
import os

load_dotenv()

class Settings:
    DB_HOST = os.getenv("DB_HOST")
    DB_PORT = int(os.getenv("DB_PORT", 3306))
    DB_USER = os.getenv("DB_USER")
    DB_PASSWORD = os.getenv("DB_PASSWORD")
    DB_NAME = os.getenv("DB_NAME", "SHEQ")
    DALUX_API_KEY = os.getenv("DALUX_API_KEY")
    DALUX_BASE_URL = os.getenv("DALUX_BASE_URL")
    APP_NAME = os.getenv("APP_NAME", "Dalux Report Portal")
    DEBUG = os.getenv("DEBUG", "false").lower() == "true"

    # Teams notifications (Power Automate HTTP trigger)
    NOTIFY_POWER_AUTOMATE_URL = os.getenv("NOTIFY_POWER_AUTOMATE_URL", "")
    APP_PUBLIC_URL = os.getenv("APP_PUBLIC_URL", "http://localhost:8000")
    NOTIFY_ENABLED = os.getenv("NOTIFY_ENABLED", "false").lower() == "true"

    # Admin template upload — gates POST /api/admin/templates/upload
    # Empty/unset = feature disabled (endpoint returns 503).
    ADMIN_UPLOAD_TOKEN = os.getenv("ADMIN_UPLOAD_TOKEN", "")

    # Bootstrap admin emails — comma-separated. All seeded as 'admin' on
    # first startup if approved_users table is empty. Each gets the password
    # set in INITIAL_ADMIN_PASSWORD; they can change it after first login.
    INITIAL_ADMIN_EMAILS = os.getenv(
        "INITIAL_ADMIN_EMAILS",
        "neil.white@thespencergroup.co.uk,claire.ransom@thespencergroup.co.uk",
    )
    INITIAL_ADMIN_PASSWORD = os.getenv("INITIAL_ADMIN_PASSWORD", "Dalux")

    @property
    def DB_URL(self):
        return f"mysql+pymysql://{self.DB_USER}:{self.DB_PASSWORD}@{self.DB_HOST}:{self.DB_PORT}/{self.DB_NAME}"

settings = Settings()