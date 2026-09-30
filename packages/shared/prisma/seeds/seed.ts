import { seedUsers } from './seed-users';
import { prisma } from '../../src/prisma/client';

export async function seedAll() {
  await seedUsers();
}

async function main() {
  try {
    await seedAll();
  } catch (error) {
    console.error('❌ Error during seeding:', error);
    throw error;
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
    console.log('\n✅ All seeds completed successfully!');
  })
  .catch(async e => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
