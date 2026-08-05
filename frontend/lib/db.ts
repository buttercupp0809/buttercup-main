// Re-export the singleton so app code can `import { prisma } from "@/lib/db"`.
// Do not construct PrismaClient here. See CLAUDE.md.
export { prisma } from "@buttercupp/database";
