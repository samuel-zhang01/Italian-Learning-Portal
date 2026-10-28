# Python 3.13 slim-bookworm, resolved for the private 2026-10-28 release.
FROM python@sha256:281d39ff02e3b389401586134ff9e6572954687822a58055ec07a60ded4e0b7f
WORKDIR /app
COPY --chown=10001:10001 profile_api.py /app/profile_api.py
USER 10001:10001
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
EXPOSE 5198
ENTRYPOINT ["python3", "-I", "-B", "/app/profile_api.py"]
CMD ["--host", "0.0.0.0", "--port", "5198"]
