# Authentication, Authorization & Security

Added in Phase 1.5 (foundation hardening).

## Authentication

| Piece | Implementation |
|---|---|
| Passwords | Argon2id (`argon2-cffi`), 12–256 characters, rehashed on login when parameters change. Unknown emails are verified against a dummy hash so timing doesn't reveal which accounts exist. |
| Access token | HS256 JWT, 15 min (`ASTRION_ACCESS_TOKEN_TTL_MINUTES`), claims `sub`, `sid`, `iss`, `aud=astrion-web`, `exp`, `typ=access`. Algorithm is pinned (no `none`, no algorithm confusion). |
| Refresh token | 384-bit random string in an **httpOnly, SameSite=Strict** cookie `astrion_refresh`, path `/api/v1/auth`, `Secure` when `ASTRION_COOKIE_SECURE=true`. Only its SHA-256 digest is stored (`auth_sessions.refresh_token_hash`). 14-day lifetime. |
| Rotation | Every `/auth/refresh` issues a new refresh token and revokes the old one (`revoked_reason='rotated'`). |
| Reuse detection | Presenting an already-rotated token revokes the whole session family (`reuse_detected`) — a stolen token stops working for both thief and victim. A 10 s grace window tolerates two tabs refreshing at once. |
| Session binding | Access tokens carry the session id; every request checks the session is live, so **logout takes effect immediately**, not when the JWT expires. |
| Logout | `/auth/logout` revokes the current session family; `/auth/logout-all` revokes every session for the user. |
| CSRF | Every cookie-bearing endpoint (`register`, `login`, `refresh`, `logout*`) requires the `X-Astrion-Client` header. Browsers cannot add custom headers cross-origin without a CORS preflight, which is only allowed for `ASTRION_CORS_ORIGINS`. Combined with `SameSite=Strict`. |
| Brute force | Failed logins limited per (client IP, email): 8 per 15 min by default → `429`. **In-process only** — use a shared store when running several API replicas. |
| Production guard | Startup fails outside development/test if `ASTRION_JWT_SECRET` is shorter than 32 chars or `ASTRION_COOKIE_SECURE` is false. In development a random per-process secret is generated (sessions survive restarts via refresh). |

### Frontend session handling
- The access token lives **only in memory** (Zustand store), never in `localStorage`.
- On load the app calls `/auth/refresh`; the cookie restores the session silently.
- A refresh is scheduled 60 s before the access token expires; concurrent refreshes are single-flighted.
- Any API `401` triggers one refresh and a retry. If that fails the session is marked **expired** and the user is sent to `/login?reason=expired&next=…`, which explains what happened and returns them to where they were.
- `next` is validated to same-app `/app…` paths only (no open redirect).
- On sign-out or user switch the TanStack Query cache and the remembered active workspace are cleared, so no data from one user is shown to another.

## Authorization

- Identity comes **only** from the verified access token (`get_current_user`). Client-supplied ids (e.g. `owner_id` in a body) are ignored — tested.
- Workspaces are owned (`workspaces.owner_id`). Sources and documents are authorized **through their workspace's owner** with a join on every query.
- Requests for another user's resource return **404, not 403**, so the API never confirms a resource exists.
- Workspace slugs are unique per owner, so slug suffixes don't leak other users' workspace names.
- Workspaces created in Phase 1 (before auth) have no owner and are **inaccessible** through the API. They remain in the database; assign an owner manually if needed:
  `UPDATE workspaces SET owner_id = '<user uuid>' WHERE owner_id IS NULL;`
- `/api/v1/health*` stays public (contains no user data).

Cross-user behaviour is covered by `backend/tests/test_authorization.py` and `frontend/e2e/authorization.spec.ts`.

## File handling security
See [STORAGE.md](STORAGE.md): server-generated keys, extension + content sniffing, size limits, path-traversal checks, download-only responses with a sandbox CSP.

## Secrets
- `.env` files are git-ignored; only `.env.example` templates are tracked (verified: no secrets in history at the Phase 1.5 baseline).
- Provider keys (`ANTHROPIC_API_KEY`, `VOYAGE_API_KEY`, S3 keys, Neo4j password, JWT secret) are `SecretStr` server-side and never sent to the browser.

## Known limitations
- No email verification, password reset or MFA yet.
- Rate limiting is per process.
- No roles/sharing: a workspace has exactly one owner.
