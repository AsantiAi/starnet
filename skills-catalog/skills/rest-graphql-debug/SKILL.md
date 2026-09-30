---
name: rest-graphql-debug
description: "Debug REST and GraphQL APIs layer by layer: connectivity, timeouts, TLS, auth, request format, parsing and semantics, with a status-code playbook and a clean repro for every finding."
license: MIT
metadata:
  title: "REST & GraphQL API Debugging"
  category: "Engineering"
  author: "eren-karakus0"
---

# API Testing and Debugging

Diagnose REST and GraphQL problems with the station's tools: `web_request` to send the exact request, `shell.exec` with `curl` when you need response headers, TLS details, or timings, and `web_fetch` for the provider's API docs. Isolate the failing layer before guessing at a fix.

## When to use

- An API returns an unexpected status or body.
- Auth fails (401/403 after a token refresh, OAuth, API key).
- A call works in an API client but fails in code.
- Webhook or callback integration debugging.
- Building or reviewing API integration tests.
- Rate limiting or pagination problems.

Skip it for UI rendering, database query tuning, or DNS and firewall infrastructure (escalate those).

## Core principle

**Isolate the layer, then fix.** A 200 OK can hide broken data. A 500 can mask a one-character auth typo. Walk the chain in order; never skip a step.

```
1.   Connectivity    → can we reach the host at all?
1.5  Timeouts        → slow to connect, or slow to answer?
2.   TLS             → is the certificate valid and trusted?
3.   Auth            → are the credentials correct and unexpired?
4.   Request format  → does the payload match what the server expects?
5.   Response parse  → does our code accept what came back?
6.   Semantics       → does the data mean what we assume?
```

## Your instruments

**`web_request`** (DISH) sends one request exactly as you specify it and returns the HTTP status and up to about 8,000 characters of the response body. It does NOT return response headers.

- Arguments: `url`, `method` (GET, HEAD, POST, PUT, PATCH, DELETE), `headers`, `body` (a string; send JSON as a string, and the Content-Type defaults to `application/json` when a body is present), `multipart` for file uploads.
- **Authentication without seeing the secret:** reference a key stored in TOOLSETS & CONNECTORS → KEYS by its NAME inside a header value, for example `headers: {"Authorization": "Bearer ${ACME_API_TOKEN}"}`. The station substitutes the value at send time. Placeholders work in headers only, never in the url or body. For APIs that want the key as a query parameter, use `auth: {"key": "ACME_API_TOKEN", "in": "query", "name": "api_key"}`.
- Never ask the Commander to paste a token into chat. If no stored key fits, ask them to add one in KEYS.
- Each `web_request` can ask the Commander for approval, so plan requests instead of spraying them.

**`shell.exec` with `curl`** (WORKBENCH) shows what `web_request` cannot: response headers (`-i`), the TLS handshake and certificate (`-v`), and timing (`-w`). Use it for unauthenticated requests; stored keys are not available in the shell, and a secret must never be typed into a command.

- On Windows, `shell.exec` runs `cmd.exe` and `curl.exe` ships with Windows 10 and later. Quote with double quotes; single quotes do not quote in cmd. Escape a double quote inside a JSON body as `\"`. Discard output with `-o NUL` on Windows and `-o /dev/null` on macOS or Linux.
- To inspect a body larger than the `web_request` window, save it: `curl -s -o response.json <url>`, then page through it with `fs.read` (`offset`, `limit`).

**`web_fetch`** reads the provider's documentation page for the endpoint, so you debug against the spec instead of a guess.

## Quickstart

- **REST GET:** `web_request` with `url: "https://api.example.com/users/1"`.
- **REST POST with JSON:** `web_request` with `method: "POST"`, `url: "https://api.example.com/users"`, `headers: {"Authorization": "Bearer ${ACME_API_TOKEN}"}`, `body: "{\"name\":\"test\",\"email\":\"test@example.com\"}"`.
- **Headers only (unauthenticated):** `shell.exec` with `cmd: "curl -sI https://api.example.com/health"`.
- **GraphQL:** `web_request` with `method: "POST"`, `url: "https://api.example.com/graphql"`, the auth header, and `body: "{\"query\":\"{ user(id: 1) { name email } }\"}"`.

**GraphQL gotcha:** servers often answer HTTP 200 even when the query failed. Always inspect the `errors` array in the body, whatever the status code. Each error carries a `message` and usually a `path`; `data` can be partially filled next to it.

## Layered debug flow

### Step 1: Connectivity

- `shell.exec`: `nslookup api.example.com`
- `shell.exec`: `curl -v --connect-timeout 5 https://api.example.com/health`

Failures: DNS not resolving, a firewall, a required VPN, a missing proxy.

### Step 1.5: Timeouts

Separate *cannot reach* from *reaches but slow*:

```
curl -s -o NUL -w "dns:%{time_namelookup}s connect:%{time_connect}s tls:%{time_appconnect}s ttfb:%{time_starttransfer}s total:%{time_total}s\n" https://api.example.com/endpoint
```

(Use `-o /dev/null` on macOS or Linux.) A high `connect` time points at the network or firewall; a high `ttfb` with a low `connect` points at a slow server. In the Commander's code, always set explicit connect and read timeouts; some HTTP libraries have no default and wait forever.

### Step 2: TLS

- `shell.exec`: `curl -vI https://api.example.com` and read the certificate lines (subject, issuer, expire date).
- If `openssl` is installed: `openssl s_client -connect api.example.com:443 -servername api.example.com` shows the chain and dates.

Failures: an expired certificate, a self-signed certificate, a hostname mismatch, a missing CA bundle. Use `curl -k` only for an ad-hoc look, never in code.

### Step 3: Authentication

- Call an identity endpoint (for example `/me`) with `web_request` and the stored key. The status alone tells you a lot.
- If the Commander hands you an expired JWT to look at (never a live one), its middle dot-separated segment is encoded JSON; decode it to read the `exp` claim.

Checklist:
- Token expired? (the `exp` claim of a JWT, or an "expired" message in the 401 body)
- Right scheme? `Bearer` vs `Basic` vs `Token` vs an `X-Api-Key` header.
- Right environment? A staging key on production is a classic.
- Key in a header or in a query parameter?

### Step 4: Request format

Send the exact request with `web_request` and compare it with the documented contract.

**Content-Type and body mismatch, the silent 415/400:**
- The header says JSON but the body is form-encoded (or the reverse). In many HTTP libraries one argument sends form data and another serializes JSON; the wrong one plus a hand-set header produces this bug.
- The `Accept` header asks for XML while the code parses JSON.
- File uploads need real `multipart/form-data` with a boundary; with `web_request` use the `multipart` argument instead of building the body by hand.

Common: form-encoded vs JSON, missing required fields, the wrong HTTP method, unencoded query parameters.

### Step 5: Response parsing

Check the content type before parsing as JSON (`curl -i` shows the `Content-Type` header). Failures: an HTML error page where JSON was expected, an empty body, the wrong charset.

### Step 6: Semantic validation

It parsed cleanly, but is the data *correct*?

- Does `"status": "active"` mean what the code thinks?
- Does the ID in the response match the one requested?
- Are timestamps in the expected timezone?
- Is pagination returning all results, or only page 1?

## HTTP status playbook

### 401 Unauthorized: credentials missing or invalid
1. Is the `Authorization` header actually sent? (`curl -v` on an unauthenticated repro shows what goes out.)
2. Is the token correct and unexpired?
3. Is the auth scheme right (`Bearer` vs `Basic` vs `Token`)?
4. Does this API want the key as a query parameter instead of a header?

### 403 Forbidden: authenticated but not authorized
1. Does the token have the required scopes or permissions?
2. Does the resource belong to a different account?
3. Is an IP allowlist blocking the request?
4. In a browser: CORS? (check `Access-Control-Allow-Origin`)

### 404 Not Found: wrong URL or missing resource
1. Is the path right (trailing slash, typo, version prefix)?
2. Does the resource ID exist?
3. Right API version (`/v1/` vs `/v2/`)?
4. Right base URL (staging vs production)?

### 409 Conflict: state collision
1. Does the resource already exist (duplicate create)?
2. A stale `ETag` or `If-Match`?
3. A concurrent change by another process?

### 422 Unprocessable Entity: valid JSON, invalid data
The error body usually names the bad fields. Check field types (string vs integer, date format), required vs optional, and enum values.

### 429 Too Many Requests: rate limited
Read the `Retry-After` and `X-RateLimit-*` headers (`curl -i` for unauthenticated calls; many APIs also repeat the limit in the error body). Back off exponentially (about 1s, 2s, 4s, 8s, 16s), honor `Retry-After` when present, and stop after about 5 attempts. Never hammer.

### 5xx: server side, usually not the caller's fault
- **500**: a server bug. Capture the request ID and file it with the provider.
- **502**: upstream down. Back off and retry.
- **503**: overloaded or in maintenance. Check the provider's status page.
- **504**: upstream timeout. Reduce the payload or raise the timeout.

For every 5xx: back off with jitter, and alert if it persists.

## Pagination and idempotency

**Pagination.** Confirm you get *all* results. Look for `next_cursor`, `next_page`, `total_count`. Two patterns:
- Offset (`?limit=100&offset=200`): simple, but can skip items when data shifts.
- Cursor (`?cursor=abc123`): preferred for live or large datasets.

**Idempotency.** For non-idempotent operations (POST), send an `Idempotency-Key: <uuid>` header so retries do not double-charge or double-create. Mandatory for payments and orders.

## Contract validation

Catch schema drift before it reaches production: after an API upgrade or a new integration, fetch one real object and compare it field by field with the documented contract. List missing required fields and wrong types (for example `id` should be an integer, `email` and `created_at` strings). For repeatable checks, add a smoke test to the project (below).

## Correlation IDs

Always capture the provider's request ID; it is the fastest path through vendor support. Look for `X-Request-Id`, `X-Trace-Id`, or a CDN ray header such as `CF-Ray` (headers via `curl -i`), or a request ID field in the error body.

**Vendor bug-report template:**

```
Endpoint:    POST /api/v1/orders
Request ID:  req_abc123xyz
Timestamp:   2026-03-17T14:30:00Z
Status:      500
Expected:    201 with order object
Actual:      500 {"error":"internal server error"}
Repro:       <the exact request, auth shown as <REDACTED>>
```

## Regression smoke test

When the Commander's project has a test suite, add a small API smoke test in its own framework and run it with `shell.exec`. Cover at least:

- the health endpoint returns 200;
- a list endpoint returns an array;
- a single object has its required fields (`id`, `email`, ...), or a clean 404;
- an invalid token returns 401.

Read the base URL and token from the project's own environment configuration, never from a hardcoded value.

## Fan-out: full CRUD sweeps

For a sweep across many endpoints, split it with `team.spawn`, one sub-agent per resource. Give each the base URL, the name of the stored key to use (never the value), the verbs to cover (POST, GET, PATCH, DELETE: happy path plus 400, 404, 422 cases), and the output wanted: pass or fail per endpoint, request IDs for failures, and a redacted repro for each failure.

## Security

### Token handling
- Never log or echo full tokens. Redact them: `Bearer <REDACTED>`.
- Never hardcode tokens in scripts or paste them into commands. Stored keys travel through `${NAME}` placeholders in `web_request` headers only.
- If a token surfaces in logs, error messages, or git history, tell the Commander to rotate it immediately.

### Safe logging
When you show headers, replace the values of `Authorization`, `X-Api-Key`, `Cookie`, and `Set-Cookie` with `<REDACTED>`.

### Leak checklist
- [ ] **Credentials in URLs.** Keys in query strings end up in server logs, history, and referrer headers; prefer headers.
- [ ] **PII in error responses.** A 404 on `/users/123` must not reveal whether the user exists (enumeration).
- [ ] **Stack traces in production.** 500s must not leak file paths or framework versions.
- [ ] **Internal hostnames or IPs** (`10.x.x.x`, `internal-api.corp.local`) in error bodies.
- [ ] **Tokens echoed back.** Some APIs include the auth token in error details; confirm they do not.
- [ ] **Verbose `Server` / `X-Powered-By` headers.** Stack information leaks; note them for a security review.

## Output format

Report each finding like this:

```
## Finding
Endpoint: POST /api/v1/users
Status:   422 Unprocessable Entity
Req ID:   req_abc123xyz

## Repro
POST https://api.example.com/api/v1/users
Content-Type: application/json
Authorization: Bearer <REDACTED>
{"name":"test"}

## Root Cause
Missing required field `email`. Server validation rejects the request before processing.

## Fix
{"name":"test","email":"test@example.com"}
```

## Related

- A systematic debugging recipe: once the failing API layer is isolated, root-cause the Commander's code.
- A test-driven development recipe: write the regression test before shipping the fix.

*Needs the DISH (`web_request`, `web_fetch`) and the WORKBENCH (`curl` for headers, TLS, and timings).*

Adapted for StarNet from rest-graphql-debug (eren-karakus0), MIT.

*Sub-agent steps (team.spawn) need the ORCHESTRATOR, which every run the Commander starts carries. In a scheduled run, list those updates in the report instead of making them.*
