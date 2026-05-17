# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| latest (main) | ✅ |

## Reporting a Vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Email: shauryapunj404@gmail.com
Subject: `[ECD-INTELLIGENCE SECURITY] <brief description>`

Include:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

You will receive an acknowledgment within 48 hours. Critical issues are aimed for a patch within 7 days. GitHub's "Security › Report a vulnerability" tab on the repo is also accepted.

## Security Controls

- JWT_SECRET is required at startup; a dev-only fallback is gated behind `NODE_ENV != production` AND `ALLOW_DEV_JWT_FALLBACK=1` so production deploys cannot silently boot with a hardcoded key.
- Access tokens expire in 15 minutes; refresh tokens expire in 7 days.
- Fastify + RBAC middleware on every route; rate limiting on auth endpoints.
- CodeQL `security-extended` on every push, PR, and weekly schedule.
- Dependabot weekly security + version updates with `npm overrides` to pin transitive deps to advisory-clean versions.
- Branch protection on `main`: required CodeQL status checks, linear history, no force-push, no deletion, conversation resolution required.
