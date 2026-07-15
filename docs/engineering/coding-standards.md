# Coding Standards

## Purpose

These standards apply to new and materially changed FIKA Platform code. Existing code should migrate gradually when touched; compliance does not justify an unrelated rewrite.

Project-specific rules may strengthen these standards in the nearest `AGENTS.md`. Any exception must be documented with its scope and reason.

## General rules

- Express business meaning through domain names, stable contracts, and small cohesive units.
- Keep canonical models independent from interfaces, storage layouts, and external providers.
- Separate domain logic, application orchestration, adapters, repositories, configuration, and presentation.
- Prefer configuration for genuine site/client variation. Do not disguise different business behaviour as configuration.
- Validate at every trust boundary. Treat browser, file, integration, and legacy input as untrusted.
- Make mutation, idempotency, versioning, time-zone, money, and source-of-truth behaviour explicit.
- Avoid hidden global state, implicit coercion, unexplained constants, duplicated rules, and provider identifiers in domain objects.
- Keep changes focused and reversible. Preserve current behaviour unless a documented decision changes it.

## JavaScript

- Use the strictest language mode supported by the repository.
- Prefer `const`; use `let` only for intentional reassignment. Do not introduce function-scoped variable declarations.
- Use explicit equality and predictable coercion. Convert external values deliberately before validation.
- Keep functions small enough to state one responsibility. Extract pure domain calculations from I/O and presentation.
- Use objects with documented shapes at boundaries. Validate them before use.
- Prefer array operations when they improve clarity; use loops when control flow or performance is clearer.
- Do not mutate caller-owned objects unless the contract explicitly requires it.
- Handle asynchronous work explicitly. Await required effects and define partial-failure behaviour.
- Avoid dynamic evaluation and string-built executable code.
- TODO: Select and document the platform formatter, linter, language target, and module convention.

## TypeScript

- Use strict type checking for new TypeScript projects unless an ADR documents a temporary exception.
- Do not use `any` to bypass uncertainty. Use `unknown`, validate, then narrow.
- Generate or derive types from completed, committed canonical schemas where practical; prevent parallel handwritten contracts from drifting.
- Distinguish identifiers, money, timestamps, statuses, commands, results, and provider metadata through clear types.
- Use discriminated unions for meaningful variants and exhaustive handling for closed status sets.
- Keep optional fields genuinely optional. Do not use optionality as a substitute for unresolved modelling.
- Types do not replace runtime validation at trust boundaries.
- Keep provider types inside adapters and repository implementations.
- TODO: Decide the standard compiler baseline and type-generation approach.

## HTML

- Use semantic elements that reflect structure and user tasks.
- Ensure all controls have accessible names, labels, keyboard behaviour, focus treatment, and meaningful states.
- Maintain a logical heading order and document language.
- Use buttons for actions and links for navigation.
- Represent loading, empty, success, warning, validation, and failure states explicitly.
- Avoid inline event handlers and presentation styles in new work unless repository constraints are documented.
- Escape untrusted content and avoid inserting unsanitised markup.
- Keep domain rules out of templates.

## CSS

- Use shared design tokens for colour, spacing, typography, elevation, motion, and breakpoints where available.
- Prefer low-specificity, component-scoped rules and predictable naming.
- Design mobile-first where appropriate and test supported viewport ranges.
- Preserve visible focus, readable contrast, scalable text, reduced-motion preferences, and resilient layouts.
- Avoid unexplained numeric values, excessive selector nesting, global overrides, and `!important` except for a documented interoperability need.
- Keep structural layout separate from state and theme variations.
- Remove unused styles only when regression coverage shows they are not required.

## Naming conventions

| Element | Convention | Example form |
|---|---|---|
| Variables and functions | `camelCase`; verb-led functions | `validateBooking`, `sourceReference` |
| Classes, types and schemas | `PascalCase`; domain noun | `FikaBooking`, `ProductionOrderRepository` |
| Constants | Repository convention; use `UPPER_SNAKE_CASE` for true fixed constants | `MAX_RETRY_COUNT` |
| Boolean values | Positive predicate | `isConfirmed`, `hasWarnings`, `canRetry` |
| IDs | Domain noun plus `Id` | `bookingId`, `siteId` |
| Timestamps | Meaning plus `At`; ISO 8601 at boundaries | `createdAt`, `acceptedAt` |
| Files | One consistent repository convention; descriptive and stable | TODO: choose lowercase-kebab or repository-specific legacy convention |
| Tests | Name behaviour and expected result | `rejects stale booking version` |

Do not use former site names where an approved current name exists. Avoid abbreviations unless established in the domain glossary.

## File organisation

- Organise by cohesive capability or domain, then by layer where useful.
- Keep one clear public responsibility per module.
- Keep canonical schemas, fixtures, domain logic, adapters, repositories, UI, and tests distinguishable.
- Avoid “utils” dumping grounds. Name shared modules after the capability they provide.
- Split files when unrelated responsibilities, independent change rates, or difficult testing make the boundary clear. File length alone is not a refactoring instruction.
- Prevent circular dependencies and upward dependencies from core/domain code into adapters or presentation.

## Comments and documentation

- Comments explain intent, business constraints, invariants, non-obvious trade-offs, and safe migration context.
- Do not narrate obvious syntax or preserve dead code in comments.
- Use TODO with an owner or decision reference where known. Never use TODO to conceal an unsafe assumption.
- Document public contracts, side effects, error outcomes, idempotency, and concurrency expectations.
- Record architectural decisions in an ADR rather than relying on comments.

## Error handling

- Fail clearly at the boundary nearest the cause and preserve enough context for diagnosis without exposing secrets or private data.
- Distinguish validation, authorisation, conflict, dependency, not-found, transient, and unexpected failures where behaviour differs.
- Return or throw structured errors according to the repository contract; do not mix conventions arbitrarily.
- Never silently swallow a required effect. If processing continues, record the failure and resulting partial state.
- Retry only transient, safe-to-repeat work, using bounded attempts and duplicate protection.
- Define user-facing recovery: correct input, retry, resume, manual review, or escalation.
- Log stable references and safe metadata, not credentials or unnecessary personal data.

## Review checks

- Does the code preserve the domain/source-of-truth boundary?
- Is variation configuration or genuinely different behaviour?
- Are input validation, permissions, idempotency, concurrency, errors, and partial failure explicit?
- Are names and timestamps unambiguous?
- Are tests proportional to the change risk?
- Is documentation updated without inventing production facts?
