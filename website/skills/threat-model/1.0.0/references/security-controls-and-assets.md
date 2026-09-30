# Security Controls and Asset Categories

A lightweight checklist that keeps threat models consistent from one project to the next. Prefer concrete, system-specific items over generic text.

## Asset categories (pick only what applies)

- User data (personal data, content, uploads)
- Authentication artifacts (passwords, tokens, sessions, cookies)
- Authorization state (roles, policies, access lists)
- Secrets and keys (API keys, signing keys, encryption keys)
- Configuration and feature flags
- Models and weights (for machine-learning systems)
- Source code and build artifacts
- Audit logs and telemetry
- Availability-critical resources (queues, caches, rate limits, compute budgets)
- Tenant isolation boundaries and metadata

## Security control categories

- **Identity and access:** authentication, authorization, session handling, mutual TLS, key rotation
- **Input protection:** schema validation, parsing hardening, upload scanning, sandboxing
- **Network safeguards:** TLS, network policies, web application firewall, rate limiting, denial-of-service controls
- **Data protection:** encryption at rest and in transit, tokenization, redaction
- **Isolation:** process sandboxing, container boundaries, tenant isolation, system-call filtering
- **Observability:** audit logs, alerting, anomaly detection, tamper resistance
- **Supply chain:** dependency pinning, software bills of materials, provenance, signing
- **Change control:** CI checks, deployment approvals, configuration guardrails

## Mitigation phrasing patterns

- "Enforce schema at <boundary> for <payload> before <component>."
- "Require an authorization check for <action> on <resource> in <service>."
- "Isolate <parser/component> in a sandbox with <resource limits>."
- "Rate limit <endpoint> by <key> and apply burst caps."
- "Encrypt <data> at rest using <key management> and rotate <keys>."
