/**
 * Development seed data. All people, companies and credentials are fictional.
 * Idempotent: safe to run repeatedly (upserts keyed on email/slug).
 *
 * Demo credentials are documented in the root README.
 */
import argon2 from 'argon2';
import { PrismaClient, OrganizationRole } from '@prisma/client';

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

  console.warn(`Seed complete: organization "${org.name}" with ${DEMO_USERS.length} users.`);
}

main()
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
