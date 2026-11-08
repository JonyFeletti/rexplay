import crypto from "node:crypto";
import { config } from "./config.js";
import { supabaseAdmin } from "./supabase.js";
import { HttpError } from "./errors.js";
import * as emailVerification from "./emailVerification.js";
import { sendOnce, templates } from "./mailer.js";
import { MercadoPagoClient, MercadoPagoError } from "./mercadopago.js";
import type { AuthorizedPayment, Payment } from "./mercadopago.js";
import type { SubscriptionRow, UserBasic, CardInput } from "./types.js";

export interface Plan {
  id: string;
  name: string;
  price: number;
  description: string;
  period_days: number;
  grace_days: number;
}

export const PRICE_CENTS = 599_900;
export const PERIOD_DAYS = 31;
export const GRACE_DAYS = 5;
export const PENDING_ACCESS_HOURS = 24;

export const PLANS: Record<string, Plan> = {
  unico: {
    id: "unico",
    name: "RexPlay",
    price: PRICE_CENTS,
    description: "TV en vivo y películas",
    period_days: PERIOD_DAYS,
    grace_days: GRACE_DAYS,
  },
};

export const mp = new MercadoPagoClient();

const now = (): Date => new Date();
const addDays = (d: Date, days: number): Date => new Date(d.getTime() + days * 86_400_000);
const parse = (s: string): Date => new Date(s);
const fmt = (d: Date): string => d.toISOString();

async function getUser(userId: string): Promise<UserBasic | undefined> {
  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("name")
    .eq("id", userId)
    .maybeSingle();

  const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(userId);
  if (!authUser?.user) return undefined;
  return {
    id: userId,
    email: authUser.user.email ?? "",
    name: profile?.name ?? authUser.user.email ?? "Usuario",
  };
}

async function getSub(id: number): Promise<SubscriptionRow | undefined> {
  const { data } = await supabaseAdmin.from("subscriptions").select("*").eq("id", id).maybeSingle();
  return (data as SubscriptionRow | null) ?? undefined;
}

export async function latestSubscription(userId: string): Promise<SubscriptionRow | undefined> {
  const { data } = await supabaseAdmin
    .from("subscriptions")
    .select("*")
    .eq("user_id", userId)
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as SubscriptionRow | null) ?? undefined;
}

export function hasAccess(
  s: Pick<SubscriptionRow, "status" | "current_period_end" | "grace_ends_at" | "cancel_at_period_end"> & {
    created_at?: string;
  },
  t: Date = now(),
): boolean {
  if (s.status === "pending") {
    if (!s.created_at) return false;
    return t.getTime() <= parse(s.created_at).getTime() + PENDING_ACCESS_HOURS * 3_600_000;
  }
  if (s.status === "active") {
    if (!s.current_period_end) return false;
    const end = parse(s.current_period_end);
    return t <= (s.cancel_at_period_end ? end : addDays(end, GRACE_DAYS));
  }
  if (s.status === "past_due") return !!s.grace_ends_at && t <= parse(s.grace_ends_at);
  return false;
}

const BRANDS: Record<string, string> = {
  visa: "Visa",
  debvisa: "Visa débito",
  master: "Mastercard",
  debmaster: "Mastercard débito",
  maestro: "Maestro",
  amex: "American Express",
  cabal: "Cabal",
  debcabal: "Cabal débito",
  naranja: "Naranja",
  argencard: "Argencard",
  tarshop: "Tarjeta Shopping",
  cencosud: "Cencosud",
};
const brandName = (id?: string): string | null =>
  id ? BRANDS[id] ?? id.charAt(0).toUpperCase() + id.slice(1) : null;
const cents = (pesos: number | undefined | null): number => Math.round((pesos ?? 0) * 100);

function failureReason(detail?: string): string {
  const d = detail ?? "";
  if (/insufficient/.test(d)) return "fondos_insuficientes";
  if (/bad_filled|invalid|security_code|expiration|date/.test(d)) return "tarjeta_invalida";
  if (/call_for_authorize/.test(d)) return "requiere_autorizacion";
  if (/disabled|blacklist|high_risk/.test(d)) return "tarjeta_bloqueada";
  if (/max_attempts/.test(d)) return "limite_de_intentos";
  return "rechazado";
}

function friendlyMpError(e: unknown): HttpError {
  if (e instanceof MercadoPagoError) {
    console.error("[mercadopago]", e.status, e.message, JSON.stringify(e.body));
    if (e.status === 401 || e.status === 403 || e.status >= 500)
      return new HttpError(502, "No pudimos comunicarnos con Mercado Pago. Probá de nuevo en unos minutos.");
    return new HttpError(402, "Mercado Pago no pudo validar la tarjeta. Revisá los datos o probá con otra.");
  }
  console.error("[mercadopago] error de red", e);
  return new HttpError(502, "No pudimos comunicarnos con Mercado Pago. Probá de nuevo en unos minutos.");
}

async function cancelAtProcessor(processorId: string): Promise<void> {
  try {
    await mp.cancelSubscription(processorId);
  } catch (e) {
    const current = await mp.getSubscription(processorId).catch(() => null);
    if (current?.status === "cancelled") return;
    throw e;
  }
}

export async function startSubscription(user: UserBasic, planId: string, card: CardInput): Promise<number> {
  const plan = PLANS[planId];
  if (!plan) throw new HttpError(400, "Elegí un plan.");

  const { data: created, error: insErr } = await supabaseAdmin
    .from("subscriptions")
    .insert({ user_id: user.id, plan_id: plan.id, status: "incomplete" })
    .select("id")
    .single();
  if (insErr || !created) throw new HttpError(500, "No se pudo crear la suscripción.");

  const subId = created.id;
  const ref = `rexplay-sub-${subId}`;
  await supabaseAdmin.from("subscriptions").update({ external_reference: ref }).eq("id", subId);

  try {
    const pre = await mp.createSubscription({
      reason: `${plan.name} - suscripción cada ${plan.period_days} días`,
      externalReference: ref,
      payerEmail: user.email,
      cardTokenId: card.token,
      amountCents: plan.price,
      frequencyDays: plan.period_days,
      backUrl: `${config.appUrl}/cuenta`,
    });
    if (pre.status !== "authorized") {
      throw new MercadoPagoError(402, `La suscripción quedó en estado "${pre.status}".`, pre);
    }
    await supabaseAdmin
      .from("subscriptions")
      .update({
        status: "pending",
        processor_subscription_id: pre.id,
        card_brand: brandName(pre.payment_method_id ?? card.payment_method_id),
      })
      .eq("id", subId);
    return subId;
  } catch (e) {
    await supabaseAdmin.from("subscriptions").delete().eq("id", subId);
    throw friendlyMpError(e);
  }
}

type Outcome = "approved" | "failed" | "pending";

function classify(ap: AuthorizedPayment): Outcome {
  const pay = ap.payment?.status;
  if (pay === "approved") return "approved";
  if (pay === "rejected" || pay === "cancelled" || ap.status === "recycling") return "failed";
  return "pending";
}

interface RpcResult {
  label: string;
  after: string[];
  end?: string;
  grace_ends_at?: string;
}

async function runApplyPayment(
  subId: number,
  ap: AuthorizedPayment,
  outcome: "approved" | "failed",
  detail: Payment | null,
  t: Date,
): Promise<RpcResult> {
  const apId = String(ap.id);
  const key = `${apId}:${ap.retry_attempt ?? 0}`;

  let fee = 0;
  let net = 0;
  let settleAt: string | null = null;
  let amount = 0;
  let failure: string | null = null;

  const { data: sub } = await supabaseAdmin
    .from("subscriptions")
    .select("plan_id")
    .eq("id", subId)
    .maybeSingle();
  const plan = PLANS[sub?.plan_id ?? "unico"];
  amount = ap.transaction_amount != null ? cents(ap.transaction_amount) : plan.price;

  if (outcome === "approved") {
    fee = detail ? (detail.fee_details ?? []).reduce((a, f) => a + cents(f.amount), 0) : 0;
    net =
      detail?.transaction_details?.net_received_amount != null
        ? cents(detail.transaction_details.net_received_amount)
        : amount - fee;
    settleAt = detail?.money_release_date ? fmt(new Date(detail.money_release_date)) : null;
  } else {
    failure = failureReason(ap.payment?.status_detail);
  }

  const { data, error } = await supabaseAdmin.rpc("apply_payment", {
    p_sub_id: subId,
    p_charge_key: key,
    p_authorized_payment_id: apId,
    p_processor_payment_id: ap.payment?.id != null ? String(ap.payment.id) : null,
    p_kind: "initial",
    p_amount: amount,
    p_fee: fee,
    p_net: net,
    p_status: outcome === "approved" ? "succeeded" : "failed",
    p_failure_reason: failure,
    p_settle_at: settleAt,
    p_outcome: outcome,
    p_created_at: fmt(t),
  });
  if (error) throw new HttpError(500, "No se pudo aplicar el pago: " + error.message);
  return data as RpcResult;
}

async function executeAfter(result: RpcResult, subId: number, ap: AuthorizedPayment): Promise<void> {
  const sub = await getSub(subId);
  if (!sub) return;
  const user = await getUser(sub.user_id);
  if (!user) return;

  const apId = String(ap.id);
  const amount = ap.transaction_amount != null ? cents(ap.transaction_amount) : PLANS[sub.plan_id].price;

  for (const action of result.after ?? []) {
    if (action === "send_approved_email") {
      const end = result.end ? new Date(result.end) : new Date();
      const kindInitial = amount === PLANS[sub.plan_id].price && !sub.first_payment_at;
      await sendOnce({
        userId: user.id,
        to: user.email,
        template: "payment_approved",
        dedupeKey: `paid:${apId}`,
        content: templates.paymentApproved({
          name: user.name,
          amountCents: amount,
          initial: kindInitial,
          nextBillingAt: end,
        }),
      });
    } else if (action === "send_grace_email") {
      const graceEnd = result.grace_ends_at ? new Date(result.grace_ends_at) : new Date();
      await sendOnce({
        userId: user.id,
        to: user.email,
        template: "payment_failed",
        dedupeKey: `failed:${subId}:${apId}`,
        content: templates.paymentFailed({
          name: user.name,
          amountCents: amount,
          graceEndsAt: graceEnd,
          graceDays: GRACE_DAYS,
        }),
      });
    } else if (action === "send_signup_failed_email") {
      await sendOnce({
        userId: user.id,
        to: user.email,
        template: "signup_payment_failed",
        dedupeKey: `signupfail:${subId}`,
        content: templates.signupPaymentFailed({ name: user.name }),
      });
    } else if (action === "cancel_at_processor" && sub.processor_subscription_id) {
      await cancelAtProcessor(sub.processor_subscription_id).catch((e) =>
        console.error("No se pudo cancelar en MP", sub.processor_subscription_id, e),
      );
    }
  }
}

async function findSubscription(preapprovalId?: string, externalRef?: string): Promise<SubscriptionRow | undefined> {
  let sub: SubscriptionRow | undefined;
  if (preapprovalId) {
    const { data } = await supabaseAdmin
      .from("subscriptions")
      .select("*")
      .eq("processor_subscription_id", preapprovalId)
      .maybeSingle();
    sub = (data as SubscriptionRow | null) ?? undefined;
  }
  if (!sub && externalRef) {
    const { data } = await supabaseAdmin
      .from("subscriptions")
      .select("*")
      .eq("external_reference", externalRef)
      .maybeSingle();
    sub = (data as SubscriptionRow | null) ?? undefined;
    if (sub && !sub.processor_subscription_id && preapprovalId) {
      await supabaseAdmin
        .from("subscriptions")
        .update({ processor_subscription_id: preapprovalId })
        .eq("id", sub.id);
    }
  }
  return sub;
}

export async function syncAuthorizedPayment(authorizedPaymentId: string): Promise<string> {
  const ap = await mp.getAuthorizedPayment(authorizedPaymentId);
  const outcome = classify(ap);

  let sub = await findSubscription(ap.preapproval_id, ap.external_reference);
  if (!sub) {
    // Alta nueva: todavía no existe la cuenta. Solo se crea si el pago quedó aprobado.
    const signup = await findSignup(ap.preapproval_id, ap.external_reference);
    if (!signup) return "ignored";
    if (outcome === "pending") return "pending";
    if (outcome === "failed") return failSignup(signup, failureReason(ap.payment?.status_detail));
    sub = await approveSignup(signup);
    if (!sub) return "signup_in_progress";
  }
  if (outcome === "pending") return "pending";

  let detail: Payment | null = null;
  if (outcome === "approved" && ap.payment?.id != null) {
    detail = await mp.getPayment(String(ap.payment.id)).catch((e) => {
      console.warn("No se pudo leer el detalle del pago:", e);
      return null;
    });
  }

  const result = await runApplyPayment(sub.id, ap, outcome, detail, now());
  await executeAfter(result, sub.id, ap);
  return result.label;
}

export async function syncPreapproval(preapprovalId: string): Promise<string> {
  const pre = await mp.getSubscription(preapprovalId);
  const sub = await findSubscription(preapprovalId, pre.external_reference);
  if (!sub) return "ignored";

  if (pre.status === "cancelled") {
    const t = fmt(now());
    if (sub.status === "pending" || sub.status === "incomplete") {
      await supabaseAdmin
        .from("subscriptions")
        .update({ status: "canceled", canceled_reason: "processor", canceled_at: t })
        .eq("id", sub.id);
      return "canceled";
    }
    if (sub.status === "active" && !sub.cancel_at_period_end) {
      await supabaseAdmin
        .from("subscriptions")
        .update({ cancel_at_period_end: true, next_billing_at: null, canceled_reason: "processor" })
        .eq("id", sub.id);
      return "cancel_at_period_end";
    }
  }
  return "noop";
}

const HANDLERS: Record<string, (id: string) => Promise<string>> = {
  subscription_authorized_payment: syncAuthorizedPayment,
  subscription_preapproval: syncPreapproval,
};

export async function handleWebhookEvent(ev: { type: string; dataId: string; eventId: string }): Promise<string> {
  const handler = HANDLERS[ev.type];
  const result = handler ? await handler(ev.dataId) : "ignored";
  await supabaseAdmin
    .from("webhook_events")
    .upsert({ event_id: ev.eventId, type: ev.type, received_at: fmt(now()) }, { onConflict: "event_id", ignoreDuplicates: true });
  return result;
}

export async function cancelByUser(userId: string): Promise<void> {
  const sub = await latestSubscription(userId);
  if (!sub || !["pending", "active", "past_due"].includes(sub.status)) {
    throw new HttpError(400, "No tenés una suscripción activa.");
  }
  if (sub.processor_subscription_id) {
    try {
      await cancelAtProcessor(sub.processor_subscription_id);
    } catch (e) {
      throw friendlyMpError(e);
    }
  }
  const t = fmt(now());
  if (sub.status === "active") {
    await supabaseAdmin
      .from("subscriptions")
      .update({ cancel_at_period_end: true, next_billing_at: null, canceled_reason: "user" })
      .eq("id", sub.id);
  } else {
    await supabaseAdmin
      .from("subscriptions")
      .update({ status: "canceled", canceled_reason: "user", canceled_at: t })
      .eq("id", sub.id);
  }
}

export async function changeCard(userId: string, card: CardInput): Promise<void> {
  const sub = await latestSubscription(userId);
  if (!sub || !sub.processor_subscription_id || !["pending", "active", "past_due"].includes(sub.status)) {
    throw new HttpError(400, "No tenés una suscripción activa.");
  }
  try {
    await mp.updateSubscriptionCard(sub.processor_subscription_id, card.token);
  } catch (e) {
    throw friendlyMpError(e);
  }
  await supabaseAdmin
    .from("subscriptions")
    .update({ card_brand: brandName(card.payment_method_id) ?? sub.card_brand, card_last4: null })
    .eq("id", sub.id);
}

export async function runMaintenance(): Promise<{ graceExpired: number; periodEnded: number }> {
  const t = now();
  let graceExpired = 0;
  let periodEnded = 0;

  await purgeStaleSignups().catch((e) => console.error("purgeStaleSignups", e));

  const { data: overdue } = await supabaseAdmin
    .from("subscriptions")
    .select("*")
    .eq("status", "past_due")
    .lte("grace_ends_at", fmt(t));

  for (const s of (overdue as SubscriptionRow[] | null) ?? []) {
    try {
      if (s.processor_subscription_id) await cancelAtProcessor(s.processor_subscription_id);
    } catch (e) {
      console.error("No se pudo cancelar en MP (reintento en la próxima pasada):", s.id, e);
      continue;
    }
    await supabaseAdmin
      .from("subscriptions")
      .update({ status: "canceled", canceled_reason: "nonpayment", canceled_at: fmt(t), next_billing_at: null })
      .eq("id", s.id)
      .eq("status", "past_due");
    const u = await getUser(s.user_id);
    if (u)
      await sendOnce({
        userId: u.id,
        to: u.email,
        template: "subscription_canceled",
        dedupeKey: `canceled:${s.id}`,
        content: templates.subscriptionCanceled({ name: u.name, reason: "nonpayment" }),
      });
    graceExpired++;
  }

  const { data: ended } = await supabaseAdmin
    .from("subscriptions")
    .select("*")
    .eq("status", "active")
    .eq("cancel_at_period_end", true)
    .lte("current_period_end", fmt(t));

  for (const s of (ended as SubscriptionRow[] | null) ?? []) {
    await supabaseAdmin
      .from("subscriptions")
      .update({ status: "canceled", canceled_at: fmt(t) })
      .eq("id", s.id)
      .eq("status", "active");
    const u = await getUser(s.user_id);
    if (u)
      await sendOnce({
        userId: u.id,
        to: u.email,
        template: "subscription_canceled",
        dedupeKey: `canceled:${s.id}`,
        content: templates.subscriptionCanceled({ name: u.name, reason: "user" }),
      });
    periodEnded++;
  }

  const { data: stale } = await supabaseAdmin
    .from("subscriptions")
    .select("*")
    .eq("status", "pending")
    .lte("created_at", fmt(addDays(t, -1 / 24)));

  for (const s of (stale as SubscriptionRow[] | null) ?? []) {
    if (s.processor_subscription_id)
      await syncPreapproval(s.processor_subscription_id).catch((e) =>
        console.error("No se pudo consultar la suscripción", s.id, e),
      );
  }

  return { graceExpired, periodEnded };
}

export async function subscriptionView(userId: string) {
  const s = await latestSubscription(userId);
  if (!s || s.status === "incomplete") return null;
  const plan = PLANS[s.plan_id];
  const access = hasAccess(s);
  return {
    plan_id: s.plan_id,
    plan_name: plan.name,
    price: plan.price,
    period_days: plan.period_days,
    grace_days: plan.grace_days,
    status: s.status,
    has_access: access,
    card_brand: s.card_brand,
    card_last4: s.card_last4,
    current_period_end: s.current_period_end,
    next_billing_at: s.status === "active" && !s.cancel_at_period_end ? s.next_billing_at : null,
    grace_ends_at: s.status === "past_due" ? s.grace_ends_at : null,
    cancel_at_period_end: Boolean(s.cancel_at_period_end),
    failed_attempts: s.failed_attempts,
    canceled_reason: s.canceled_reason,
  };
}

export async function userPayments(userId: string) {
  const { data } = await supabaseAdmin
    .from("payments")
    .select("kind, amount, status, failure_reason, created_at, subscriptions!inner(user_id)")
    .eq("subscriptions.user_id", userId)
    .order("id", { ascending: false });
  return (data ?? []).map((p: any) => ({
    kind: p.kind,
    amount: p.amount,
    status: p.status,
    failure_reason: p.failure_reason,
    created_at: p.created_at,
  }));
}

export async function merchantSummary() {
  const { data: pays } = await supabaseAdmin
    .from("payments")
    .select("id, created_at, amount, fee, net, status, failure_reason, settle_at, kind")
    .eq("status", "succeeded")
    .order("id", { ascending: false })
    .limit(100);

  const totals = (pays ?? []).reduce(
    (acc, p: any) => {
      acc.gross += p.amount;
      acc.fees += p.fee;
      if (!p.settle_at || new Date(p.settle_at) > new Date()) acc.pending += p.net;
      else acc.settled += p.net;
      return acc;
    },
    { gross: 0, fees: 0, pending: 0, settled: 0 },
  );

  const { data: subs } = await supabaseAdmin.from("subscriptions").select("status");
  const byStatus: Record<string, number> = {};
  for (const s of subs ?? []) byStatus[s.status] = (byStatus[s.status] ?? 0) + 1;

  return { totals, payments: pays ?? [], subscriptions: byStatus };
}

export async function customersList() {
  const { data } = await supabaseAdmin
    .from("profiles")
    .select("id, name, doc_type, doc_number, created_at")
    .order("created_at", { ascending: false })
    .limit(500);
  return data ?? [];
}

// ============================================================================
// Alta de cuenta al aprobarse el pago
//
// Flujo: el formulario manda nombre/email/contraseña/tarjeta a /api/checkout. NO se crea ninguna cuenta:
// se guarda un "alta pendiente" (la contraseña va cifrada) y se crea la suscripción en Mercado Pago.
// Cuando llega el webhook con el primer pago APROBADO, recién ahí se crea el usuario en Supabase.
// ============================================================================
const SIGNUP_REF_PREFIX = "rexplay-signup-";
const SIGNUP_CLAIM_TTL_MS = 2 * 60_000;
const SIGNUP_EXPIRES_HOURS = 24;

export interface PendingSignup {
  id: string;
  email: string;
  name: string;
  password_enc: string | null;
  plan_id: string;
  proof_id: number | null;
  doc_type: string | null;
  doc_number: string | null;
  payment_method_id: string | null;
  ip: string | null;
  user_agent: string | null;
  status: "pending" | "processing" | "approved" | "failed";
  failure_reason: string | null;
  processor_subscription_id: string | null;
  user_id: string | null;
  created_at: string;
}

function signupKey(): Buffer {
  const secret = config.signupKey || (config.isProd ? "" : "rexplay-dev-only-signup-key");
  if (!secret) throw new HttpError(500, "Falta PENDING_SIGNUP_KEY en el backend.");
  return crypto.createHash("sha256").update(secret).digest();
}

function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", signupKey(), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString("base64")).join(".");
}

function decryptSecret(blob: string): string {
  const [iv, tag, enc] = blob.split(".").map((p) => Buffer.from(p, "base64"));
  const d = crypto.createDecipheriv("aes-256-gcm", signupKey(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString("utf8");
}

export interface SignupCheckoutInput {
  name: string;
  email: string; // ya normalizado
  password: string;
  planId: string;
  proofId: number;
  card: CardInput & { identification?: { type: string; number: string } };
  ip: string | null;
  userAgent: string | null;
}

/** Crea el alta pendiente y la suscripción en Mercado Pago. Devuelve el id del alta (para consultar el estado). */
export async function startSignupCheckout(i: SignupCheckoutInput): Promise<string> {
  const plan = PLANS[i.planId];
  if (!plan) throw new HttpError(400, "Elegí un plan.");

  const { data: taken, error: takenErr } = await supabaseAdmin.rpc("email_taken", { p_email: i.email });
  if (takenErr) {
    console.error("email_taken", takenErr);
    throw new HttpError(500, "No pudimos validar el email. Probá de nuevo.");
  }
  if (taken === true) throw new HttpError(409, "Ya existe una cuenta con ese email. Iniciá sesión.");

  const since = new Date(Date.now() - 30 * 60_000).toISOString();
  const { data: open } = await supabaseAdmin
    .from("pending_signups")
    .select("id")
    .eq("email", i.email)
    .in("status", ["pending", "processing"])
    .gte("created_at", since)
    .limit(1);
  if (open?.length) throw new HttpError(409, "Ya estamos procesando un pago con ese email. Esperá unos minutos.");

  const { data: row, error } = await supabaseAdmin
    .from("pending_signups")
    .insert({
      email: i.email,
      name: i.name,
      password_enc: encryptSecret(i.password),
      plan_id: plan.id,
      proof_id: i.proofId,
      doc_type: i.card.identification?.type ?? null,
      doc_number: i.card.identification?.number ?? null,
      payment_method_id: i.card.payment_method_id ?? null,
      ip: i.ip,
      user_agent: i.userAgent,
    })
    .select("id")
    .single();
  if (error || !row) {
    console.error("pending_signups insert", error);
    throw new HttpError(500, "No se pudo iniciar el pago.");
  }

  try {
    const pre = await mp.createSubscription({
      reason: `${plan.name} - suscripción cada ${plan.period_days} días`,
      externalReference: SIGNUP_REF_PREFIX + row.id,
      payerEmail: i.email,
      cardTokenId: i.card.token,
      amountCents: plan.price,
      frequencyDays: plan.period_days,
      backUrl: `${config.appUrl}/cuenta`,
    });
    if (pre.status !== "authorized") {
      throw new MercadoPagoError(402, `La suscripción quedó en estado "${pre.status}".`, pre);
    }
    await supabaseAdmin
      .from("pending_signups")
      .update({ processor_subscription_id: pre.id, payment_method_id: pre.payment_method_id ?? i.card.payment_method_id ?? null })
      .eq("id", row.id);
  } catch (e) {
    await supabaseAdmin.from("pending_signups").delete().eq("id", row.id);
    throw friendlyMpError(e);
  }
  return row.id as string;
}

async function findSignup(preapprovalId?: string, externalRef?: string): Promise<PendingSignup | undefined> {
  let ref = externalRef;
  if (!ref?.startsWith(SIGNUP_REF_PREFIX) && preapprovalId) {
    const { data } = await supabaseAdmin
      .from("pending_signups")
      .select("*")
      .eq("processor_subscription_id", preapprovalId)
      .maybeSingle();
    if (data) return data as PendingSignup;
    // El webhook pudo llegar antes de que guardáramos el id de la suscripción: se lo preguntamos a MP.
    const pre = await mp.getSubscription(preapprovalId).catch(() => null);
    ref = pre?.external_reference;
  }
  if (!ref?.startsWith(SIGNUP_REF_PREFIX)) return undefined;
  const { data } = await supabaseAdmin
    .from("pending_signups")
    .select("*")
    .eq("id", ref.slice(SIGNUP_REF_PREFIX.length))
    .maybeSingle();
  return (data as PendingSignup | null) ?? undefined;
}

/** Marca el alta como fallida, borra la contraseña guardada y corta la suscripción en MP para que no siga cobrando. */
async function failSignup(s: PendingSignup, reason: string): Promise<string> {
  if (s.status === "approved") return "ignored";
  await supabaseAdmin
    .from("pending_signups")
    .update({ status: "failed", failure_reason: reason, password_enc: null, completed_at: fmt(now()) })
    .eq("id", s.id);
  if (s.processor_subscription_id) {
    await cancelAtProcessor(s.processor_subscription_id).catch((e) =>
      console.error("No se pudo cancelar en MP", s.processor_subscription_id, e),
    );
  }
  return "signup_failed";
}

/**
 * Pago aprobado: crea el usuario y su suscripción. Es idempotente y seguro ante webhooks simultáneos
 * (un solo proceso "reclama" el alta). Devuelve la suscripción, o undefined si otro proceso la está creando.
 */
async function approveSignup(s: PendingSignup): Promise<SubscriptionRow | undefined> {
  const ref = SIGNUP_REF_PREFIX + s.id;

  if (s.status === "approved") {
    const { data } = await supabaseAdmin.from("subscriptions").select("*").eq("external_reference", ref).maybeSingle();
    return (data as SubscriptionRow | null) ?? undefined;
  }
  if (s.status === "failed") return undefined;

  // Reclamo atómico: solo uno pasa de "pending" a "processing" (o retoma uno trabado hace más de 2 minutos)
  const stale = new Date(Date.now() - SIGNUP_CLAIM_TTL_MS).toISOString();
  const { data: claimed } = await supabaseAdmin
    .from("pending_signups")
    .update({ status: "processing", claimed_at: fmt(now()) })
    .eq("id", s.id)
    .or(`status.eq.pending,and(status.eq.processing,claimed_at.lt.${stale})`)
    .select("*")
    .maybeSingle();
  if (!claimed) return undefined;
  const c = claimed as PendingSignup;

  try {
    let userId = c.user_id;
    if (!userId) {
      if (!c.password_enc) throw new Error("alta sin contraseña guardada");
      const { data, error } = await supabaseAdmin.auth.admin.createUser({
        email: c.email,
        password: decryptSecret(c.password_enc),
        email_confirm: true, // el email ya se verificó con el código de 6 dígitos
        user_metadata: { name: c.name },
      });
      if (error || !data.user) throw error ?? new Error("createUser sin usuario");
      userId = data.user.id;
      await supabaseAdmin.from("pending_signups").update({ user_id: userId }).eq("id", c.id);
    }

    const plan = PLANS[c.plan_id] ?? PLANS.unico;
    let { data: sub } = await supabaseAdmin.from("subscriptions").select("*").eq("external_reference", ref).maybeSingle();
    if (!sub) {
      const ins = await supabaseAdmin
        .from("subscriptions")
        .insert({
          user_id: userId,
          plan_id: plan.id,
          status: "pending",
          processor_subscription_id: c.processor_subscription_id,
          external_reference: ref,
          card_brand: brandName(c.payment_method_id ?? undefined),
        })
        .select("*")
        .single();
      if (ins.error || !ins.data) throw ins.error ?? new Error("no se pudo crear la suscripción");
      sub = ins.data;

      // Registro del consentimiento (igual que en la re-suscripción)
      const nowIso = new Date().toISOString();
      await supabaseAdmin.from("signup_responses").insert({
        user_id: userId,
        submitted_at: c.created_at,
        plan_id: plan.id,
        price_cents: plan.price,
        period_days: plan.period_days,
        accepted_terms_at: c.created_at,
        ip: c.ip,
        user_agent: c.user_agent,
        answers_json: {
          name: c.name,
          email: c.email,
          doc_type: c.doc_type,
          doc_number: c.doc_number,
          plan_id: plan.id,
          payment_method_id: c.payment_method_id,
          kind: "signup",
          accepted_terms: true,
          approved_at: nowIso,
        },
      });
    }

    await supabaseAdmin
      .from("pending_signups")
      .update({ status: "approved", password_enc: null, completed_at: fmt(now()) })
      .eq("id", c.id);
    if (c.proof_id) await emailVerification.consumeProof(c.proof_id).catch(() => undefined);
    return sub as SubscriptionRow;
  } catch (e) {
    // Si falló la creación de la cuenta con el pago ya aprobado, hay que revisarlo a mano (y/o devolver el dinero).
    console.error(`[ALTA] Pago aprobado pero no se pudo crear la cuenta (alta ${c.id}, ${c.email}):`, e);
    await failSignup({ ...c, status: "processing" }, "no_se_pudo_crear_cuenta");
    return undefined;
  }
}

const SIGNUP_FAILURE_MESSAGES: Record<string, string> = {
  fondos_insuficientes: "La tarjeta no tiene fondos suficientes.",
  tarjeta_invalida: "Los datos de la tarjeta no son válidos.",
  requiere_autorizacion: "Tu banco necesita autorizar el pago. Comunicate con ellos o probá con otra tarjeta.",
  tarjeta_bloqueada: "La tarjeta está bloqueada o no admite este pago.",
  limite_de_intentos: "Se superó el límite de intentos con esta tarjeta.",
  no_se_pudo_crear_cuenta: "Recibimos el pago pero no pudimos crear la cuenta. Escribinos y lo resolvemos.",
  expirado: "No recibimos la confirmación del pago a tiempo. Probá de nuevo.",
};

/** Estado del alta, para que el formulario espere la aprobación del pago. */
export async function signupStatus(id: string): Promise<{ status: "pending" | "approved" | "failed"; message?: string }> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(404, "Alta no encontrada.");
  const { data } = await supabaseAdmin.from("pending_signups").select("status, failure_reason").eq("id", id).maybeSingle();
  if (!data) throw new HttpError(404, "Alta no encontrada.");
  if (data.status === "approved") return { status: "approved" };
  if (data.status === "failed") {
    return { status: "failed", message: SIGNUP_FAILURE_MESSAGES[data.failure_reason ?? ""] ?? "El pago fue rechazado. Probá con otra tarjeta." };
  }
  return { status: "pending" };
}

/** Altas que nunca recibieron la aprobación: se cortan y se borra la contraseña guardada. */
export async function purgeStaleSignups(): Promise<void> {
  const cutoff = new Date(Date.now() - SIGNUP_EXPIRES_HOURS * 3_600_000).toISOString();
  const { data } = await supabaseAdmin
    .from("pending_signups")
    .select("*")
    .in("status", ["pending", "processing"])
    .lt("created_at", cutoff);
  for (const s of (data as PendingSignup[] | null) ?? []) await failSignup(s, "expirado");
}
