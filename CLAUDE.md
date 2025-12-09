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

## Common Commands
- Dev Server: `bun run dev`
- Build: `bun run build`
- Type Check: `bun tsc`
- Lint: `bun run lint`
- Deploy Functions: `bun run deploy:functions`
- ※ bun が無い場合は `npm run dev` / `npm run build` / `npm run lint` / `npm run tsc` を利用してください。
