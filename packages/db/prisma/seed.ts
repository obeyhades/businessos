/**
 * Development seed data. All people, companies and credentials are fictional.
 * Idempotent: safe to run repeatedly (upserts keyed on email/slug).
 *
 * Demo credentials are documented in the root README.
 */
import argon2 from 'argon2';
import { PrismaClient, OrganizationRole, type Prisma } from '@prisma/client';

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

  console.warn(`Seed complete: organization "${org.name}" with ${DEMO_USERS.length} users.`);
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

main()
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
