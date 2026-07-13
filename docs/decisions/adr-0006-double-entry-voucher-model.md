# ADR-0006: Double-entry voucher model and posted-immutability

Status: accepted (2026-07)

## Context

Phase 5 adds bookkeeping support. A bookkeeping ledger must be trustworthy: entries have to
balance, they must fall inside a defined fiscal structure, and once committed they must not be
silently altered — the integrity principles behind bokföringslagen, even though this module is
not yet certified against it (see docs/legal-review-required.md). Options ranged from a simple
append-only transaction log to a full double-entry ledger. A single-sided log is easy but cannot
produce a trial balance or express the debit/credit structure accountants and downstream systems
expect. Allowing posted entries to be edited (or deleted) would make the ledger non-repudiable in
name only.

## Decision

Model the ledger as **double-entry vouchers** (verifikationer). A voucher is a dated journal
entry with **≥2 lines**, each line either a debit or a credit against a typed chart-of-accounts
account. A voucher's lifecycle is **DRAFT → POST → REVERSED**:

- **DRAFT** is fully editable and may be unbalanced.
- **POST** enforces the rules in one row-locked transaction — balanced (Σ debit = Σ credit),
  ≥2 lines, non-zero, and a covering **OPEN** fiscal period — then allocates a concurrency-safe
  per-org number (the `VOUCHER` `NumberSequence`, reusing ADR-style Phase 4 numbering) and marks
  the voucher **immutable**.
- Posted entries are **never edited or deleted**. The only correction is a **reversing voucher**
  that swaps debit and credit and links to the original via a `@unique` self-relation, so the
  pair nets to zero and a voucher can be reversed at most once.

Money is integer minor units (`BigInt`), consistent with Phase 4. Auto-generated vouchers from
invoices/payments are always DRAFTS; posting is a distinct, permissioned (`accounting.post`)
human action.

## Consequences

- The ledger can produce a trial balance and general ledger directly from voucher lines, and
  reports count `POSTED` + `REVERSED` (a reversal is itself posted, so both must be counted or
  the reversal would be left uncancelled).
- Posted-immutability plus reversal-only correction gives a non-repudiable audit trail that
  parallels invoice finalize-immutability (ADR-aligned with Phase 4) and the append-only audit
  log.
- Correcting a mistake costs a second voucher rather than an in-place edit — more entries, but a
  complete, tamper-evident history. This is intentional.
- Row-locking on post/reverse (`lockVoucherForUpdate`) plus the row-locked number sequence make
  concurrent postings safe (no duplicate numbers, no double-emit), at the cost of serializing
  transitions on a single voucher — acceptable at SMB volume.
- This is a technical foundation. Statutory compliance (verification content, archiving,
  numbering rules, SIE/e-accounting export, VAT and tax reporting) is **out of scope until
  professional review** — see docs/legal-review-required.md.
