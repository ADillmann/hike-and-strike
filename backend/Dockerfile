FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app ./app
COPY seed.py .
RUN mkdir -p uploads data
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "7500"]
