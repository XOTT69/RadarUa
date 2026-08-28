FROM python:3.13-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY parser.py bridge.py login.py ./
RUN mkdir -p /data
VOLUME ["/data"]
CMD ["python", "bridge.py"]
