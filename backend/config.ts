const env = process.env;
const isProd = env.NODE_ENV === "production";

export const config = {
  isProd,
  port: Number(env.PORT ?? 3001),
  host: env.HOST ?? (isProd ? "0.0.0.0" : "127.0.0.1"),
  appUrl: (env.APP_URL ?? "http://localhost:5173").replace(/\/$/, ""),

  supabase: {
    url: env.SUPABASE_URL ?? "",
    serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  },

  mp: {
    accessToken: env.MP_ACCESS_TOKEN ?? "",
    publicKey: env.MP_PUBLIC_KEY ?? "",
    webhookSecret: env.MP_WEBHOOK_SECRET ?? "",
    apiBase: (env.MP_API_BASE ?? "https://api.mercadopago.com").replace(/\/$/, ""),
  },

  mail: {
    from: env.MAIL_FROM ?? "RexPlay <no-reply@rexplay.example>",
    smtpUrl: env.SMTP_URL ?? "",
  },

  adminToken: env.ADMIN_TOKEN ?? "",
};

export function assertProductionConfig(): void {
  if (!config.isProd) return;
  const missing: string[] = [];
  if (!config.supabase.url) missing.push("SUPABASE_URL");
  if (!config.supabase.serviceRoleKey) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  if (!config.mp.accessToken) missing.push("MP_ACCESS_TOKEN");
  if (!config.mp.publicKey) missing.push("MP_PUBLIC_KEY");
  if (!config.mp.webhookSecret) missing.push("MP_WEBHOOK_SECRET");
  if (!config.mail.smtpUrl) missing.push("SMTP_URL");
  if (!env.APP_URL) missing.push("APP_URL");
  if (missing.length) {
    throw new Error(
      `Faltan variables de entorno para producción: ${missing.join(", ")}.`,
    );
  }
}