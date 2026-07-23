## 1. Provider Configuration

- [x] 1.1 Add failing parser and precedence tests for explicit `generic` and `discord` providers, legacy missing-provider fallback, unsupported values, project overrides, incompatible authentication, and credential redaction. Plan: TC-1; G-2, G-4.
- [x] 1.2 Implement provider-aware webhook settings and prospective transactional validation without changing existing generic HMAC/Bearer behavior. Plan: TC-1, TC-5; G-3, G-4.
- [x] 1.3 Add failing CLI and complete-configuration tests for provider selection, preservation, disablement, cancellation, incompatible authentication, and English/Chinese output. Plan: TC-1; G-2.
- [x] 1.4 Implement provider selection and bounded localized remediation in webhook CLI, complete configuration, doctor, and redacted settings output. Plan: TC-1; G-3, G-4.

## 2. Discord Adapter

- [x] 2.1 Add failing canonical-boundary tests proving the Discord codec cannot receive or emit raw identifiers, prompts, reports, command output, credentials, private paths, or unbounded evidence. Plan: TC-2; G-2, G-4.
- [x] 2.2 Add failing Discord codec tests for required non-empty `content`, `allowed_mentions` suppression, deterministic limits, Unicode-safe truncation, localization, and `auth.mode=none`. Plan: TC-2; G-2.
- [x] 2.3 Implement the Discord incoming-webhook adapter from canonical normalized terminal events only. Plan: TC-2; G-3, G-4.

## 3. Delivery and Diagnostics

- [x] 3.1 Refactor notifier transport to send provider-rendered bodies while preserving bounded retries, timeout, cancellation, abandonment, generic HMAC/Bearer headers, and terminal-status independence. Plan: TC-3, TC-5; G-2, G-4.
- [x] 3.2 Add an explicit webhook test operation that uses the effective production normalization/adapter/transport path and emits bounded credential-free provider-aware results; keep doctor network-side-effect free. Plan: TC-4; G-2, G-5.
- [x] 3.3 Add a deterministic local receiver E2E for Discord acceptance/rejection and the explicit test operation, plus regression coverage for generic delivery. Plan: TC-3, TC-4, TC-5; G-2, G-5.
- [x] 3.4 Verify change-terminal and optional dispatch-terminal notifications select the configured adapter and preserve original terminal truth on delivery failure. Plan: TC-3; G-2, G-4.

## 4. Documentation and Verification

- [x] 4.1 Update English/Chinese documentation and bundled Skill guidance for `generic|discord`, Discord setup, supported authentication, safe testing, migration, retries, and credential rotation. Plan: TC-4; G-1.
- [x] 4.2 Extend privacy tests to reject concrete Discord webhook URLs/tokens, private paths, and captured payloads while allowing protocol-safe fixtures. Plan: TC-5; G-2, G-4.
- [x] 4.3 Run TC-1 through TC-5, typecheck/build, strict OpenSpec validation, required privacy/terminal-truth checks, and `git diff --check`; submit fresh claim-matched completion evidence. Plan: TC-1, TC-2, TC-3, TC-4, TC-5; G-1, G-2, G-3, G-4, G-5.
