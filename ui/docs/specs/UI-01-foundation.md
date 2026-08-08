# UI-01 — Foundation

**Component:** `ui/` · **Depends on:** — · **Size:** Medium

> **Feed this file to `/speckit-specify`.** Read [`../CONTEXT.md`](../CONTEXT.md)
> first — it carries the frontend conventions and the six things that must be visible.

## Goal

An app that runs, routes, and talks to the API.

## In scope

- Vite + React + TypeScript, strict mode
- Routes for all eight pages with placeholder components
- Typed API client: base URL from `VITE_API_URL`, JWT header, normalised errors
- A polling hook that takes an interval and **stops on a terminal state**
- App shell: header with a balance widget linking to Wallet
- `Dockerfile` and `docker-compose.yml`

## Out of scope

**Automated tests of any kind** (MVP decision — see `../CONTEXT.md`). Plus:

Any page content, wallet connection, styling systems beyond a basic setup.

## Acceptance

- Every route renders
- The API client reaches `/health`
- The polling hook stops cleanly and doesn't leak intervals on unmount

## Watch out for

- **Only `VITE_`-prefixed env vars reach the browser.** That rule is the guardrail
  keeping `OPERATOR_PRIVATE_KEY` out of the bundle — don't work around it.
- For iteration, `npm run dev` beats the container. Vite hot reload through a Docker
  volume mount is noticeably laggier, especially on macOS. Compose is for a clean
  one-command start.
- The polling hook is used by three pages at two different intervals — build it
  once, properly.

## Source

`../../../docs/ui-design.md` §2, §5 · `../../../docs/project-structure.md` §3.2.
