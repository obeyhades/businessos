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

## Invoicing and VAT (Phase 4)

Invoice content requirements (mandatory fields, sequential numbering), VAT rates, reverse
charge, ROT/RUT deductions and cross-border rules **need professional review** before the
invoicing module is offered to real businesses.

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
