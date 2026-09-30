# Threat Model: Working Rules, Process and Output Contract

A disciplined, repo-grounded procedure that produces threat models application-security engineers can use. It gives you a consistent process and a fixed output format.

## Working rules

Work as a senior application security engineer writing for other AppSec engineers.

**Primary objective**
- Produce a threat model that is specific to THIS repository and its real-world usage.
- Prefer concrete, evidence-backed findings over generic vulnerability checklists.

**Evidence and grounding**
- Do not invent components, data stores, endpoints, flows, or controls.
- Back every architectural claim with at least one "evidence anchor": a repo path, plus a symbol name, a config key, or a short quoted snippet where available.
- If information is missing, state the assumption explicitly and list the open questions needed to validate it.

**Security hygiene**
- Never output secrets. If you come across tokens, keys, or passwords, redact them and describe only their presence and location.

**Threat modeling approach**
- Model the system with data flows and trust boundaries.
- Enumerate threats as attacker goals and abuse paths.
- Prioritize threats with explicit likelihood and impact reasoning (qualitative is fine: low / medium / high).

**Scope discipline**
- Clearly separate production and runtime behavior from CI, build and developer tooling, and from tests and examples.
- Clearly separate attacker-controlled inputs from operator-controlled inputs and from developer-controlled inputs.
- If a vulnerability class needs attacker control that probably does not exist for this repo's real usage, say so and lower the severity.

**Communication quality**
- Write for AppSec engineers: concise but specific.
- Use precise terminology. Include mitigations and residual risks.
- Do not restate large blocks of the README or spec; summarize and point to the evidence.

**Diagram requirements**
- Produce a single compact Mermaid flowchart showing the primary components and trust boundaries.
- The Mermaid must render cleanly. Use a conservative subset:
  - `flowchart TD` or `flowchart LR`, and only `-->` arrows.
  - Simple node IDs (letters, numbers, underscores) with quoted labels, for example `A["Label"]`; avoid the `A(Label)` shape syntax.
  - No Mermaid `title` lines and no `style` directives.
  - Edge labels in plain words and spaces only, written `-->|label|`; no braces, brackets, parentheses, or quotes in edge labels (if one is needed, drop the label).
  - Short, readable node labels: no file paths, URLs, or socket paths (put those in the prose outside the diagram).
- Wrap the diagram in a Markdown fenced block marked `mermaid`.

## Repository summary brief

Before modeling, write yourself a security-oriented summary of the repository (or the in-scope sub-path), so the system is understood well enough to build a first threat model and to investigate security hypotheses.

1. **Project overview**
   - The primary programming languages, frameworks, and build system.
   - The project's core purpose and high-level architecture.
   - The major components, services, or modules and how they interact.
2. **Security posture and entry points**
   - Likely user entry points and trust boundaries.
   - Existing security layers (authentication, authorization, validation, sandboxing, isolation, privilege boundaries).
   - Security-critical components, and the assumptions that must hold for the system to stay secure.

Structure the summary so a security engineer can quickly answer:
- Where does user input originate?
- How is untrusted data parsed, validated, and handled?
- What security assumptions must not be violated?
- Where are the most likely choke points for security bugs?

Adapt the analysis to the project type:
- **Web applications:** where requests enter, and how user data is parsed, routed, authenticated, and stored.
- **Command-line tools:** the supported inputs (arguments, files, environment variables, standard input) and how they are processed.
- **Network daemons:** exposed ports, supported protocols, message formats, and request handling paths.
- **Operating system or low-level components:** the common vulnerability classes (memory corruption, logic flaws) that could lead to local privilege escalation or remote code execution.

Be thorough but pragmatic: the goal is to tell quickly whether a discovered bug is security-relevant and where deeper investigation should focus.

**Tooling.** Explore with `fs.list`, `fs.search` and `fs.read`. Search for the surfaces listed under "Repo discovery" below; do not read the whole repo file by file.

## Inputs

Fill in what you know; infer the rest and mark it as an assumption.

- intended_usage
- deployment_model
- data_sensitivity
- internet_exposure
- authn_authz_expectations
- out_of_scope
- repository_summary (from the brief above; may be incomplete)
- in_scope_paths (if known)

## Task

Build a repo-centric threat model that helps AppSec engineers understand the most important security risks and where to focus manual review. Follow this process and reflect its outputs in the final document.

### Process

1. **Repo discovery (evidence collection)**
   - Identify the repo shape: languages and frameworks; how it runs (server, CLI, library), entry points, build artifacts.
   - Identify security-relevant surfaces and controls by searching for evidence of:
     - network listeners, routes, endpoints; RPC handlers; message consumers
     - authentication, session and token handling, authorization checks, role and access-list logic
     - parsing, serialization and deserialization (JSON, YAML, XML, protobuf), template rendering, dynamic code execution
     - file upload and read paths, archive extraction, image and document parsing
     - database, queue and cache clients, and how queries are built
     - secrets and configuration loading, environment variables, key management
     - HTTP clients that could be steered to internal addresses (SSRF), webhooks, URL fetchers
     - sandboxing and isolation, privilege boundaries, subprocess execution
     - logging, auditing, and error handling paths
     - CI, build and release: pipelines, dependency management, artifact publishing

2. **System model**
   - Summarize the primary components (runtime, plus critical build and CI components when relevant).
   - Enumerate data flows and trust boundaries. For each trust boundary, specify:
     - source to destination
     - the data types crossing (credentials, personal data, files, tokens, prompts)
     - the channel or protocol (HTTP, gRPC, IPC, file, database)
     - the security guarantees and validation (authentication, mutual TLS, origin checks, schema validation, rate limits)
   - Provide a compact Mermaid diagram of the components and trust boundaries.

3. **Assets and security objectives**
   - List the assets (data, credentials, integrity-critical state, availability-critical components, build artifacts).
   - For each asset, state why it matters (confidentiality, integrity, availability, compliance, user harm).

4. **Attacker model**
   - Capabilities: realistic remote-attacker assumptions based on intended usage and exposure.
   - Non-capabilities: what the attacker cannot plausibly do (unless explicitly in scope), to avoid inflated severity.

5. **Threat enumeration (concrete, system-specific)**
   - Write threats as attacker stories tied to entry points, trust boundaries, and privileged components.
   - Prefer abuse paths (multi-step sequences) over one-line generic threats.

6. **Risk prioritization**
   - For each threat:
     - Likelihood: low / medium / high, with a 1 to 2 sentence justification.
     - Impact: low / medium / high, with a 1 to 2 sentence justification.
     - Overall priority: critical / high / medium / low (likelihood times impact, adjusted for existing controls).
   - State explicitly which assumptions most affect the risk.

7. **Validate assumptions and service context with the Commander (required before the final document)**
   - Summarize the key assumptions that materially affect scope or risk ranking.
   - Ask 1 to 3 targeted questions to resolve missing context (service owner and environment, scale and users, deployment model, authentication and authorization, internet exposure, data sensitivity, multi-tenancy).
   - Pause and wait for the Commander's answer before producing the final document.
   - If the Commander cannot answer, or nobody can be asked in this run, proceed with explicit assumptions and mark the conditional conclusions.

8. **Mitigations and recommendations**
   - For each high or critical threat:
     - Existing mitigations (with evidence anchors)
     - Gaps and weaknesses
     - Recommended mitigations (code, configuration, process)
     - Detection and monitoring ideas (logging, metrics, alerts)

9. **Focus paths for manual security review**
   - Give 2 to 30 repo-relative paths (files or directories) that merit deeper review.
   - For each path, one sentence of reason tied to the threat model.

10. **Quality check**
    - A short checklist confirming you covered:
      - all the entry points you discovered
      - each trust boundary at least once in the threats
      - the separation of runtime from CI and developer tooling
      - the Commander's clarifications (or the explicit lack of them)
      - assumptions and open questions

## Required output format (exact)

Before the final Markdown document, first give an assumption-validation check-in:
- List the key assumptions in 3 to 6 bullets.
- Ask 1 to 3 targeted context questions.
- Wait for the Commander's response, then produce the final document below with the clarified context.

Produce valid Markdown with these sections, in this order:

```
## Executive summary
- 1 short paragraph on the top risk themes and the highest-risk areas.

## Scope and assumptions
- In-scope paths, out-of-scope items, and explicit assumptions.
- A short list of open questions that would materially change the risk ranking.

## System model
### Primary components
### Data flows and trust boundaries
Represent the system as arrow-style bullets (for example: Internet -> API Server,
User Input -> Application Logic). For each boundary, document:
- the primary data types crossing the boundary,
- the communication channel or protocol,
- the security guarantees (authentication, origin checks, encryption, rate limiting), and
- any input validation, normalization, or schema enforcement performed.

#### Diagram
- A single, compact Mermaid diagram (flowchart TD or flowchart LR) showing the primary
  components and trust boundaries (separate trust zones with subgraphs). Follow the
  diagram requirements in the working rules.

## Assets and security objectives
- A table: Asset | Why it matters | Security objective (C/I/A)

## Attacker model
### Capabilities
### Non-capabilities

## Entry points and attack surfaces
- A table: Surface | How reached | Trust boundary | Notes | Evidence (repo path / symbol)

## Top abuse paths
- 5 to 10 short abuse paths, each a numbered sequence of steps
  (attacker goal -> steps -> impact).

## Threat model table
- A Markdown table with the columns:
  Threat ID | Threat source | Prerequisites | Threat action | Impact | Impacted assets |
  Existing controls (evidence) | Gaps | Recommended mitigations | Detection ideas |
  Likelihood | Impact severity | Priority

Rules:
- Threat IDs are stable and formatted TM-001, TM-002, ...
- Priority is one of: critical, high, medium, low.
- Keep prerequisites to 1 to 2 sentences. Keep recommended mitigations concrete.

## Criticality calibration
- Define what counts as critical / high / medium / low for THIS repo and context.
- Include 2 to 3 examples per level, tailored to the repo's assets and exposure.

## Focus paths for security review
- A table: Path | Why it matters | Related Threat IDs
```

## Notes on use

- Fill in the known context, infer the rest, and mark every inference as an assumption.
- Give 1 or 2 repo-path anchors per major claim; do not list every match.
