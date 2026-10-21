import { config } from "./config.js";
import { supabaseAdmin } from "./supabase.js";
import { HttpError } from "./errors.js";
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
  const sub = await findSubscription(ap.preapproval_id, ap.external_reference);
  if (!sub) return "ignored";
  const outcome = classify(ap);
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