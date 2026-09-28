/**
 * HTML entry must not statically import bun:sqlite (or adapters that do).
 * API handlers load in a separate module after the browser bundle is defined.
 */
import page from "./index.html";

const { handleApi } = await import("./api");

const port = Number(process.env.PORT ?? 8766);
const server = Bun.serve({
  hostname: "127.0.0.1",
  port,
  routes: { "/": page },
  fetch: handleApi,
});
console.log(`Lattice explorer: ${server.url}`);
