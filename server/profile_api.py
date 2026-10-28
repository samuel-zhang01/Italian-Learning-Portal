"""Small same-origin profile service. Run behind the site's HTTPS reverse proxy.

Only learning records live in this database. Course files, private material and
legacy learner databases are deliberately outside this service.
"""
from __future__ import annotations

import argparse
from contextlib import contextmanager
from dataclasses import dataclass
import hashlib
import hmac
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import ipaddress
import json
import math
import os
from pathlib import Path
import re
import secrets
import sqlite3
import stat
import threading
import time
from urllib.parse import urlsplit

PREFIX = "/api/profile"
MAX_PROGRESS_BYTES = 8_000_000
MAX_REQUEST_BYTES = MAX_PROGRESS_BYTES + 2048
SESSION_SECONDS = 30 * 24 * 60 * 60
SCRYPT_N, SCRYPT_R, SCRYPT_P = 32768, 8, 3
USERNAME = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]{2,31}\Z")
PIN = re.compile(r"[0-9]{6}\Z")
COMMON_PINS = {str(i) * 6 for i in range(10)} | {
    "012345", "123456", "234567", "345678", "456789", "987654", "876543", "765432", "654321", "543210"
}


class ApiError(Exception):
    def __init__(self, status: int, code: str, **extra):
        self.status, self.code, self.extra = status, code, extra


@dataclass(frozen=True)
class Config:
    database: Path
    pepper_file: Path
    origin: str = "https://italian.samuelzhang.co.uk"
    trusted_proxies: tuple[str, ...] = ()
    development: bool = False
    max_profiles: int = 100
    account_attempts: int = 5
    ip_attempts: int = 30
    registration_attempts: int = 10
    auth_window: int = 900
    clock: object = time.time

    @property
    def cookie_name(self):
        return "parliamo-profile-dev" if self.development else "__Host-parliamo-profile"


def load_pepper(path: Path) -> bytes:
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_mode & 0o077:
            raise ValueError("Private pepper file must be a regular owner-only file")
        data = os.read(fd, 65)
        if len(data) != 32:
            raise ValueError("Private pepper file must contain exactly 32 random bytes")
        return data
    finally:
        os.close(fd)


def parse_json(raw: bytes):
    def constant(_):
        raise ValueError("non-finite number")

    def pairs(items):
        out = {}
        for key, value in items:
            if key in out or key in {"__proto__", "constructor", "prototype"}:
                raise ValueError("duplicate or reserved key")
            out[key] = value
        return out

    return json.loads(raw, parse_constant=constant, object_pairs_hook=pairs)


def progress_json(value) -> str:
    if not isinstance(value, dict) or type(value.get("version")) is not int or value["version"] != 1:
        raise ApiError(400, "invalid-progress")
    if value.get("language") not in {"en", "it"} or type(value.get("translations")) is not bool:
        raise ApiError(400, "invalid-progress")
    for key in ("plan", "completed", "drafts", "reviews"):
        if not isinstance(value.get(key), dict):
            raise ApiError(400, "invalid-progress")
    if not isinstance(value.get("reviewLog"), list) or not isinstance(value.get("notes"), str) or not isinstance(value.get("updatedAt"), str):
        raise ApiError(400, "invalid-progress")
    # The browser additionally validates the current course catalogue and every
    # activity schema. The service validates a bounded JSON envelope, not grades.
    def bounded(node, depth=0):
        if depth > 48:
            raise ApiError(400, "invalid-progress")
        if isinstance(node, dict):
            if len(node) > 10000 or any(not isinstance(key, str) or len(key) > 500 or key in {"__proto__", "constructor", "prototype"} for key in node):
                raise ApiError(400, "invalid-progress")
            for child in node.values():
                bounded(child, depth + 1)
        elif isinstance(node, list):
            if len(node) > 10000:
                raise ApiError(400, "invalid-progress")
            for child in node:
                bounded(child, depth + 1)
        elif isinstance(node, float) and not math.isfinite(node):
            raise ApiError(400, "invalid-progress")
    bounded(value)
    encoded = json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
    if len(encoded.encode("utf-8")) > MAX_PROGRESS_BYTES:
        raise ApiError(413, "progress-too-large")
    return encoded


class Store:
    def __init__(self, config: Config):
        self.config = config
        self.pepper = load_pepper(config.pepper_file)
        origin = urlsplit(config.origin)
        if origin.path not in {"", "/"} or origin.query or origin.fragment or origin.username or origin.password:
            raise ValueError("Origin must be an exact scheme and host")
        if config.development:
            if origin.scheme != "http" or origin.hostname not in {"127.0.0.1", "localhost", "::1"}:
                raise ValueError("Development origin must be local HTTP")
        elif origin.scheme != "https" or not origin.hostname:
            raise ValueError("Production origin must use HTTPS")
        if config.origin.endswith("/"):
            raise ValueError("Origin must not include a trailing slash")
        for proxy in config.trusted_proxies:
            ipaddress.ip_address(proxy)
        config.database.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        if config.database.is_symlink():
            raise ValueError("Database must not be a symlink")
        with self.connection() as connection:
            connection.executescript("""
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS profiles (
                    username_key TEXT PRIMARY KEY,
                    display_name TEXT NOT NULL,
                    salt BLOB NOT NULL,
                    pin_hash BLOB NOT NULL,
                    created INTEGER NOT NULL,
                    progress TEXT,
                    revision INTEGER NOT NULL DEFAULT 0,
                    updated INTEGER NOT NULL
                );
                CREATE TABLE IF NOT EXISTS sessions (
                    token_hash BLOB PRIMARY KEY,
                    username_key TEXT NOT NULL REFERENCES profiles(username_key) ON DELETE CASCADE,
                    created INTEGER NOT NULL,
                    expires INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS sessions_user ON sessions(username_key);
                CREATE TABLE IF NOT EXISTS limits (
                    bucket BLOB PRIMARY KEY,
                    started INTEGER NOT NULL,
                    attempts INTEGER NOT NULL
                );
            """)
        os.chmod(config.database, 0o600)
        self.kdf_slots = threading.BoundedSemaphore(2)
        self.dummy_salt = hmac.digest(self.pepper, b"nonexistent-profile-salt", "sha256")[:16]
        self.dummy_hash = self.pin_hash("582941", self.dummy_salt)

    @contextmanager
    def connection(self, transaction=False):
        connection = sqlite3.connect(self.config.database, timeout=10, isolation_level=None)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys=ON")
        try:
            if transaction:
                connection.execute("BEGIN IMMEDIATE")
            yield connection
            if transaction:
                connection.commit()
        except BaseException:
            if transaction:
                connection.rollback()
            raise
        finally:
            connection.close()

    def now(self):
        return int(self.config.clock())

    def pin_hash(self, pin: str, salt: bytes) -> bytes:
        with self.kdf_slots:
            mixed = hmac.digest(self.pepper, b"pin-v1:" + pin.encode("ascii"), "sha256")
            return hashlib.scrypt(mixed, salt=salt, n=SCRYPT_N, r=SCRYPT_R, p=SCRYPT_P,
                                  dklen=32, maxmem=64 * 1024 * 1024)

    def bucket(self, label):
        return hmac.digest(self.pepper, label.encode("utf-8"), "sha256")

    def rate_limit(self, client: str, username: str, register=False):
        now = self.now()
        checks = [(f"auth-ip:{client}", self.config.ip_attempts, self.config.auth_window),
                  (f"auth-user:{username}", self.config.account_attempts, self.config.auth_window)]
        if register:
            checks.append((f"register-ip:{client}", self.config.registration_attempts, 3600))
        with self.connection(transaction=True) as connection:
            connection.execute("DELETE FROM limits WHERE started < ?", (now - 3600,))
            if connection.execute("SELECT COUNT(*) FROM limits").fetchone()[0] > 10000:
                raise ApiError(429, "try-later", retryAfter=900)
            for label, limit, window in checks:
                key = self.bucket(label)
                row = connection.execute("SELECT started, attempts FROM limits WHERE bucket=?", (key,)).fetchone()
                if row and now < row["started"] + window and row["attempts"] >= limit:
                    raise ApiError(429, "try-later", retryAfter=max(1, row["started"] + window - now))
            for label, _, window in checks:
                key = self.bucket(label)
                connection.execute("""INSERT INTO limits(bucket,started,attempts) VALUES(?,?,1)
                    ON CONFLICT(bucket) DO UPDATE SET
                    started=CASE WHEN started+?<=? THEN excluded.started ELSE started END,
                    attempts=CASE WHEN started+?<=? THEN 1 ELSE attempts+1 END""",
                    (key, now, window, now, window, now))

    def clear_account_limit(self, username):
        with self.connection() as connection:
            connection.execute("DELETE FROM limits WHERE bucket=?", (self.bucket(f"auth-user:{username}"),))

    def new_session(self, connection, username):
        token = secrets.token_urlsafe(32)
        digest = hashlib.sha256(token.encode("ascii")).digest()
        now = self.now()
        connection.execute("DELETE FROM sessions WHERE expires<=?", (now,))
        # Bound retained sessions without evicting the new session on ties.
        connection.execute("""DELETE FROM sessions WHERE username_key=? AND token_hash NOT IN
            (SELECT token_hash FROM sessions WHERE username_key=? ORDER BY created DESC LIMIT 9)""", (username, username))
        connection.execute("INSERT INTO sessions VALUES(?,?,?,?)", (digest, username, now, now + SESSION_SECONDS))
        return token

    def authenticate(self, username, pin, client, register=False):
        if not isinstance(username, str) or not isinstance(pin, str):
            raise ApiError(400, "invalid-credentials")
        display = username.strip()
        key = display.lower()
        if not USERNAME.fullmatch(display) or not PIN.fullmatch(pin):
            raise ApiError(400, "invalid-credentials")
        self.rate_limit(client, key, register)
        if register and pin in COMMON_PINS:
            raise ApiError(400, "choose-stronger-pin")
        with self.connection() as connection:
            row = connection.execute("SELECT * FROM profiles WHERE username_key=?", (key,)).fetchone()
        salt = secrets.token_bytes(16) if register else row["salt"] if row else self.dummy_salt
        digest = self.pin_hash(pin, salt)
        if not register and not hmac.compare_digest(digest, row["pin_hash"] if row else self.dummy_hash):
            raise ApiError(401, "invalid-credentials")
        if not register and row is None:
            raise ApiError(401, "invalid-credentials")
        with self.connection(transaction=True) as connection:
            if register:
                count = connection.execute("SELECT COUNT(*) FROM profiles").fetchone()[0]
                if row is not None or count >= self.config.max_profiles:
                    raise ApiError(400, "profile-unavailable")
                try:
                    connection.execute("INSERT INTO profiles(username_key,display_name,salt,pin_hash,created,updated) VALUES(?,?,?,?,?,?)",
                                       (key, display, salt, digest, self.now(), self.now()))
                except sqlite3.IntegrityError:
                    raise ApiError(400, "profile-unavailable") from None
            token = self.new_session(connection, key)
        self.clear_account_limit(key)
        return {"username": display if register else row["display_name"]}, token

    def session(self, token):
        if not isinstance(token, str) or not re.fullmatch(r"[A-Za-z0-9_-]{43}", token):
            raise ApiError(401, "sign-in-required")
        digest = hashlib.sha256(token.encode("ascii")).digest()
        with self.connection() as connection:
            row = connection.execute("""SELECT p.username_key,p.display_name FROM profiles p
                JOIN sessions s ON s.username_key=p.username_key WHERE s.token_hash=? AND s.expires>?""",
                (digest, self.now())).fetchone()
        if row is None:
            raise ApiError(401, "sign-in-required")
        return row["username_key"], row["display_name"]

    def logout(self, token):
        if isinstance(token, str):
            digest = hashlib.sha256(token.encode("utf-8")).digest()
            with self.connection() as connection:
                connection.execute("DELETE FROM sessions WHERE token_hash=?", (digest,))

    def progress(self, username):
        with self.connection() as connection:
            row = connection.execute("SELECT display_name,progress,revision FROM profiles WHERE username_key=?", (username,)).fetchone()
        return {"username": row["display_name"], "revision": row["revision"], "progress": json.loads(row["progress"]) if row["progress"] is not None else None}

    def save_progress(self, username, revision, progress):
        if type(revision) is not int or not 0 <= revision <= 2**53 - 2:
            raise ApiError(400, "invalid-revision")
        encoded = progress_json(progress)
        with self.connection(transaction=True) as connection:
            changed = connection.execute("UPDATE profiles SET progress=?,revision=revision+1,updated=? WHERE username_key=? AND revision=?",
                                         (encoded, self.now(), username, revision)).rowcount
            if not changed:
                current = connection.execute("SELECT revision FROM profiles WHERE username_key=?", (username,)).fetchone()[0]
                raise ApiError(409, "conflict", revision=current)
        return {"revision": revision + 1}


class ProfileServer(ThreadingHTTPServer):
    daemon_threads = True
    request_queue_size = 16

    def __init__(self, address, store: Store):
        self.store = store
        self.slots = threading.BoundedSemaphore(16)
        super().__init__(address, Handler)

    def process_request(self, request, client_address):
        if not self.slots.acquire(blocking=False):
            self.shutdown_request(request)
            return
        try:
            super().process_request(request, client_address)
        except BaseException:
            self.slots.release()
            raise

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            self.slots.release()

    def handle_error(self, _request, _client_address):
        # Never emit request paths, headers, records, PINs or session cookies.
        pass


class Handler(BaseHTTPRequestHandler):
    server_version = "Parliamo"
    sys_version = ""
    protocol_version = "HTTP/1.1"

    def setup(self):
        super().setup()
        self.connection.settimeout(15)

    def log_message(self, _format, *_args):
        pass

    def send_error(self, code, message=None, explain=None):
        self.respond(code, {"error": "invalid-request"})

    def respond(self, status, body, token=None, clear=False):
        encoded = json.dumps(body, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Pragma", "no-cache")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Cross-Origin-Resource-Policy", "same-origin")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Vary", "Cookie")
        self.send_header("Connection", "close")
        if body.get("error") == "try-later":
            self.send_header("Retry-After", str(body["retryAfter"]))
        if token is not None or clear:
            config = self.server.store.config
            secure = "" if config.development else "; Secure"
            self.send_header("Set-Cookie", f"{config.cookie_name}={token or ''}; Path=/; Max-Age={0 if clear else SESSION_SECONDS}; HttpOnly; SameSite=Strict{secure}")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(encoded)
        self.close_connection = True

    def client_ip(self):
        peer = self.client_address[0]
        if peer in self.server.store.config.trusted_proxies:
            forwarded = self.headers.get_all("X-Real-IP", [])
            if len(forwarded) == 1:
                try:
                    return str(ipaddress.ip_address(forwarded[0]))
                except ValueError:
                    pass
        return peer

    def read_body(self, limit):
        if self.headers.get("Transfer-Encoding") or len(self.headers.get_all("Content-Length", [])) != 1:
            raise ApiError(400, "invalid-request")
        length = self.headers.get("Content-Length", "")
        if not re.fullmatch(r"[0-9]{1,10}", length):
            raise ApiError(400, "invalid-request")
        if int(length) > limit:
            raise ApiError(413, "request-too-large")
        if self.headers.get("Content-Type", "").split(";", 1)[0].strip().lower() != "application/json":
            raise ApiError(415, "json-required")
        try:
            raw = self.rfile.read(int(length))
            if len(raw) != int(length):
                raise ValueError("incomplete")
            result = parse_json(raw)
        except (ValueError, UnicodeError, RecursionError):
            raise ApiError(400, "invalid-json") from None
        if not isinstance(result, dict):
            raise ApiError(400, "invalid-request")
        return result

    def cookie(self):
        raw = self.headers.get_all("Cookie", [])
        if len(raw) != 1 or len(raw[0]) > 8192:
            return None
        try:
            cookies = SimpleCookie()
            cookies.load(raw[0])
            name = self.server.store.config.cookie_name
            return cookies[name].value if name in cookies else None
        except Exception:
            return None

    def dispatch(self):
        try:
            parsed = urlsplit(self.path)
            if parsed.query or parsed.fragment or parsed.scheme or parsed.netloc:
                raise ApiError(400, "invalid-request")
            path = parsed.path
            store = self.server.store
            if self.command in {"POST", "PUT"}:
                origins = self.headers.get_all("Origin", [])
                if len(origins) != 1 or origins[0] != store.config.origin:
                    raise ApiError(403, "origin-not-allowed")
                if self.headers.get("Sec-Fetch-Site", "same-origin") not in {"same-origin", "none"}:
                    raise ApiError(403, "origin-not-allowed")
            elif self.headers.get("Origin") not in {None, store.config.origin}:
                raise ApiError(403, "origin-not-allowed")
            if path == f"{PREFIX}/health" and self.command == "GET":
                self.respond(200, {"ok": True})
                return
            if path in {f"{PREFIX}/register", f"{PREFIX}/login"} and self.command == "POST":
                payload = self.read_body(1024)
                if set(payload) != {"username", "pin"}:
                    raise ApiError(400, "invalid-credentials")
                body, token = store.authenticate(payload["username"], payload["pin"], self.client_ip(), path.endswith("/register"))
                self.respond(201 if path.endswith("/register") else 200, body, token)
                return
            if path == f"{PREFIX}/logout" and self.command == "POST":
                if self.read_body(32) != {}:
                    raise ApiError(400, "invalid-request")
                store.logout(self.cookie())
                self.respond(200, {"ok": True}, clear=True)
                return
            if path == f"{PREFIX}/me" and self.command == "GET":
                _, display = store.session(self.cookie())
                self.respond(200, {"username": display})
                return
            if path == f"{PREFIX}/progress" and self.command in {"GET", "PUT"}:
                username, _ = store.session(self.cookie())
                if self.command == "GET":
                    body = store.progress(username)
                else:
                    payload = self.read_body(MAX_REQUEST_BYTES)
                    if set(payload) != {"username", "revision", "progress"}:
                        raise ApiError(400, "invalid-request")
                    if not isinstance(payload["username"], str) or payload["username"].strip().lower() != username:
                        raise ApiError(409, "profile_changed")
                    body = store.save_progress(username, payload["revision"], payload["progress"])
                self.respond(200, body)
                return
            raise ApiError(404, "not-found")
        except ApiError as error:
            self.respond(error.status, {"error": error.code, **error.extra})
        except (BrokenPipeError, ConnectionResetError, TimeoutError):
            self.close_connection = True
        except Exception:
            self.respond(503, {"error": "temporarily-unavailable"})

    do_GET = dispatch
    do_POST = dispatch
    do_PUT = dispatch

    def do_OPTIONS(self):
        self.respond(405, {"error": "method-not-allowed"})

    do_DELETE = do_OPTIONS
    do_PATCH = do_OPTIONS
    do_HEAD = do_OPTIONS


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", type=Path, default=Path("/state/profiles.sqlite"))
    parser.add_argument("--pepper-file", type=Path, default=Path("/run/secrets/profile-pepper"))
    parser.add_argument("--origin", default="https://italian.samuelzhang.co.uk")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=5198)
    parser.add_argument("--trusted-proxy", action="append", default=[])
    parser.add_argument("--development", action="store_true", help="Local-only HTTP origin and cookie for disposable tests")
    args = parser.parse_args()
    if args.development and args.host not in {"127.0.0.1", "::1", "localhost"}:
        parser.error("Development mode must bind to loopback")
    os.umask(0o077)
    config = Config(args.database, args.pepper_file, args.origin, tuple(args.trusted_proxy), args.development)
    server = ProfileServer((args.host, args.port), Store(config))
    try:
        server.serve_forever(poll_interval=0.25)
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
