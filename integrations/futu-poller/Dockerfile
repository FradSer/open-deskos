# syntax=docker/dockerfile:1
FROM ghcr.io/astral-sh/uv:0.11.18@sha256:78bc42400d77b0678ba95765305c826652ed5431f399257271dda681d0318f03 AS uv
FROM python:3.12.11-slim-bookworm@sha256:519591d6871b7bc437060736b9f7456b8731f1499a57e22e6c285135ae657bf7
COPY --from=uv /uv /usr/local/bin/uv
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 UV_PYTHON_DOWNLOADS=never
WORKDIR /app
COPY pyproject.toml uv.lock .python-version ./
RUN uv sync --locked --no-dev --no-install-project
COPY poller.py plugin_host.py plugin_config.py plugin_control.py management_channel.py development_plugins.py healthcheck.py ./
RUN groupadd --gid 1000 odk && useradd --uid 1000 --gid 1000 --create-home odk
ENV PATH="/app/.venv/bin:$PATH" ODK_FUTU_CONTROL=/run/odk-futu/control.sock
USER 1000:1000
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s CMD ["python", "/app/healthcheck.py"]
ENTRYPOINT ["python", "/app/poller.py"]
