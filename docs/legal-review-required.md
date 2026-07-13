# Legal review required before production

This document exists so nobody mistakes technical completeness for legal compliance.
None of the items below block local development; **all of them block production use**.

## Bookkeeping (Phase 5) — technical foundation only

The planned bookkeeping module is a **technical foundation, not an accounting product**.
It has **not** been reviewed against:

- **Bokföringslagen** (the Swedish Bookkeeping Act) — archiving requirements, verification
  numbering, immutability of posted entries, retention periods
- **Skattelagstiftning** — Swedish tax law, including reporting formats
- **GAAP / god redovisningssed** or any other accounting standard

Nothing the platform produces may be presented to users as compliant bookkeeping until a
qualified accountant/auditor and legal counsel have reviewed the design and output.
The data-model groundwork (integer minor units, currency per document, append-only
patterns) is deliberate but does not constitute compliance.

## Invoicing and VAT (Phase 4) — technical foundation only

Phase 4 (quotes, invoices, payments, credit notes, PDF) is **built**, but the money and tax
machinery is an engineering foundation, **not** a verified-compliant invoicing product. Every
item below needs professional review before the module is offered to real businesses:

- **VAT configuration and rounding are technical, not verified.** Per-line `tax_rate_percent`
  with HALF_UP line-level rounding and a per-rate `tax_lines` breakdown is a deterministic
  implementation choice — it has **not** been checked against **momslagen** or EU VAT rules
  (correct rates, rounding conventions, reverse charge, ROT/RUT deductions, cross-border and
  intra-EU rules, VAT registration numbers on the document).
- **Invoice content and numbering/immutability need review against bokföringslagen.**
  Sequential per-organization numbering (gap-free, concurrency-safe) and immutability of
  finalized invoices (corrections via credit notes only) are designed to align with
  bookkeeping-integrity principles, but mandatory invoice-content fields, archiving and
  retention requirements are **not** confirmed compliant.
- **Multi-currency assumes exactly two decimal places.** The integer-minor-unit model treats
  every currency as having 100 minor units per major unit (öre/cents). Currencies with a
  different number of decimal places are **not** handled and would need explicit work.

## GDPR

Designed but **not implemented** (tracked for Phase 9) or not yet done at all:

- **Data retention** — no retention/erasure policies are enforced for any data category
  (audit logs, sessions metadata, personnel data in Phase 3 will be especially sensitive)
- **Export (portability) and erasure** — organization export and deletion are designed,
  not implemented
- **DPA with subprocessors** — required for every production vendor (hosting, database,
  email, storage)
- **Records of processing activities** (Art. 30) — must be written before launch
- Lawful-basis analysis and privacy notice for end users

## Status

No legal, accounting or tax professional has reviewed any part of this codebase as of
2026-07-13.
