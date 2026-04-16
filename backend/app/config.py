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

    @property
    def DB_URL(self):
        return f"mysql+pymysql://{self.DB_USER}:{self.DB_PASSWORD}@{self.DB_HOST}:{self.DB_PORT}/{self.DB_NAME}"

settings = Settings()