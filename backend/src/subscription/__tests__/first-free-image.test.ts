import { beforeEach, afterAll, test, expect } from "vitest";
import { prisma } from "@buttercupp/database";
import { consumeFirstFreeImage } from "../enforce";

// Minimal test user seeded inline to avoid cross-test pollution.
const TEST_USER_ID = "test-first-img-user";

beforeEach(async () => {
  await prisma.usageCounter.deleteMany({
    where: { userId: TEST_USER_ID, counterType: "first_image_delivered" },
  });
});

afterAll(async () => {
  await prisma.usageCounter.deleteMany({
    where: { userId: TEST_USER_ID, counterType: "first_image_delivered" },
  });
  await prisma.$disconnect();
});

test("returns true on very first call", async () => {
  const result = await consumeFirstFreeImage(TEST_USER_ID);
  expect(result).toBe(true);
});

test("returns false on all subsequent calls", async () => {
  await consumeFirstFreeImage(TEST_USER_ID); // consumes slot
  expect(await consumeFirstFreeImage(TEST_USER_ID)).toBe(false);
  expect(await consumeFirstFreeImage(TEST_USER_ID)).toBe(false);
});
