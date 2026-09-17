import bcrypt from 'bcrypt';

import { prisma } from '../../prisma/client';

export async function seedUsers() {
  console.log('🌱 Seeding Users...');

  const passwordHash = bcrypt.hashSync('123456', 10);

  await prisma.users.upsert({
    where: { email: 'admin@admin.com' },
    update: {
      password: passwordHash,
      status: 'ACTIVE'
    },
    create: {
      email: 'admin@admin.com',
      password: passwordHash,
      status: 'ACTIVE'
    }
  });

  await prisma.users.upsert({
    where: { email: 'user@user.com' },
    update: {
      password: passwordHash,
      status: 'ACTIVE'
    },
    create: {
      email: 'user@user.com',
      password: passwordHash,
      status: 'ACTIVE'
    }
  });

  await prisma.$executeRaw`
    SELECT setval(
      pg_get_serial_sequence('users', 'id')::regclass,
      (SELECT COALESCE(MAX(id), 0)::bigint FROM users),
      true
    )
  `;

  console.log('✅ Users seeded');
}
