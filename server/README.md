# Private profile API

The browser still publishes only `site-dist/`. This separate service stores a
learner's synced progress and a verifier for their six-digit PIN. No course PDFs,
legacy databases, credentials or browser profiles are copied into it.

Run Python 3.11+ with its OpenSSL-backed `hashlib.scrypt`. The service has no pip
dependencies. All production traffic must pass through the existing HTTPS site;
the service itself is reachable only by its reverse proxy, never a public port.

```text
python3 -I -B /app/profile_api.py \
  --host 0.0.0.0 --port 5198 \
  --origin https://italian.samuelzhang.co.uk \
  --database /state/profiles.sqlite \
  --pepper-file /run/secrets/profile-pepper \
  --trusted-proxy <exact-private-proxy-IP>
```

The state directory must be owned by the service's unprivileged UID and private.
Generate exactly 32 random bytes into an owner-only `0600` pepper file, outside
the state/database directory, once during installation. Mount that file read-only
and never print it, commit it or bundle it with website assets or database exports.
Preserve the pepper between releases: replacing it invalidates every PIN verifier
and durable rate-limit key. The service deliberately fails if the file is missing,
a symlink, too short or readable by another Unix user/group. Back up this key
separately through an existing private operator process; do not expose it to the
frontend. No profile named Samuel is created automatically.

Use a nonroot container with a read-only root filesystem, all capabilities
dropped, `no-new-privileges`, bounded memory/CPU/processes, and an owned persistent
state volume. Pin the resolved image digest during release preparation. The
Dockerfile contains only this service's source. No image build context should
include repository-root files or private records.

The reverse proxy must preserve `/api/profile/` in the upstream URI, disable
caching and access logging for this location, allow JSON bodies up to 8,002,048
bytes, and overwrite `X-Real-IP` with the proxy's verified client address. Only
explicit `--trusted-proxy` IPs may supply that header; arbitrary callers cannot
bypass limits with forwarded headers. Do not trust an entire public subnet.
Origin checks expect the browser's original HTTPS Origin. Nginx must not rewrite
it to a private backend URL. Use request/response timeouts and a connection cap at
the proxy as well. The service caps concurrent connections at 16 and KDF work at 2.
`GET /api/profile/health` returns only `{"ok":true}`.

## Browser API

All endpoints return JSON with `Cache-Control: no-store`. Mutations require
`Content-Type: application/json` and the exact allowed Origin. Credentials belong
in request bodies only; query strings are refused. Responses never contain a PIN,
verifier, salt, pepper or session token. Authentication uses an opaque random
256-bit token in an `HttpOnly; Secure; SameSite=Strict; Path=/` cookie named
`__Host-parliamo-profile`. Only its SHA-256 digest is stored, for at most 30 days.

- `POST /api/profile/register` with `{username,pin}` explicitly creates a profile
  and signs in; `201 {username}`. Names use 3–32 letters/digits/`_`/`-`, start with a
  letter or digit, and match case-insensitively. Repeated/ascending/descending
  six-digit PINs are refused at registration. Existing names return a generic
  `profile-unavailable` error; there is no name-search endpoint.
- `POST /api/profile/login` with `{username,pin}` signs in; `200 {username}`.
  Wrong and unknown credentials both return `401 invalid-credentials` after a KDF
  calculation. No account is silently created by a mistyped login.
- `GET /api/profile/me` returns `200 {username}` or `401 sign-in-required`.
- `GET /api/profile/progress` returns `{username,revision,progress}`. A new profile
  starts with revision 0 and `progress:null`; it does not erase the local device.
- `PUT /api/profile/progress` with `{username,revision,progress}` atomically updates
  that signed-in profile and returns `{revision}`. A stale revision returns
  `409 {error:"conflict",revision}`. A username/session mismatch returns
  `409 {error:"profile_changed"}` before writing, protecting another open tab when
  the shared browser cookie switches accounts. Fetch the latest record and resolve
  safely; never overwrite another device's unacknowledged changes.
- `POST /api/profile/logout` with `{}` revokes this device's token, clears its
  cookie and returns `{ok:true}`. Other signed-in devices remain valid.

Errors include `try-later` (429 with Retry-After seconds), `choose-stronger-pin`,
`invalid-credentials`, `profile-unavailable`, `invalid-progress`,
`request-too-large`, `progress-too-large`, `origin-not-allowed`, `json-required`
and `temporarily-unavailable`. Do not automatically retry credential failures.

The server validates the progress version, required envelope fields, bounded
JSON depth/member counts and an 8,000,000-byte limit. It rejects duplicate or
prototype-related object keys and non-finite JSON. The browser performs the full
course/activity schema validation before applying a remote snapshot. The service
does not claim that an arbitrary uploaded lesson completion is a measured grade.

PINs use scrypt N=32768, r=8, p=3 with a unique 16-byte salt and a 32-byte verifier.
An HMAC with the separately stored random pepper precedes scrypt. This matches an
[OWASP documented scrypt work-factor combination](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html#scrypt).
The low entropy of six digits still requires throttling: five attempts per account
per 15 minutes, 30 per client IP per 15 minutes, and ten registrations per IP per
hour. Account limits are keyed independently of client IP and survive restarts.
Successful sign-in clears that account's failure bucket, not IP limits. Sessions,
profiles and rate-limit tables are bounded; expired rate rows and sessions are
removed. No session cookie or record content is logged.

A six-digit PIN is a lightweight barrier, not equivalent to a high-entropy
password or a passkey. A database-only leak is harder to attack without the
separate pepper, but compromise of the whole server can expose learning records
and the key. There is no email recovery or public PIN-reset endpoint. Keep a
progress export; a forgotten PIN requires deliberate private operator recovery,
not an insecure username-only reset.

## Disposable tests and preview

Run `python3 -m unittest discover -s tests -p 'test_profile_api.py' -v` from the
repository root. Fixtures use temporary directories, synthetic progress and random
keys, and delete them afterwards. No real account or deployment is accessed.

For an isolated local browser test only, use `--development --host 127.0.0.1
--origin http://127.0.0.1:5197` with a disposable database and pepper file. This
mode uses a separate non-Secure cookie name and refuses non-loopback binding or
non-local origins. Proxy `/api/profile` from Vite to `127.0.0.1:5198`; keep browser
requests same-origin. Production must never use `--development`.
