FROM python:3.11-alpine
RUN adduser -S app
USER app
WORKDIR /app
RUN pip install paho-mqtt
COPY publish.py .
CMD ["python", "publish.py"]
