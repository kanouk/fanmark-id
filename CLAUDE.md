# Claude Code Guide - fanmark.id

## 🚨 Guidelines
1. **Context First**: Before editing code, check `docs/ARCHITECTURE.md` to map screen names to files.  
2. **Spec Adherence**: Follow `docs/PRODUCT.md` for all business logic.  
3. **Update Docs**: Always update `docs/*.md` if your code changes architecture or specs.
4. **Git Safety**: NEVER revert existing changes you did not make unless explicitly requested. If you see unexpected changes, STOP and ask.
5. **Code Review Mindset**: When asked to "review", prioritize identifying bugs, risks, and regressions over style suggestions. Present findings ordered by severity.

## Core Documentation
- `docs/PRODUCT.md`: Product Specifications & Business Logic  
- `docs/ARCHITECTURE.md`: System Architecture & File Map  
- `docs/TECH.md`: Tech Stack & Implementation Guides

## Current Development

Production uses Cloudflare Workers, Better Auth, split D1 and R2. Read AGENTS.md and docs/README.md first.
Use Node 22.6.0 and the committed npm lockfiles.

- Install: npm ci --legacy-peer-deps; npm ci --prefix workers/api
- Local application: npm run dev:local (synthetic local databases, no provider sends)
- Frontend verification: npm run verify:app
- Actual Worker/browser regression: npm run test:local
- Worker verification: npm --prefix workers/api run typecheck; npm --prefix workers/api test
- Production build: npm run build (build only)

See docs/development/LOCAL.md and docs/development/SCREENS.md for the development environment and screen/controller map.
Production changes follow docs/operations/deployment.md; CI does not deploy.
Do not reconnect the retired Supabase source or reuse one-time migration operations.

## Review Boundaries

Review the actual Worker route authentication, owner/admin authorization and response fields.
The old Supabase table-wide scanner ignore rules do not apply to current D1/API findings.
The former guide is preserved in docs/history/CLAUDE-2026-10-22.md as historical context.
