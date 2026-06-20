# ADR-0001: Monorepo with pnpm workspaces
Status: Accepted · Date: 2026-06-20

## Context
The deliverable is a reusable engine plus tooling (parser/CLI), an optional voice service, and a demo app. They share types (the IR) and version together.

## Decision
Single repo, pnpm workspaces. `packages/{core,acs,voice-truvoice}`, `services/voice-server`, `apps/mash`. TypeScript strict, ESM, Node 20+, vitest.

## Consequences
- Shared IR types live in one place; no cross-repo version drift.
- The demo dogfoods the published packages by workspace link.
- The voice service is isolated under `services/` because it has a totally different runtime (Wine/Docker) and must never be a dependency of the browser packages.
