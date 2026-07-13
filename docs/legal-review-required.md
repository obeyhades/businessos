# Legal review required before production

This document exists so nobody mistakes technical completeness for legal compliance.
None of the items below block local development; **all of them block production use**.

## Bookkeeping (Phase 5) — bookkeeping SUPPORT, pending professional review

Phase 5 (chart of accounts, fiscal years/periods, double-entry vouchers with
balance/period/immutability enforcement, reversal, reconciliation, trial-balance and
general-ledger reports, CSV export, and event-driven draft-voucher generation from invoices and
payments) is **built**. It is deliberately positioned as **bookkeeping _support_ — a technical
foundation, not a certified accounting product.** No qualified accountant, auditor or tax
professional has reviewed it. It is **not certified** for, and **must not** be presented to
users as compliant with, any of the following:

- **Bokföringslagen** (the Swedish Bookkeeping Act) — mandatory verification (verifikation)
  content, gap-free sequential numbering, immutability and correction rules, and **archiving /
  retention** periods (the immutability, per-org numbering and reversal-only-correction design
  is intended to align with these principles, but is **not confirmed compliant**).
- **Bokföringsnämnden (BFN)** general guidance and **god redovisningssed** (generally accepted
  accounting principles), or **GAAP** / any other accounting standard.
- **VAT (moms) reporting** — the auto-drafted output-VAT lines and any VAT figures are a
  technical convenience; VAT rates, reverse charge, periodic VAT returns and the like are **not**
  verified against momslagen / EU VAT rules (see the invoicing section below).
- **SIE and other e-accounting / bookkeeping-export standards** — the only export today is CSV
  (trial balance and journal). The Swedish **SIE** interchange format and any authority-accepted
  e-accounting export are **not** implemented.
- **Archiving and immutability legal requirements** — posted entries are immutable _in the
  application_, but statutory archival (durable, tamper-evident, retained for the legally
  required years) is **not** provided.
- **Tax filing (skattelagstiftning)** — no tax computation, declaration or filing format is
  produced or certified.

The auto-generated vouchers are always **DRAFTS**; the system never posts to the books on its
own. Even so, a qualified accountant/auditor and legal counsel **must** review the account
structure, posting rules, VAT treatment, numbering, archiving and export before any of this is
used for real bookkeeping. The engineering groundwork (integer minor units, per-document
currency, double-entry balance enforcement, posted-immutability, append-only patterns) is
deliberate but **does not constitute compliance**.

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
