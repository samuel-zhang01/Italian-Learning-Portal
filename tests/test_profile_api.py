"""Disposable HTTP and SQLite tests; never reads a deployed learner database."""
import hashlib
import http.client
import importlib.util
import json
from pathlib import Path
import secrets
import sys
import tempfile
import threading
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("profile_api", ROOT / "server/profile_api.py")
api = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = api
spec.loader.exec_module(api)
ORIGIN = "https://italian.samuelzhang.co.uk"
PIN = "582947"


def progress(notes="Una frase."):
    return {"version": 1, "language": "en", "translations": True,
            "plan": {"minutes": 30, "days": [1, 2, 3, 4, 5], "start": "2026-10-28", "course": 1},
            "completed": {}, "drafts": {}, "reviews": {}, "reviewLog": [], "notes": notes,
            "updatedAt": "2026-10-28T12:00:00Z"}


class ProfileAPI(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="parliamo-profile-test-")
        self.root = Path(self.temporary.name)
        self.secret = self.root / "private-pepper"
        self.secret.write_bytes(secrets.token_bytes(32))
        self.secret.chmod(0o600)
        self.clock = [1_800_000_000]
        self.config = api.Config(self.root / "state/profiles.sqlite", self.secret,
                                 clock=lambda: self.clock[0])
        self.start()

    def start(self):
        self.store = api.Store(self.config)
        self.server = api.ProfileServer(("127.0.0.1", 0), self.store)
        self.thread = threading.Thread(target=self.server.serve_forever, kwargs={"poll_interval": 0.01}, daemon=True)
        self.thread.start()

    def stop(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=5)

    def tearDown(self):
        self.stop()
        self.temporary.cleanup()

    def request(self, method, path, body=None, cookie=None, headers=None, raw=None):
        supplied = {"Origin": ORIGIN}
        if body is not None or raw is not None:
            raw = json.dumps(body).encode() if raw is None else raw
            supplied["Content-Type"] = "application/json"
        if cookie:
            supplied["Cookie"] = cookie
        supplied.update(headers or {})
        supplied = {key: value for key, value in supplied.items() if value is not None}
        connection = http.client.HTTPConnection(*self.server.server_address, timeout=10)
        try:
            connection.request(method, "/api/profile" + path, body=raw, headers=supplied)
            response = connection.getresponse()
            payload = response.read()
            return response.status, dict(response.getheaders()), json.loads(payload) if payload else None
        finally:
            connection.close()

    def register(self, username="Samuel", pin=PIN):
        status, headers, body = self.request("POST", "/register", {"username": username, "pin": pin})
        self.assertEqual(status, 201, body)
        return headers["Set-Cookie"].split(";", 1)[0]

    def test_hash_cookie_and_response_do_not_expose_pin_or_session_secret(self):
        cookie = self.register()
        status, headers, body = self.request("POST", "/login", {"username": "sAMUEL", "pin": PIN})
        self.assertEqual(status, 200)
        self.assertEqual(body, {"username": "Samuel"})
        self.assertEqual(headers["Cache-Control"], "no-store")
        self.assertNotIn("Access-Control-Allow-Origin", headers)
        for flag in ("HttpOnly", "Secure", "SameSite=Strict", "Path=/", "__Host-parliamo-profile="):
            self.assertIn(flag, headers["Set-Cookie"])
        with self.store.connection() as connection:
            row = connection.execute("SELECT salt,pin_hash FROM profiles").fetchone()
            sessions = connection.execute("SELECT token_hash FROM sessions").fetchall()
        self.assertEqual(len(row["salt"]), 16)
        self.assertEqual(len(row["pin_hash"]), 32)
        self.assertNotEqual(row["pin_hash"], hashlib.sha256(PIN.encode()).digest())
        token = cookie.split("=", 1)[1]
        self.assertTrue(any(item[0] == hashlib.sha256(token.encode()).digest() for item in sessions))
        self.assertNotIn(PIN.encode(), self.config.database.read_bytes())
        self.assertNotIn(token.encode(), self.config.database.read_bytes())
        self.assertNotIn(self.secret.read_bytes(), self.config.database.read_bytes())

    def test_same_pin_has_different_salt_and_hash_for_each_profile(self):
        self.register("Samuel")
        self.register("Anna")
        with self.store.connection() as connection:
            rows = connection.execute("SELECT salt,pin_hash FROM profiles").fetchall()
        self.assertNotEqual(rows[0][0], rows[1][0])
        self.assertNotEqual(rows[0][1], rows[1][1])

    def test_cross_device_save_revision_conflict_and_restart_persistence(self):
        first = self.register()
        status, _, data = self.request("GET", "/progress", cookie=first)
        self.assertEqual((status, data), (200, {"username": "Samuel", "revision": 0, "progress": None}))
        status, _, data = self.request("PUT", "/progress", {"username": "Samuel", "revision": 0, "progress": progress()}, first)
        self.assertEqual((status, data), (200, {"revision": 1}))
        status, headers, _ = self.request("POST", "/login", {"username": "Samuel", "pin": PIN})
        self.assertEqual(status, 200)
        second = headers["Set-Cookie"].split(";", 1)[0]
        status, _, data = self.request("GET", "/progress", cookie=second)
        self.assertEqual(data["progress"], progress())
        status, _, data = self.request("PUT", "/progress", {"username": "Samuel", "revision": 0, "progress": progress("old device")}, second)
        self.assertEqual((status, data), (409, {"error": "conflict", "revision": 1}))
        self.stop()
        self.start()
        status, _, data = self.request("GET", "/progress", cookie=second)
        self.assertEqual((status, data["revision"], data["progress"]), (200, 1, progress()))
        self.assertEqual(self.request("GET", "/me", cookie=first)[0], 200)

    def test_profile_identity_guard_prevents_stale_tab_writing_other_account(self):
        samuel = self.register()
        anna = self.register("Anna")
        status, _, body = self.request("PUT", "/progress", {"username": "Samuel", "revision": 0, "progress": progress("Samuel's private draft")}, anna)
        self.assertEqual((status, body), (409, {"error": "profile_changed"}))
        self.assertIsNone(self.request("GET", "/progress", cookie=anna)[2]["progress"])
        self.assertIsNone(self.request("GET", "/progress", cookie=samuel)[2]["progress"])
        self.assertEqual(self.request("GET", "/progress?username=Anna", cookie=samuel)[0], 400)
        self.assertEqual(self.request("GET", "/users", cookie=samuel)[0], 404)
        self.assertEqual(self.request("GET", "/Samuel", cookie=anna)[0], 404)

    def test_wrong_unknown_and_missing_credentials_do_not_reveal_records(self):
        self.register()
        wrong = self.request("POST", "/login", {"username": "Samuel", "pin": "729461"})
        missing = self.request("POST", "/login", {"username": "Nobody", "pin": "729461"})
        self.assertEqual((wrong[0], wrong[2]), (missing[0], missing[2]))
        self.assertEqual(self.request("GET", "/me")[0], 401)
        self.assertEqual(self.request("GET", "/progress")[0], 401)
        self.assertEqual(self.request("PUT", "/progress", {"username": "Samuel", "revision": 0, "progress": progress()})[0], 401)
        duplicate = self.request("POST", "/register", {"username": "Samuel", "pin": "729461"})
        self.assertEqual((duplicate[0], duplicate[2]), (400, {"error": "profile-unavailable"}))

    def test_account_throttle_survives_restart_and_ignores_untrusted_forwarded_ip(self):
        self.register()
        for i in range(5):
            response = self.request("POST", "/login", {"username": "Samuel", "pin": "729461"}, headers={"X-Real-IP": f"192.0.2.{i}"})
            self.assertEqual(response[0], 401)
        self.stop()
        self.start()
        status, headers, body = self.request("POST", "/login", {"username": "Samuel", "pin": PIN})
        self.assertEqual(status, 429)
        self.assertEqual(body["error"], "try-later")
        self.assertEqual(headers["Retry-After"], "900")
        self.clock[0] += 901
        self.assertEqual(self.request("POST", "/login", {"username": "Samuel", "pin": PIN})[0], 200)

    def test_ip_throttle_applies_across_accounts_and_forwarded_header_spoofing(self):
        # Small configured threshold exercises the same durable bucket logic.
        from dataclasses import replace
        self.stop()
        self.config = replace(self.config, ip_attempts=3)
        self.start()
        for i in range(3):
            self.assertEqual(self.request("POST", "/login", {"username": f"Nobody{i}", "pin": "729461"}, headers={"X-Real-IP": f"198.51.100.{i}"})[0], 401)
        self.assertEqual(self.request("POST", "/login", {"username": "Another", "pin": "729461"}, headers={"X-Real-IP": "203.0.113.50"})[0], 429)

    def test_exact_trusted_proxy_can_supply_real_client_ip(self):
        from dataclasses import replace
        self.stop()
        self.config = replace(self.config, ip_attempts=1, trusted_proxies=("127.0.0.1",))
        self.start()
        self.assertEqual(self.request("POST", "/login", {"username": "NobodyA", "pin": "729461"}, headers={"X-Real-IP": "198.51.100.1"})[0], 401)
        self.assertEqual(self.request("POST", "/login", {"username": "NobodyB", "pin": "729461"}, headers={"X-Real-IP": "198.51.100.2"})[0], 401)
        self.assertEqual(self.request("POST", "/login", {"username": "NobodyC", "pin": "729461"}, headers={"X-Real-IP": "198.51.100.1"})[0], 429)

    def test_origin_content_type_and_method_guards(self):
        payload = {"username": "Samuel", "pin": PIN}
        self.assertEqual(self.request("POST", "/register", payload, headers={"Origin": "https://other.example"})[0], 403)
        self.assertEqual(self.request("POST", "/register", payload, headers={"Origin": None})[0], 403)
        self.assertEqual(self.request("POST", "/register", payload, headers={"Content-Type": "text/plain"})[0], 415)
        self.assertEqual(self.request("POST", "/register", payload, headers={"Sec-Fetch-Site": "cross-site"})[0], 403)
        self.assertEqual(self.request("OPTIONS", "/register")[0], 405)
        self.assertEqual(self.request("GET", "/register")[0], 404)
        self.assertEqual(self.request("GET", "/health", headers={"Origin": None})[2], {"ok": True})
        self.assertEqual(self.request("POST", "/register", raw=b'{"username":"Samuel","username":"Anna","pin":"582947"}')[0], 400)

    def test_common_pins_and_oversized_or_invalid_progress_are_rejected(self):
        self.assertEqual(self.request("POST", "/register", {"username": "Samuel", "pin": "123456"})[2], {"error": "choose-stronger-pin"})
        self.assertEqual(self.request("POST", "/register", {"username": "Samuel", "pin": "111111"})[0], 400)
        cookie = self.register()
        for invalid in ({"version": 1}, {**progress(), "version": True}, {**progress(), "language": "xx"}):
            self.assertEqual(self.request("PUT", "/progress", {"username": "Samuel", "revision": 0, "progress": invalid}, cookie)[0], 400)
        self.assertEqual(self.request("PUT", "/progress", {"username": "Samuel", "revision": True, "progress": progress()}, cookie)[0], 400)
        large = progress("Una frase personale. " * 145000)
        self.assertEqual(self.request("PUT", "/progress", {"username": "Samuel", "revision": 0, "progress": large}, cookie)[0], 200)
        self.assertEqual(self.request("GET", "/progress", cookie=cookie)[2]["progress"], large)
        too_large = progress("x" * api.MAX_PROGRESS_BYTES)
        self.assertEqual(self.request("PUT", "/progress", {"username": "Samuel", "revision": 1, "progress": too_large}, cookie)[0], 413)
        self.assertEqual(self.request("GET", "/progress", cookie=cookie)[2]["revision"], 1)

    def test_logout_revokes_only_current_device_and_expired_sessions_fail(self):
        first = self.register()
        second = self.request("POST", "/login", {"username": "Samuel", "pin": PIN})[1]["Set-Cookie"].split(";", 1)[0]
        status, headers, _ = self.request("POST", "/logout", {}, first)
        self.assertEqual(status, 200)
        self.assertIn("Max-Age=0", headers["Set-Cookie"])
        self.assertEqual(self.request("GET", "/me", cookie=first)[0], 401)
        self.assertEqual(self.request("GET", "/me", cookie=second)[0], 200)
        self.clock[0] += api.SESSION_SECONDS + 1
        self.assertEqual(self.request("GET", "/me", cookie=second)[0], 401)

    def test_pepper_is_required_private_and_not_silently_replaced(self):
        self.secret.chmod(0o644)
        with self.assertRaises(ValueError):
            api.load_pepper(self.secret)
        self.secret.chmod(0o600)
        self.secret.write_bytes(b"short")
        with self.assertRaises(ValueError):
            api.load_pepper(self.secret)
        self.secret.unlink()
        with self.assertRaises(FileNotFoundError):
            api.Store(self.config)

    def test_concurrent_stale_writes_cannot_both_succeed(self):
        cookie = self.register()
        responses = []
        def write(note):
            responses.append(self.request("PUT", "/progress", {"username": "Samuel", "revision": 0, "progress": progress(note)}, cookie)[0])
        threads = [threading.Thread(target=write, args=(f"Device {i}",)) for i in range(2)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        self.assertEqual(sorted(responses), [200, 409])
        self.assertEqual(self.request("GET", "/progress", cookie=cookie)[2]["revision"], 1)


if __name__ == "__main__":
    unittest.main()
