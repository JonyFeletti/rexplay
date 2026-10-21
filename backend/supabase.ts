import { createClient } from "@supabase/supabase-js";
import { config } from "./config.js";

const url = config.supabase.url;
const serviceKey = config.supabase.serviceRoleKey;

if (!url || !serviceKey) {
  throw new Error(
    "Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en el backend. " +
      "Revisá backend/.env y que la app arranque con NODE_ENV distinto de 'test'."
  );
}

export const supabaseAdmin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});