import { prepareFixtures } from "@/fixtures/prepare";

if (import.meta.main) {
  await prepareFixtures({ version: "v2", all: true });
}
