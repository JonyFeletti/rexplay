import { supabase } from "./supabase";

const API_BASE = import.meta.env.PROD ? "" : "http://localhost:3001";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function api<T = unknown>(
  path: string,
  opts: { method?: string; body?: unknown } = {}
): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const profileId = localStorage.getItem("rexplay_active_profile");

  const headers: Record<string, string> = {};
  if (opts.body) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;
  if (profileId) headers["x-profile-id"] = profileId;

  const res = await fetch(`${API_BASE}${path}`, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });

  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    /* sin cuerpo */
  }

  if (!res.ok) {
    const detail = (json as { detail?: unknown } | null)?.detail;
    throw new ApiError(
      typeof detail === "string" ? detail : "Revisá los datos e intentá de nuevo.",
      res.status
    );
  }
  return json as T;
}

// ---------- Tipos ----------
export type Subscription = {
  plan_id: string;
  plan_name: string;
  price: number;
  period_days: number;
  grace_days: number;
  status: "pending" | "active" | "past_due" | "canceled";
  has_access: boolean;
  card_brand: string | null;
  card_last4: string | null;
  current_period_end: string | null;
  next_billing_at: string | null;
  grace_ends_at: string | null;
  cancel_at_period_end: boolean;
  failed_attempts: number;
  canceled_reason: string | null;
};

export type PaymentRow = {
  kind: "initial" | "renewal";
  amount: number;
  status: "succeeded" | "failed";
  failure_reason: string | null;
  created_at: string;
};

export type Profile = { id: number; name: string; avatar: string };

export type Me = {
  user: { id: string; email: string; name: string; doc_type: string | null; doc_number: string | null } | null;
  subscription: Subscription | null;
  payments: PaymentRow[];
  profiles: Profile[];
  max_profiles: number;
  avatars: string[];
};

export type ContinueItem = {
  media_type: "movie" | "tv";
  tmdb_id: number;
  season: number;
  episode: number;
  title: string;
  episode_title: string | null;
  poster_path: string | null;
  backdrop_path: string | null;
  position_seconds: number;
  duration_seconds: number;
  remaining_seconds: number | null;
  ratio: number | null;
  source: "player" | "estimated";
};

export type Plan = {
  id: string;
  name: string;
  price: number;
  description: string;
  period_days: number;
  grace_days: number;
};

export type CardData = {
  token: string;
  payment_method_id?: string;
  identification?: { type: string; number: string };
};

// ---------- Helpers ----------
export const money = (cents: number): string =>
  new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(cents / 100);

export const fmtDate = (iso: string | null | undefined): string =>
  iso
    ? new Date(iso).toLocaleDateString("es-AR", {
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: "America/Argentina/Buenos_Aires",
      })
    : "—";

export const getActiveProfileId = (): number | null => {
  const raw = localStorage.getItem("rexplay_active_profile");
  return raw ? Number(raw) : null;
};

export const setActiveProfileId = (id: number | null): void => {
  if (id === null) localStorage.removeItem("rexplay_active_profile");
  else localStorage.setItem("rexplay_active_profile", String(id));
};