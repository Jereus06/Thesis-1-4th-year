FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 10001 stockcast
COPY backend/requirements-lock.txt /app/backend/requirements-lock.txt
RUN sed 's/^xgboost==/xgboost-cpu==/' backend/requirements-lock.txt > /tmp/requirements.txt \
    && pip install --no-cache-dir -r /tmp/requirements.txt
COPY backend /app/backend
RUN pip install --no-cache-dir --no-deps ./backend \
    && mkdir -p /app/data/models && chown -R stockcast:stockcast /app/data
USER stockcast
EXPOSE 3001
CMD ["python", "-m", "uvicorn", "backend.app.main:app", "--host", "0.0.0.0", "--port", "3001"]
