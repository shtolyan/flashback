FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 HF_HUB_DISABLE_TELEMETRY=1
COPY apps/whisper/wheels/ /wheels/
COPY apps/whisper/requirements.txt /requirements.txt
RUN cd /wheels && sha256sum -c SHA256SUMS && pip install --no-cache-dir --no-index --find-links=/wheels -r /requirements.txt && rm -rf /wheels
WORKDIR /app
COPY apps/whisper/server.py /app/server.py
EXPOSE 4320
CMD ["python","server.py"]
