// Import only binding types so Worker globals do not replace browser DOM types.
declare module "cloudflare:workers" {
  export const env: {
    DB: import("@cloudflare/workers-types").D1Database;
    OPENAI_API_KEY?: string;
    PARLIAMO_ENABLE_PAID_AI?: string;
  };
}
