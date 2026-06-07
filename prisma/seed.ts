import { PrismaClient } from "@prisma/client";
import { LOCAL_USER } from "../lib/constants";
import { ensureBuiltinLibrary } from "../lib/game/builtin-library";

const prisma = new PrismaClient();

async function main() {
  await prisma.user.upsert({
    where: { id: LOCAL_USER.id },
    update: {},
    create: {
      id: LOCAL_USER.id,
      email: LOCAL_USER.email,
      name: LOCAL_USER.name,
    },
  });
  console.log("✓ Local user seeded:", LOCAL_USER.email);

  // 内置剧本库（幂等）
  await ensureBuiltinLibrary();
  console.log("✓ Builtin script library seeded");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
