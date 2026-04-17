# Multi-stage build: backend (Python + WeasyPrint + GTK3)
FROM python:3.14-slim-bookworm AS backend-base

# Install system dependencies for WeasyPrint (GTK3 + libraries)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgtk-3-0 \
    libpango-1.0-0 \
    libpangoft2-1.0-0 \
    libcairo2 \
    libgdk-pixbuf-2.0-0 \
    libffi8 \
    libharfbuzz0b \
    shared-mime-info \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app/backend

# Copy requirements and install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend source code
COPY . .

# Expose backend port
EXPOSE 8000

# Start backend with uvicorn
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
