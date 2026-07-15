/**
 * Development seed data. All people, companies and credentials are fictional.
 * Idempotent: safe to run repeatedly (upserts keyed on email/slug).
 *
 * Demo credentials are documented in the root README.
 */
import argon2 from 'argon2';
import {
  PrismaClient,
  OrganizationRole,
  type AccountType,
  type FiscalPeriodStatus,
  type Prisma,
} from '@prisma/client';

const prisma = new PrismaClient();

const DEMO_ORG = { name: 'Demo Hantverk AB', slug: 'demo-hantverk', locale: 'sv', currency: 'SEK' };

const DEMO_USERS: Array<{
  email: string;
  name: string;
  password: string;
  role: OrganizationRole;
  locale: string;
  isPlatformAdmin?: boolean;
}> = [
  {
    email: 'owner@demo.businessos.local',
    name: 'Olivia Ohlsson',
    password: 'OwnerDemo123!',
    role: OrganizationRole.OWNER,
    locale: 'sv',
    isPlatformAdmin: true,
  },
  {
    email: 'admin@demo.businessos.local',
    name: 'Adam Andersson',
    password: 'AdminDemo123!',
    role: OrganizationRole.ADMIN,
    locale: 'sv',
  },
  {
    email: 'accountant@demo.businessos.local',
    name: 'Anna Ekström',
    password: 'AccountantDemo123!',
    role: OrganizationRole.ACCOUNTANT,
    locale: 'sv',
  },
  {
    email: 'erik@demo.businessos.local',
    name: 'Erik Eklund',
    password: 'EmployeeDemo123!',
    role: OrganizationRole.EMPLOYEE,
    locale: 'sv',
  },
  {
    email: 'fatima@demo.businessos.local',
    name: 'Fatima Nilsson',
    password: 'EmployeeDemo123!',
    role: OrganizationRole.EMPLOYEE,
    locale: 'en',
  },
];

async function main(): Promise<void> {
  const org = await prisma.organization.upsert({
    where: { slug: DEMO_ORG.slug },
    update: {},
    create: DEMO_ORG,
  });

  for (const demoUser of DEMO_USERS) {
    const passwordHash = await argon2.hash(demoUser.password, { type: argon2.argon2id });
    const user = await prisma.user.upsert({
      where: { email: demoUser.email },
      update: {},
      create: {
        email: demoUser.email,
        name: demoUser.name,
        locale: demoUser.locale,
        passwordHash,
        isPlatformAdmin: demoUser.isPlatformAdmin ?? false,
      },
    });

    await prisma.organizationMember.upsert({
      where: { organizationId_userId: { organizationId: org.id, userId: user.id } },
      update: { role: demoUser.role },
      create: { organizationId: org.id, userId: user.id, role: demoUser.role },
    });
  }

  const owner = await prisma.user.findUniqueOrThrow({
    where: { email: 'owner@demo.businessos.local' },
  });

  // A small audit trail so the audit-log viewer has content on first run.
  const existingAudit = await prisma.auditLog.count({ where: { organizationId: org.id } });
  if (existingAudit === 0) {
    await prisma.auditLog.createMany({
      data: [
        {
          organizationId: org.id,
          actorUserId: owner.id,
          action: 'organization.created',
          entityType: 'organization',
          entityId: org.id,
          metadata: { name: org.name, seeded: true },
        },
        {
          organizationId: org.id,
          actorUserId: owner.id,
          action: 'member.invited',
          entityType: 'invitation',
          metadata: { email: 'admin@demo.businessos.local', role: 'ADMIN', seeded: true },
        },
        {
          organizationId: org.id,
          actorUserId: owner.id,
          action: 'member.invitation_accepted',
          entityType: 'organization_member',
          metadata: { email: 'admin@demo.businessos.local', seeded: true },
        },
      ],
    });
  }

  await seedPhase2(org.id, owner.id);
  await seedPhase3(org.id, owner.id);
  await seedPhase4(org.id, owner.id);
  await seedPhase5(org.id, owner.id);
  await seedPhase6(org.id, owner.id);
  await seedPhase7(org.id, owner.id);

  console.warn(`Seed complete: organization "${org.name}" with ${DEMO_USERS.length} users.`);
}

/** Days offset helper for date-only fields. */
function daysFromNow(days: number): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return new Date(d.toISOString().slice(0, 10));
}

/**
 * Personnel: employees (with sensitive fields + a manager hierarchy, some
 * linked to demo users), a certification expiring soon, an absence request,
 * an onboarding template, and one employee onboarded from it (generating tasks).
 * All fictional data.
 */
async function seedPhase3(organizationId: string, ownerId: string): Promise<void> {
  const alreadySeeded = await prisma.employee.count({ where: { organizationId } });
  if (alreadySeeded > 0) return;

  const findUser = (email: string) => prisma.user.findUnique({ where: { email } });
  const [ownerUser, adminUser, erikUser, fatimaUser] = await Promise.all([
    findUser('owner@demo.businessos.local'),
    findUser('admin@demo.businessos.local'),
    findUser('erik@demo.businessos.local'),
    findUser('fatima@demo.businessos.local'),
  ]);

  // Manager first, so reports can reference it.
  const manager = await prisma.employee.create({
    data: {
      organizationId,
      firstName: 'Olivia',
      lastName: 'Ohlsson',
      workEmail: 'olivia@demo.businessos.local',
      jobTitle: 'Operations Manager',
      department: 'Operations',
      employmentStatus: 'ACTIVE',
      employmentType: 'FULL_TIME',
      startDate: daysFromNow(-800),
      userId: ownerUser?.id ?? null,
      personalIdNumber: '19850101-1234',
      homeCity: 'Goteborg',
      emergencyContactName: 'Anders Ohlsson',
      emergencyContactPhone: '+46 70 111 22 33',
      emergencyContactRelation: 'Spouse',
      createdById: ownerId,
    },
  });

  const staff = await prisma.employee.createManyAndReturn({
    data: [
      {
        organizationId,
        firstName: 'Erik',
        lastName: 'Eklund',
        workEmail: 'erik@demo.businessos.local',
        jobTitle: 'Carpenter',
        department: 'Field',
        employmentStatus: 'ACTIVE',
        employmentType: 'FULL_TIME',
        startDate: daysFromNow(-400),
        managerId: manager.id,
        userId: erikUser?.id ?? null,
        personalIdNumber: '19900615-5678',
        homeCity: 'Molndal',
        createdById: ownerId,
      },
      {
        organizationId,
        firstName: 'Fatima',
        lastName: 'Nilsson',
        workEmail: 'fatima@demo.businessos.local',
        jobTitle: 'Electrician',
        department: 'Field',
        employmentStatus: 'ON_LEAVE',
        employmentType: 'PART_TIME',
        startDate: daysFromNow(-200),
        managerId: manager.id,
        userId: fatimaUser?.id ?? null,
        personalIdNumber: '19920820-9012',
        homeCity: 'Goteborg',
        createdById: ownerId,
      },
    ],
  });
  const erik = staff[0];

  // A certification expiring within 30 days → surfaces on the dashboard.
  if (erik) {
    await prisma.certification.create({
      data: {
        organizationId,
        employeeId: erik.id,
        name: 'Hot Work Permit',
        issuer: 'Swedish Fire Protection Association',
        issuedDate: daysFromNow(-700),
        expiresAt: daysFromNow(25),
      },
    });
    await prisma.absenceRequest.create({
      data: {
        organizationId,
        employeeId: erik.id,
        type: 'VACATION',
        status: 'PENDING',
        startDate: daysFromNow(30),
        endDate: daysFromNow(44),
        reason: 'Summer holiday',
        createdById: ownerId,
      },
    });
  }

  // Reusable onboarding template.
  const template = await prisma.onboardingTemplate.create({
    data: {
      organizationId,
      name: 'Field employee onboarding',
      description: 'Standard checklist for new field staff.',
      type: 'ONBOARDING',
      createdById: ownerId,
      items: {
        create: [
          { organizationId, title: 'Sign employment contract', dueOffsetDays: 0, sortOrder: 0 },
          { organizationId, title: 'Issue safety equipment', dueOffsetDays: 1, sortOrder: 1 },
          { organizationId, title: 'Complete safety training', dueOffsetDays: 7, sortOrder: 2 },
          { organizationId, title: 'Assign first project', dueOffsetDays: 14, sortOrder: 3 },
        ],
      },
    },
    include: { items: true },
  });

  // A new hire onboarded from the template (generates dated tasks).
  const newHire = await prisma.employee.create({
    data: {
      organizationId,
      firstName: 'Johan',
      lastName: 'Berg',
      workEmail: 'johan@demo.businessos.local',
      jobTitle: 'Apprentice Carpenter',
      department: 'Field',
      employmentStatus: 'ONBOARDING',
      employmentType: 'FULL_TIME',
      startDate: daysFromNow(3),
      managerId: manager.id,
      createdById: ownerId,
    },
  });

  const assigneeId = adminUser?.id ?? ownerUser?.id ?? ownerId;
  const base = newHire.startDate ?? new Date();
  for (const item of template.items) {
    const due = new Date(base);
    due.setUTCDate(due.getUTCDate() + item.dueOffsetDays);
    await prisma.task.create({
      data: {
        organizationId,
        title: item.title,
        status: 'TODO',
        priority: 'MEDIUM',
        dueDate: due,
        employeeId: newHire.id,
        assigneeId,
        createdById: ownerId,
      },
    });
  }

  await prisma.activity.createMany({
    data: [
      {
        organizationId,
        actorUserId: ownerId,
        type: 'employee.created',
        employeeId: manager.id,
        metadata: { name: 'Olivia Ohlsson', seeded: true },
      },
      {
        organizationId,
        actorUserId: ownerId,
        type: 'employee.onboarding_started',
        employeeId: newHire.id,
        metadata: { template: template.name, taskCount: template.items.length, seeded: true },
      },
    ],
  });

  console.warn(`Seeded ${2 + staff.length} employees, 1 template and onboarding tasks.`);
}

/** Customers, contacts, projects, tasks, comments and a matching activity feed. */
async function seedPhase2(organizationId: string, ownerId: string): Promise<void> {
  const alreadySeeded = await prisma.customer.count({ where: { organizationId } });
  if (alreadySeeded > 0) return;

  const erik = await prisma.user.findUnique({ where: { email: 'erik@demo.businessos.local' } });
  const assigneeId = erik?.id ?? ownerId;

  const activities: Prisma.ActivityCreateManyInput[] = [];

  const customers = [
    {
      name: 'Lindqvist Fastigheter AB',
      orgNumber: '556677-8899',
      email: 'info@lindqvistfastigheter.se',
      phone: '+46 31 123 45 67',
      city: 'Goteborg',
      status: 'ACTIVE' as const,
      contact: { name: 'Karin Lindqvist', email: 'karin@lindqvistfastigheter.se', title: 'VD' },
    },
    {
      name: 'Berg & Soner Bygg',
      orgNumber: '559900-1122',
      email: 'kontakt@bergsoner.se',
      phone: '+46 8 555 12 34',
      city: 'Stockholm',
      status: 'ACTIVE' as const,
      contact: { name: 'Johan Berg', email: 'johan@bergsoner.se', title: 'Projektledare' },
    },
    {
      name: 'Solgarden Restaurang',
      email: 'hej@solgarden.se',
      city: 'Malmo',
      status: 'LEAD' as const,
      contact: { name: 'Maria Sol', email: 'maria@solgarden.se', title: 'Agare' },
    },
  ];

  for (const c of customers) {
    const customer = await prisma.customer.create({
      data: {
        organizationId,
        name: c.name,
        orgNumber: c.orgNumber ?? null,
        email: c.email,
        phone: c.phone ?? null,
        city: c.city,
        status: c.status,
        createdById: ownerId,
      },
    });
    activities.push({
      organizationId,
      actorUserId: ownerId,
      type: 'customer.created',
      customerId: customer.id,
      metadata: { name: customer.name, seeded: true },
    });

    await prisma.customerContact.create({
      data: {
        organizationId,
        customerId: customer.id,
        name: c.contact.name,
        email: c.contact.email,
        title: c.contact.title,
        isPrimary: true,
      },
    });
    activities.push({
      organizationId,
      actorUserId: ownerId,
      type: 'contact.added',
      customerId: customer.id,
      metadata: { name: c.contact.name, seeded: true },
    });

    // Give the first (active) customer a project with tasks + a comment.
    if (c.status === 'ACTIVE') {
      const project = await prisma.project.create({
        data: {
          organizationId,
          customerId: customer.id,
          name: `${c.city} — renovation`,
          description: 'Sample project created by the seed script.',
          status: 'ACTIVE',
          createdById: ownerId,
        },
      });
      activities.push({
        organizationId,
        actorUserId: ownerId,
        type: 'project.created',
        customerId: customer.id,
        projectId: project.id,
        metadata: { name: project.name, seeded: true },
      });

      const taskSpecs = [
        { title: 'Site inspection', status: 'DONE' as const, priority: 'HIGH' as const },
        { title: 'Prepare quote', status: 'IN_PROGRESS' as const, priority: 'MEDIUM' as const },
        { title: 'Order materials', status: 'TODO' as const, priority: 'MEDIUM' as const },
      ];
      for (const t of taskSpecs) {
        const task = await prisma.task.create({
          data: {
            organizationId,
            customerId: customer.id,
            projectId: project.id,
            title: t.title,
            status: t.status,
            priority: t.priority,
            assigneeId,
            completedAt: t.status === 'DONE' ? new Date() : null,
            createdById: ownerId,
          },
        });
        activities.push({
          organizationId,
          actorUserId: ownerId,
          type: t.status === 'DONE' ? 'task.completed' : 'task.created',
          customerId: customer.id,
          projectId: project.id,
          taskId: task.id,
          metadata: { title: task.title, seeded: true },
        });
      }

      await prisma.comment.create({
        data: {
          organizationId,
          authorId: ownerId,
          customerId: customer.id,
          body: 'Initial call went well — customer is keen to proceed this quarter.',
        },
      });
      activities.push({
        organizationId,
        actorUserId: ownerId,
        type: 'comment.added',
        customerId: customer.id,
        metadata: { seeded: true },
      });
    }
  }

  await prisma.activity.createMany({ data: activities });
  console.warn(`Seeded ${customers.length} customers with projects, tasks and activity.`);
}

/**
 * Products, a quote and invoices across the status range (draft/open/sent/
 * partially-paid/paid/overdue/cancelled/credited) with a payment and a credit
 * note. All money is integer minor units (öre). Amounts are chosen so tax is
 * exact, mirroring the API's line-level computation.
 */
async function seedPhase4(organizationId: string, ownerId: string): Promise<void> {
  const alreadySeeded = await prisma.product.count({ where: { organizationId } });
  if (alreadySeeded > 0) return;

  const customer = await prisma.customer.findFirst({
    where: { organizationId, status: 'ACTIVE' },
    orderBy: { name: 'asc' },
    select: { id: true },
  });
  if (!customer) return;
  const customerId = customer.id;

  await prisma.product.createMany({
    data: [
      {
        organizationId,
        name: 'Consulting hour',
        unit: 'hour',
        unitPriceMinor: 120000n,
        taxRatePercent: '25',
        createdById: ownerId,
      },
      {
        organizationId,
        name: 'Site visit',
        unit: 'visit',
        unitPriceMinor: 250000n,
        taxRatePercent: '25',
        createdById: ownerId,
      },
      {
        organizationId,
        name: 'Materials',
        unit: 'piece',
        unitPriceMinor: 40000n,
        taxRatePercent: '25',
        createdById: ownerId,
      },
    ],
  });

  // One draft quote (10 consulting hours @ 1200, 25% VAT).
  await prisma.quote.create({
    data: {
      organizationId,
      customerId,
      status: 'DRAFT',
      currency: 'SEK',
      issueDate: daysFromNow(0),
      validUntil: daysFromNow(30),
      subtotalMinor: 1_200_000n,
      taxMinor: 300_000n,
      totalMinor: 1_500_000n,
      taxLines: [{ ratePercent: '25.00', baseMinor: 1_200_000, taxMinor: 300_000 }],
      createdById: ownerId,
      lineItems: {
        create: [
          {
            organizationId,
            description: 'Consulting hour',
            quantity: '10',
            unitPriceMinor: 120000n,
            taxRatePercent: '25',
            lineNetMinor: 1_200_000n,
            lineTaxMinor: 300_000n,
            lineTotalMinor: 1_500_000n,
            sortOrder: 0,
          },
        ],
      },
    },
  });

  // A single-line invoice factory: net = unitPrice * qty, 25% VAT.
  async function makeInvoice(opts: {
    status: string;
    number: string | null;
    netMinor: bigint;
    issueOffset: number;
    dueOffset: number;
    finalized?: boolean;
    sent?: boolean;
    amountPaidMinor?: bigint;
    creditedMinor?: bigint;
    paidAt?: boolean;
    cancelled?: boolean;
  }) {
    const taxMinor = (opts.netMinor * 25n) / 100n;
    const totalMinor = opts.netMinor + taxMinor;
    return prisma.invoice.create({
      data: {
        organizationId,
        customerId,
        status: opts.status as never,
        number: opts.number,
        currency: 'SEK',
        issueDate: daysFromNow(opts.issueOffset),
        dueDate: daysFromNow(opts.dueOffset),
        subtotalMinor: opts.netMinor,
        taxMinor,
        totalMinor,
        amountPaidMinor: opts.amountPaidMinor ?? 0n,
        creditedMinor: opts.creditedMinor ?? 0n,
        taxLines: [
          { ratePercent: '25.00', baseMinor: Number(opts.netMinor), taxMinor: Number(taxMinor) },
        ],
        finalizedAt: opts.finalized ? daysFromNow(opts.issueOffset) : null,
        sentAt: opts.sent ? daysFromNow(opts.issueOffset) : null,
        paidAt: opts.paidAt ? daysFromNow(0) : null,
        cancelledAt: opts.cancelled ? daysFromNow(0) : null,
        createdById: ownerId,
        lineItems: {
          create: [
            {
              organizationId,
              description: 'Consulting hour',
              quantity: String(Number(opts.netMinor) / 120000),
              unitPriceMinor: 120000n,
              taxRatePercent: '25',
              lineNetMinor: opts.netMinor,
              lineTaxMinor: taxMinor,
              lineTotalMinor: totalMinor,
              sortOrder: 0,
            },
          ],
        },
      },
    });
  }

  await makeInvoice({
    status: 'DRAFT',
    number: null,
    netMinor: 240000n,
    issueOffset: 0,
    dueOffset: 30,
  });
  await makeInvoice({
    status: 'OPEN',
    number: 'INV-0001',
    netMinor: 600000n,
    issueOffset: -5,
    dueOffset: 25,
    finalized: true,
  });
  await makeInvoice({
    status: 'SENT',
    number: 'INV-0002',
    netMinor: 360000n,
    issueOffset: -10,
    dueOffset: 20,
    finalized: true,
    sent: true,
  });

  const partiallyPaid = await makeInvoice({
    status: 'PARTIALLY_PAID',
    number: 'INV-0003',
    netMinor: 1_200_000n,
    issueOffset: -12,
    dueOffset: 18,
    finalized: true,
    sent: true,
    amountPaidMinor: 500000n,
  });
  await prisma.payment.create({
    data: {
      organizationId,
      invoiceId: partiallyPaid.id,
      amountMinor: 500000n,
      method: 'BANK_TRANSFER',
      paidOn: daysFromNow(-2),
      createdById: ownerId,
    },
  });

  const paid = await makeInvoice({
    status: 'PAID',
    number: 'INV-0004',
    netMinor: 480000n,
    issueOffset: -20,
    dueOffset: 10,
    finalized: true,
    sent: true,
    amountPaidMinor: 600000n,
    paidAt: true,
  });
  await prisma.payment.create({
    data: {
      organizationId,
      invoiceId: paid.id,
      amountMinor: 600000n,
      method: 'SWISH',
      paidOn: daysFromNow(-1),
      createdById: ownerId,
    },
  });

  await makeInvoice({
    status: 'OVERDUE',
    number: 'INV-0005',
    netMinor: 800000n,
    issueOffset: -40,
    dueOffset: -10,
    finalized: true,
    sent: true,
  });
  await makeInvoice({
    status: 'CANCELLED',
    number: 'INV-0006',
    netMinor: 200000n,
    issueOffset: -8,
    dueOffset: 22,
    finalized: true,
    cancelled: true,
  });

  // A fully-credited invoice with a matching credit note.
  const credited = await makeInvoice({
    status: 'CREDITED',
    number: 'INV-0007',
    netMinor: 400000n,
    issueOffset: -15,
    dueOffset: 15,
    finalized: true,
    sent: true,
    creditedMinor: 500000n,
  });
  await prisma.creditNote.create({
    data: {
      organizationId,
      invoiceId: credited.id,
      number: 'CN-0001',
      status: 'ISSUED',
      currency: 'SEK',
      issueDate: daysFromNow(0),
      reason: 'Order cancelled by customer',
      subtotalMinor: 400000n,
      taxMinor: 100000n,
      totalMinor: 500000n,
      taxLines: [{ ratePercent: '25.00', baseMinor: 400000, taxMinor: 100000 }],
      issuedAt: daysFromNow(0),
      createdById: ownerId,
      lineItems: {
        create: [
          {
            organizationId,
            description: 'Consulting hour',
            quantity: '1',
            unitPriceMinor: 400000n,
            taxRatePercent: '25',
            lineNetMinor: 400000n,
            lineTaxMinor: 100000n,
            lineTotalMinor: 500000n,
            sortOrder: 0,
          },
        ],
      },
    },
  });

  // Advance the invoice/credit-note sequences past the seeded numbers so the
  // first API-finalized document does not collide.
  await prisma.numberSequence.createMany({
    data: [
      { organizationId, kind: 'INVOICE', prefix: 'INV-', padding: 4, next: 8 },
      { organizationId, kind: 'CREDIT_NOTE', prefix: 'CN-', padding: 4, next: 2 },
    ],
  });

  console.warn(
    'Seeded 3 products, 1 quote, 8 invoices (all statuses), payments and a credit note.',
  );
}

/**
 * Bookkeeping: a BAS-lite chart of accounts, a fiscal year with monthly periods
 * (January LOCKED to demonstrate period locking), the account mapping used for
 * auto-generated drafts, two POSTED vouchers (opening balance + a rent expense)
 * and one DRAFT manual voucher. All fictional; NOT reviewed for compliance.
 */
async function seedPhase5(organizationId: string, ownerId: string): Promise<void> {
  const already = await prisma.account.count({ where: { organizationId } });
  if (already > 0) return;

  const chart: Array<{ code: string; name: string; type: AccountType }> = [
    { code: '1220', name: 'Inventarier och verktyg', type: 'ASSET' },
    { code: '1510', name: 'Kundfordringar', type: 'ASSET' },
    { code: '1910', name: 'Kassa', type: 'ASSET' },
    { code: '1930', name: 'Företagskonto / bank', type: 'ASSET' },
    { code: '2081', name: 'Aktiekapital', type: 'EQUITY' },
    { code: '2440', name: 'Leverantörsskulder', type: 'LIABILITY' },
    { code: '2610', name: 'Utgående moms 25%', type: 'LIABILITY' },
    { code: '2640', name: 'Ingående moms', type: 'ASSET' },
    { code: '3001', name: 'Försäljning inom Sverige', type: 'REVENUE' },
    { code: '4000', name: 'Varuinköp', type: 'EXPENSE' },
    { code: '5000', name: 'Lokalkostnader', type: 'EXPENSE' },
    { code: '6000', name: 'Övriga externa kostnader', type: 'EXPENSE' },
    { code: '8999', name: 'Årets resultat', type: 'EQUITY' },
  ];
  await prisma.account.createMany({
    data: chart.map((c) => ({ organizationId, createdById: ownerId, ...c })),
  });
  const accounts = await prisma.account.findMany({
    where: { organizationId },
    select: { id: true, code: true },
  });
  const acc = (code: string): string => accounts.find((a) => a.code === code)!.id;

  // Fiscal year with 12 monthly periods; lock January to show period locking.
  const year = new Date().getUTCFullYear();
  const fiscalYear = await prisma.fiscalYear.create({
    data: {
      organizationId,
      name: String(year),
      startDate: new Date(Date.UTC(year, 0, 1)),
      endDate: new Date(Date.UTC(year, 11, 31)),
      periods: {
        create: Array.from({ length: 12 }, (_, m) => ({
          organizationId,
          name: `${year}-${String(m + 1).padStart(2, '0')}`,
          startDate: new Date(Date.UTC(year, m, 1)),
          endDate: new Date(Date.UTC(year, m + 1, 0)),
          status: (m === 0 ? 'LOCKED' : 'OPEN') as FiscalPeriodStatus,
        })),
      },
    },
    include: { periods: true },
  });
  const periodForDate = (d: Date): string | null =>
    fiscalYear.periods.find((p) => p.startDate <= d && d <= p.endDate)?.id ?? null;

  await prisma.accountMapping.create({
    data: {
      organizationId,
      salesAccountId: acc('3001'),
      outputVatAccountId: acc('2610'),
      receivableAccountId: acc('1510'),
      bankAccountId: acc('1930'),
    },
  });

  const now = new Date();
  const janFirst = new Date(Date.UTC(year, 0, 1));
  const juneFifteen = new Date(Date.UTC(year, 5, 15));
  const draftDate = daysFromNow(-1);

  // V-00001 — opening balance: Dr Bank 50 000 / Cr Share capital 50 000.
  await prisma.voucher.create({
    data: {
      organizationId,
      number: 'V-00001',
      date: janFirst,
      description: 'Opening balance — share capital',
      status: 'POSTED',
      source: 'OPENING_BALANCE',
      fiscalPeriodId: periodForDate(janFirst),
      totalDebitMinor: 5_000_000n,
      totalCreditMinor: 5_000_000n,
      postedAt: now,
      postedById: ownerId,
      createdById: ownerId,
      lines: {
        create: [
          {
            organizationId,
            accountId: acc('1930'),
            description: 'Bank',
            debitMinor: 5_000_000n,
            creditMinor: 0n,
            sortOrder: 0,
          },
          {
            organizationId,
            accountId: acc('2081'),
            description: 'Share capital',
            debitMinor: 0n,
            creditMinor: 5_000_000n,
            sortOrder: 1,
          },
        ],
      },
    },
  });

  // V-00002 — rent + input VAT: Dr Premises 10 000 + Dr Input VAT 2 500 / Cr Bank 12 500.
  await prisma.voucher.create({
    data: {
      organizationId,
      number: 'V-00002',
      date: juneFifteen,
      description: 'Office rent June',
      status: 'POSTED',
      source: 'MANUAL',
      fiscalPeriodId: periodForDate(juneFifteen),
      totalDebitMinor: 1_250_000n,
      totalCreditMinor: 1_250_000n,
      postedAt: now,
      postedById: ownerId,
      createdById: ownerId,
      lines: {
        create: [
          {
            organizationId,
            accountId: acc('5000'),
            description: 'Premises',
            debitMinor: 1_000_000n,
            creditMinor: 0n,
            sortOrder: 0,
          },
          {
            organizationId,
            accountId: acc('2640'),
            description: 'Input VAT',
            debitMinor: 250_000n,
            creditMinor: 0n,
            sortOrder: 1,
          },
          {
            organizationId,
            accountId: acc('1930'),
            description: 'Bank',
            debitMinor: 0n,
            creditMinor: 1_250_000n,
            sortOrder: 2,
          },
        ],
      },
    },
  });

  // A balanced DRAFT the accountant can review and post from the UI.
  await prisma.voucher.create({
    data: {
      organizationId,
      date: draftDate,
      description: 'Bank fees (draft)',
      status: 'DRAFT',
      source: 'MANUAL',
      fiscalPeriodId: periodForDate(draftDate),
      totalDebitMinor: 20_000n,
      totalCreditMinor: 20_000n,
      createdById: ownerId,
      lines: {
        create: [
          {
            organizationId,
            accountId: acc('6000'),
            description: 'Bank fees',
            debitMinor: 20_000n,
            creditMinor: 0n,
            sortOrder: 0,
          },
          {
            organizationId,
            accountId: acc('1930'),
            description: 'Bank',
            debitMinor: 0n,
            creditMinor: 20_000n,
            sortOrder: 1,
          },
        ],
      },
    },
  });

  // Advance the voucher sequence past the two seeded posted numbers.
  await prisma.numberSequence.create({
    data: { organizationId, kind: 'VOUCHER', prefix: 'V-', padding: 5, next: 3 },
  });

  console.warn(
    'Seeded 13 accounts, a fiscal year (Jan locked), account mapping, 2 posted vouchers and 1 draft.',
  );
}

/**
 * Calendar: a default team calendar with a single customer meeting (reminder +
 * two attendees), a weekly Mon/Wed standup that has one occurrence cancelled,
 * and a private focus block visible only to its owner. All fictional.
 */
async function seedPhase6(organizationId: string, ownerId: string): Promise<void> {
  const already = await prisma.calendar.count({ where: { organizationId } });
  if (already > 0) return;

  const calendar = await prisma.calendar.create({
    data: {
      organizationId,
      name: 'Team',
      color: '#3b82f6',
      type: 'TEAM',
      isDefault: true,
      createdById: ownerId,
    },
  });

  const [admin, erik] = await Promise.all([
    prisma.user.findUnique({ where: { email: 'admin@demo.businessos.local' } }),
    prisma.user.findUnique({ where: { email: 'erik@demo.businessos.local' } }),
  ]);
  const customer = await prisma.customer.findFirst({
    where: { organizationId },
    select: { id: true },
  });

  // UTC date `days` from now at hh:mm.
  const at = (days: number, hour: number, minute = 0): Date => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + days);
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hour, minute));
  };
  const addMinutes = (d: Date, m: number): Date => new Date(d.getTime() + m * 60_000);
  const addDays = (d: Date, days: number): Date => new Date(d.getTime() + days * 86_400_000);

  // 1. Single customer meeting tomorrow 10:00–11:00, reminder 30 min before.
  await prisma.calendarEvent.create({
    data: {
      organizationId,
      calendarId: calendar.id,
      title: 'Customer kickoff',
      location: 'Office',
      startsAt: at(1, 10),
      endsAt: at(1, 11),
      organizerId: ownerId,
      customerId: customer?.id ?? null,
      createdById: ownerId,
      attendees: {
        create: [
          { organizationId, userId: ownerId, response: 'ACCEPTED', isOrganizer: true },
          ...(admin
            ? [{ organizationId, userId: admin.id, response: 'NEEDS_ACTION' as const }]
            : []),
        ],
      },
      reminders: { create: [{ organizationId, minutesBefore: 30 }] },
    },
  });

  // 2. Weekly Mon/Wed standup, starting the next Monday 09:00; one occurrence
  //    (two Mondays out) is cancelled.
  const now = new Date();
  const daysToMonday = (1 - now.getUTCDay() + 7) % 7 || 7;
  const standupStart = at(daysToMonday, 9);
  const standup = await prisma.calendarEvent.create({
    data: {
      organizationId,
      calendarId: calendar.id,
      title: 'Daily standup',
      startsAt: standupStart,
      endsAt: addMinutes(standupStart, 15),
      organizerId: ownerId,
      createdById: ownerId,
      recurrenceFreq: 'WEEKLY',
      recurrenceInterval: 1,
      recurrenceByWeekday: [1, 3],
      attendees: {
        create: [
          { organizationId, userId: ownerId, response: 'ACCEPTED', isOrganizer: true },
          ...(erik ? [{ organizationId, userId: erik.id, response: 'ACCEPTED' as const }] : []),
        ],
      },
      reminders: { create: [{ organizationId, minutesBefore: 10 }] },
    },
  });
  await prisma.eventException.create({
    data: {
      organizationId,
      eventId: standup.id,
      occurrenceStart: addDays(standupStart, 14),
      type: 'CANCELLED',
    },
  });

  // 3. Private focus block for the owner only.
  await prisma.calendarEvent.create({
    data: {
      organizationId,
      calendarId: calendar.id,
      title: 'Focus time',
      visibility: 'PRIVATE',
      startsAt: at(2, 13),
      endsAt: at(2, 15),
      organizerId: ownerId,
      createdById: ownerId,
      attendees: {
        create: [{ organizationId, userId: ownerId, response: 'ACCEPTED', isOrganizer: true }],
      },
    },
  });

  console.warn(
    'Seeded a team calendar with 3 events (single, weekly recurring w/ exception, private).',
  );
}

/**
 * Email: a shared info@ mailbox, two labels, and three conversations — an
 * inbound message from a customer (auto-linked to that customer), a sent reply,
 * and a draft. All fictional.
 */
async function seedPhase7(organizationId: string, ownerId: string): Promise<void> {
  const already = await prisma.emailAccount.count({ where: { organizationId } });
  if (already > 0) return;

  const account = await prisma.emailAccount.create({
    data: {
      organizationId,
      address: 'info@demo.businessos.local',
      displayName: 'Demo Hantverk Support',
      type: 'SHARED',
      createdById: ownerId,
    },
  });
  await prisma.emailLabel.createMany({
    data: [
      { organizationId, name: 'Sales', color: '#16a34a' },
      { organizationId, name: 'Support', color: '#2563eb' },
    ],
  });

  const customer = await prisma.customer.findFirst({
    where: { organizationId },
    select: { id: true, email: true, name: true },
  });
  const customerEmail = customer?.email ?? 'kund@example.com';
  const now = new Date();
  const hoursAgo = (h: number): Date => new Date(now.getTime() - h * 3_600_000);

  // 1. Inbound conversation from a customer (auto-linked).
  const inbound = await prisma.emailThread.create({
    data: {
      organizationId,
      accountId: account.id,
      subject: 'Question about my quote',
      snippet: 'Hi, could you clarify the delivery time on the quote you sent?',
      folder: 'INBOX',
      unread: true,
      messageCount: 1,
      lastMessageAt: hoursAgo(3),
      customerId: customer?.id ?? null,
    },
  });
  await prisma.emailMessage.create({
    data: {
      organizationId,
      threadId: inbound.id,
      accountId: account.id,
      direction: 'INBOUND',
      status: 'RECEIVED',
      fromAddress: customerEmail,
      fromName: customer?.name ?? 'Customer',
      toAddresses: [account.address],
      subject: 'Question about my quote',
      bodyText: 'Hi,\n\nCould you clarify the delivery time on the quote you sent? Thanks!',
      messageId: `<inbound-1@example.com>`,
      isRead: false,
      receivedAt: hoursAgo(3),
    },
  });

  // 2. A sent conversation.
  const sent = await prisma.emailThread.create({
    data: {
      organizationId,
      accountId: account.id,
      subject: 'Welcome to Demo Hantverk',
      snippet: 'Thanks for reaching out — here is what you need to know.',
      folder: 'INBOX',
      unread: false,
      messageCount: 1,
      lastMessageAt: hoursAgo(26),
      customerId: customer?.id ?? null,
    },
  });
  await prisma.emailMessage.create({
    data: {
      organizationId,
      threadId: sent.id,
      accountId: account.id,
      direction: 'OUTBOUND',
      status: 'SENT',
      fromAddress: account.address,
      fromName: account.displayName,
      toAddresses: [customerEmail],
      subject: 'Welcome to Demo Hantverk',
      bodyText: 'Thanks for reaching out — here is what you need to know to get started.',
      messageId: `<sent-1@demo.businessos.local>`,
      isRead: true,
      sentAt: hoursAgo(26),
      createdById: ownerId,
    },
  });

  // 3. A draft.
  const draft = await prisma.emailThread.create({
    data: {
      organizationId,
      accountId: account.id,
      subject: 'Follow-up on your project',
      snippet: 'Just checking in on the project timeline…',
      folder: 'INBOX',
      unread: false,
      messageCount: 1,
      lastMessageAt: hoursAgo(1),
    },
  });
  await prisma.emailMessage.create({
    data: {
      organizationId,
      threadId: draft.id,
      accountId: account.id,
      direction: 'OUTBOUND',
      status: 'DRAFT',
      fromAddress: account.address,
      fromName: account.displayName,
      toAddresses: [customerEmail],
      subject: 'Follow-up on your project',
      bodyText: 'Just checking in on the project timeline. Let me know if you have questions.',
      isRead: true,
      createdById: ownerId,
    },
  });

  console.warn(
    'Seeded a shared mailbox, 2 labels, and 3 email conversations (inbound, sent, draft).',
  );
}

main()
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
