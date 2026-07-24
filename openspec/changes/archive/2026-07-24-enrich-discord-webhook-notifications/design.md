## Context

Horsepower currently emits a small `TerminalWebhookEvent` containing event/run/change identity, scope, status, locale, summary, and evidence references. The Discord adapter renders this as plain `content`, so recipients cannot reliably identify the selected task, responsible agent/worker/model, relevant operation, duration, failure/remediation, or required next action. Generic JSON compatibility and lifecycle terminal authority must remain unchanged.

## Goals / Non-Goals

**Goals:**
- Produce concise but information-complete Discord terminal notifications using one status-colored embed and a non-empty textual fallback.
- Carry only bounded, normalized, explicitly allowlisted context from authoritative campaign/run/dispatch state.
- Clearly answer: what happened, where, for which change/task, which worker/agent/model was involved, and what action is required.
- Preserve localization, delivery retry semantics, generic provider behavior, and privacy guarantees.
- Keep notification delivery observational and inspectable without affecting terminal truth.

**Non-Goals:**
- Sending prompts, reasoning, transcripts, raw provider payloads, unrestricted tool output/stderr, reports, credentials, webhook URLs, or private handoff paths.
- Treating Discord messages as planning, acceptance, evidence, failure, or terminal authority.
- Adding Discord interactions, buttons, slash commands, bots, threads, attachments, or Lark support.
- Inferring provider from URL or changing existing provider/auth compatibility.

## Decisions

### 1. Enrich the existing event instead of creating a second notification registry

`TerminalWebhookEvent` gains an optional bounded context object and optional normalized diagnostic/failure/action fields. Run lifecycle bindings capture the safe context at authoritative begin/settlement boundaries. Existing required fields and generic JSON semantics remain compatible.

### 2. Use an allowlisted safe context schema

The event may contain campaign ID, selected task ID/description, agent, worker ID, requested/resolved slot, model, thinking, work kind, operation, elapsed time, last-progress age, and safe project label. Each field has an explicit UTF-8 bound. Failure projection reuses bounded Captain failure fields (`code`, `boundary`, `stage`, `message`, `remediation`, `retryable`). Unknown keys are discarded.

The payload never derives context by reading reports, prompts, message text, provider events, tool output, or private storage paths.

### 3. Render exactly one Discord embed plus fallback content

Discord requests contain:

```json
{
  "content": "<localized status summary>",
  "embeds": [{
    "title": "<status icon and terminal outcome>",
    "description": "<bounded summary>",
    "color": 5763719,
    "fields": [],
    "footer": { "text": "Horsepower · <scope> · <run>" },
    "timestamp": "<ISO timestamp>"
  }],
  "allowed_mentions": { "parse": [] }
}
```

Colors are stable: completed green, failed red, canceled gray, blocked orange, and stalled yellow. Fields are grouped in deterministic order: outcome/action, change/task, worker/model, operation/timing, failure/diagnostic, identifiers. Empty or unavailable groups are omitted rather than filled with `unknown` noise.

### 4. Bound below Discord limits

The codec enforces one embed, at most 25 fields, title ≤256 characters, description ≤4096, field names ≤256, field values ≤1024, content ≤2000, and total embed text ≤6000 characters, with stricter internal byte limits. Truncation is Unicode-safe and occurs after redaction. `allowed_mentions.parse` remains empty.

### 5. Compute action required deterministically

Completed terminal outcomes default to localized “No action required.” Failed, blocked, stalled, and canceled outcomes use explicit bounded remediation when supplied; otherwise they use a stable localized fallback directing Captain to inspect existing `status`/`read`/run surfaces. The renderer does not invent completion or retry authority.

### 6. Preserve generic compatibility

The generic provider continues to receive normalized Horsepower JSON. Optional enriched fields may be present, but existing required fields and authentication/signature behavior remain stable. Legacy events lacking context still render a valid, useful Discord embed with outcome/change/run information.

### 7. Delivery degradation remains observational

HTTP failures, Discord rejection, codec errors, or missing context produce bounded delivery results and never reverse run settlement. Explicit `webhook test` remains the production-path health probe; `doctor` stays static-only.

## Risks / Trade-offs

- More lifecycle wiring increases schema surface. Mitigation: one optional allowlisted context type with contract tests and no new authoritative store.
- Discord embeds can become noisy. Mitigation: deterministic grouping, omitted empty fields, one embed, strict limits, and concise action guidance.
- Some task/worker context may be unavailable at change-level settlement. Mitigation: render only authoritative available fields and never guess.
- Generic consumers may observe new optional keys. Mitigation: required contract is unchanged and fixtures verify backward compatibility.
- Discord visual rendering cannot be fully asserted through HTTP alone. Mitigation: codec snapshots, strict structural tests, a real HTTP 204 production-path probe, and user visual acceptance before release.
