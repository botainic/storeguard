import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const result = await prisma.shop.updateMany({
  where: { shopifyDomain: 'insight-ops-dev.myshopify.com' },
  data: { stripeCustomerId: null }
});
console.log('Cleared stripeCustomerId for', result.count, 'shops');
await prisma.$disconnect();
