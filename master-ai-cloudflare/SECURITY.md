# Security notes

## Deployment boundary

The current release is designed for a **single trusted operator per Worker deployment**. The bearer token is an administrative secret, not a substitute for a full identity system. If the dashboard is public, users still need the token to call protected APIs, but this does not provide individual accounts, revocation, MFA or per-user audit attribution. Add Cloudflare Access or an OIDC-backed identity layer before sharing it.

## Rules

1. Keep `MASTER_API_TOKEN` and all provider keys in Cloudflare Worker Secrets.
2. Do not put secrets in Pages environment variables, browser code, D1, logs, Git or screenshots.
3. Do not trust client-supplied tenant identifiers, provider eligibility, classification or approval state. The Worker recomputes policy decisions and stores tenant identity from its environment.
4. Route all AI calls through `security/model-gateway.js`. Never import provider adapters directly into route handlers or agents.
5. `local-only` means the mock adapter only. There is no cloud fallback.
6. Restricted text is blocked from external model providers by the heuristic classifier. This is not a substitute for a dedicated DLP classifier.
7. Provider fallback is not automatic. Rate-limit failures are surfaced and tasks may be resumed by the operator; do not retry to evade quota restrictions.
8. Industrial workflows are analysis-only. Do not add machine/PLC write access without a separate safety architecture, approvals, access control and validation.

## Incident response

If a token or provider key is exposed, revoke/rotate it in the provider/Cloudflare dashboard immediately, remove it from repository history if committed, redeploy, and review audit events. Changing a secret does not remove old copies from Git history or logs.
