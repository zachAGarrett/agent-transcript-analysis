/// <reference types="bun" />

declare module "*.html" {
  const bundle: Bun.HTMLBundle;
  export default bundle;
}

declare module "*.css" {}
