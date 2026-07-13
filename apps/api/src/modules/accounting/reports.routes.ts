import {
  generalLedgerDtoSchema,
  generalLedgerQuerySchema,
  reportQuerySchema,
  trialBalanceDtoSchema,
  type GeneralLedgerAccount,
  type GeneralLedgerEntry,
  type TrialBalanceRow,
} from '@businessos/types';
import { type Prisma as PrismaTypes } from '@businessos/db';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { orgContext, requirePermission } from '../../plugins/auth.js';
import { parseIsoDate, reportingStatuses } from './service.js';

const num = (v: bigint | null): number => Number(v ?? 0n);
const isoDate = (d: Date): string => d.toISOString().slice(0, 10);

function dateFilter(from?: string, to?: string): PrismaTypes.DateTimeFilter | undefined {
  if (!from && !to) return undefined;
  return {
    ...(from ? { gte: parseIsoDate(from) } : {}),
    ...(to ? { lte: parseIsoDate(to) } : {}),
  };
}

/** Minor units → a plain decimal string with 2 places for CSV/import. */
function money(minor: number): string {
  const neg = minor < 0;
  const abs = Math.abs(minor);
  const s = `${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
  return neg ? `-${s}` : s;
}

function csvCell(value: string | number): string {
  let s = String(value);
  // Neutralize spreadsheet formula injection in free-text cells (account names,
  // descriptions). Numeric cells — including negative money like "-12.34" — are
  // left intact so they still parse as numbers.
  const isNumeric = typeof value === 'number' || /^-?\d+(\.\d+)?$/.test(s);
  if (!isNumeric && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const csvRow = (cells: (string | number)[]): string => cells.map(csvCell).join(',');

interface TrialBalance {
  rows: TrialBalanceRow[];
  totalDebitMinor: number;
  totalCreditMinor: number;
  isBalanced: boolean;
}

async function computeTrialBalance(
  prisma: FastifyInstance['prisma'],
  organizationId: string,
  opts: { from?: string; to?: string; includeDrafts: boolean },
): Promise<TrialBalance> {
  const voucherWhere: PrismaTypes.VoucherWhereInput = {
    status: { in: reportingStatuses(opts.includeDrafts) },
  };
  const df = dateFilter(opts.from, opts.to);
  if (df) voucherWhere.date = df;

  const grouped = await prisma.voucherLine.groupBy({
    by: ['accountId'],
    where: { organizationId, voucher: voucherWhere },
    _sum: { debitMinor: true, creditMinor: true },
  });
  const accounts = await prisma.account.findMany({
    where: { organizationId, id: { in: grouped.map((g) => g.accountId) } },
    select: { id: true, code: true, name: true, type: true },
  });
  const byId = new Map(accounts.map((a) => [a.id, a]));

  const rows: TrialBalanceRow[] = grouped
    .map((g) => {
      const a = byId.get(g.accountId)!;
      const debitMinor = num(g._sum.debitMinor);
      const creditMinor = num(g._sum.creditMinor);
      return {
        accountId: g.accountId,
        code: a.code,
        name: a.name,
        type: a.type,
        debitMinor,
        creditMinor,
        balanceMinor: debitMinor - creditMinor,
      };
    })
    .sort((x, y) => x.code.localeCompare(y.code));

  const totalDebitMinor = rows.reduce((s, r) => s + r.debitMinor, 0);
  const totalCreditMinor = rows.reduce((s, r) => s + r.creditMinor, 0);
  return {
    rows,
    totalDebitMinor,
    totalCreditMinor,
    isBalanced: totalDebitMinor === totalCreditMinor,
  };
}

export function registerReportRoutes(app: FastifyInstance): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.route({
    method: 'GET',
    url: '/v1/accounting/reports/trial-balance',
    preHandler: [requirePermission('accounting.read')],
    schema: {
      tags: ['accounting'],
      querystring: reportQuerySchema,
      response: { 200: trialBalanceDtoSchema },
    },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const includeDrafts = request.query.includeDrafts === 'true';
      const tb = await computeTrialBalance(app.prisma, organizationId, {
        from: request.query.from,
        to: request.query.to,
        includeDrafts,
      });
      return reply.send({
        ...tb,
        from: request.query.from ?? null,
        to: request.query.to ?? null,
        includeDrafts,
      });
    },
  });

  r.route({
    method: 'GET',
    url: '/v1/accounting/reports/general-ledger',
    preHandler: [requirePermission('accounting.read')],
    schema: {
      tags: ['accounting'],
      querystring: generalLedgerQuerySchema,
      response: { 200: generalLedgerDtoSchema },
    },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const q = request.query;
      const includeDrafts = q.includeDrafts === 'true';
      const statuses = reportingStatuses(includeDrafts);

      // Opening balance = net of everything before `from` (0 if no `from`).
      const opening = new Map<string, number>();
      if (q.from) {
        const before = await app.prisma.voucherLine.groupBy({
          by: ['accountId'],
          where: {
            organizationId,
            ...(q.accountId ? { accountId: q.accountId } : {}),
            voucher: { status: { in: statuses }, date: { lt: parseIsoDate(q.from) } },
          },
          _sum: { debitMinor: true, creditMinor: true },
        });
        for (const g of before) {
          opening.set(g.accountId, num(g._sum.debitMinor) - num(g._sum.creditMinor));
        }
      }

      const df = dateFilter(q.from, q.to);
      const lines = await app.prisma.voucherLine.findMany({
        where: {
          organizationId,
          ...(q.accountId ? { accountId: q.accountId } : {}),
          voucher: { status: { in: statuses }, ...(df ? { date: df } : {}) },
        },
        include: {
          account: { select: { code: true, name: true, type: true } },
          voucher: { select: { id: true, number: true, date: true, description: true } },
        },
        orderBy: [
          { voucher: { date: 'asc' } },
          { voucher: { createdAt: 'asc' } },
          { sortOrder: 'asc' },
        ],
      });

      const accountsMap = new Map<string, GeneralLedgerAccount>();
      const running = new Map<string, number>();
      for (const l of lines) {
        let acc = accountsMap.get(l.accountId);
        if (!acc) {
          const open = opening.get(l.accountId) ?? 0;
          acc = {
            accountId: l.accountId,
            code: l.account.code,
            name: l.account.name,
            type: l.account.type,
            openingBalanceMinor: open,
            closingBalanceMinor: open,
            entries: [],
          };
          accountsMap.set(l.accountId, acc);
          running.set(l.accountId, open);
        }
        const debitMinor = num(l.debitMinor);
        const creditMinor = num(l.creditMinor);
        const newRunning = running.get(l.accountId)! + debitMinor - creditMinor;
        running.set(l.accountId, newRunning);
        const entry: GeneralLedgerEntry = {
          voucherId: l.voucher.id,
          voucherNumber: l.voucher.number,
          date: isoDate(l.voucher.date),
          description: l.voucher.description,
          debitMinor,
          creditMinor,
          runningBalanceMinor: newRunning,
        };
        acc.entries.push(entry);
        acc.closingBalanceMinor = newRunning;
      }

      // Accounts with a non-zero carried-forward opening balance but no entries
      // in [from,to] would otherwise vanish — surface them with empty entries.
      const missingOpening = [...opening.entries()].filter(
        ([id, bal]) => bal !== 0 && !accountsMap.has(id),
      );
      if (missingOpening.length > 0) {
        const metas = await app.prisma.account.findMany({
          where: { organizationId, id: { in: missingOpening.map(([id]) => id) } },
          select: { id: true, code: true, name: true, type: true },
        });
        for (const m of metas) {
          const bal = opening.get(m.id) ?? 0;
          accountsMap.set(m.id, {
            accountId: m.id,
            code: m.code,
            name: m.name,
            type: m.type,
            openingBalanceMinor: bal,
            closingBalanceMinor: bal,
            entries: [],
          });
        }
      }

      const accounts = [...accountsMap.values()].sort((a, b) => a.code.localeCompare(b.code));
      return reply.send({
        accounts,
        from: q.from ?? null,
        to: q.to ?? null,
        includeDrafts,
      });
    },
  });

  // --- CSV exports ------------------------------------------------------------

  r.route({
    method: 'GET',
    url: '/v1/accounting/exports/trial-balance.csv',
    preHandler: [requirePermission('accounting.read')],
    schema: { tags: ['accounting'], querystring: reportQuerySchema },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const includeDrafts = request.query.includeDrafts === 'true';
      const tb = await computeTrialBalance(app.prisma, organizationId, {
        from: request.query.from,
        to: request.query.to,
        includeDrafts,
      });
      const out = [csvRow(['Account', 'Name', 'Type', 'Debit', 'Credit', 'Balance'])];
      for (const row of tb.rows) {
        out.push(
          csvRow([
            row.code,
            row.name,
            row.type,
            money(row.debitMinor),
            money(row.creditMinor),
            money(row.balanceMinor),
          ]),
        );
      }
      out.push(
        csvRow(['', 'TOTAL', '', money(tb.totalDebitMinor), money(tb.totalCreditMinor), '']),
      );
      return reply
        .header('content-type', 'text/csv; charset=utf-8')
        .header('content-disposition', 'attachment; filename="trial-balance.csv"')
        .send(`${out.join('\n')}\n`);
    },
  });

  r.route({
    method: 'GET',
    url: '/v1/accounting/exports/journal.csv',
    preHandler: [requirePermission('accounting.read')],
    schema: { tags: ['accounting'], querystring: reportQuerySchema },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const includeDrafts = request.query.includeDrafts === 'true';
      const df = dateFilter(request.query.from, request.query.to);
      const lines = await app.prisma.voucherLine.findMany({
        where: {
          organizationId,
          voucher: {
            status: { in: reportingStatuses(includeDrafts) },
            ...(df ? { date: df } : {}),
          },
        },
        include: {
          account: { select: { code: true, name: true } },
          voucher: { select: { number: true, date: true, description: true, createdAt: true } },
        },
        orderBy: [
          { voucher: { date: 'asc' } },
          { voucher: { createdAt: 'asc' } },
          { sortOrder: 'asc' },
        ],
      });
      const out = [
        csvRow([
          'Voucher',
          'Date',
          'VoucherDescription',
          'Account',
          'AccountName',
          'LineDescription',
          'Debit',
          'Credit',
        ]),
      ];
      for (const l of lines) {
        out.push(
          csvRow([
            l.voucher.number ?? '',
            isoDate(l.voucher.date),
            l.voucher.description,
            l.account.code,
            l.account.name,
            l.description ?? '',
            money(num(l.debitMinor)),
            money(num(l.creditMinor)),
          ]),
        );
      }
      return reply
        .header('content-type', 'text/csv; charset=utf-8')
        .header('content-disposition', 'attachment; filename="journal.csv"')
        .send(`${out.join('\n')}\n`);
    },
  });
}
