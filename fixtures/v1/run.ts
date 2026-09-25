import { prepareFixtures } from "@/fixtures/prepare";

if (import.meta.main) {
  await prepareFixtures({ version: "v1", all: true });
}
