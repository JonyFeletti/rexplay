/**
 * Cliente mínimo de Mercado Pago para suscripciones (API /preapproval).
 *
 * Documentación: https://www.mercadopago.com.ar/developers/es/docs/subscriptions/overview
 *  - Crear suscripción sin plan, con pago autorizado: POST /preapproval (status "authorized" + card_token_id)
 *  - Cambiar tarjeta / cancelar:                       PUT  /preapproval/{id}
 *  - Notificaciones (webhooks): topics "subscription_preapproval" y "subscription_authorized_payment"
 */
import crypto from "node:crypto";
import { config } from "./config";

export class MercadoPagoError extends Error {
  constructor(
    public status: number,
    message: string,
    public body: unknown,
  ) {
    super(message);
  }
}

// ---------- Tipos (solo los campos que usamos; Mercado Pago devuelve más) ----------
export interface Preapproval {
  id: string;
  status: string; // authorized | pending | paused | cancelled
  external_reference?: string;
  payment_method_id?: string;
  card_id?: number | string;
  next_payment_date?: string;
  auto_recurring?: { frequency?: number; frequency_type?: string; transaction_amount?: number };
}

/** Una "cuota" de la suscripción: Mercado Pago la crea según la periodicidad y la va reintentando. */
export interface AuthorizedPayment {
  id: number | string;
  preapproval_id: string;
  status?: string; // scheduled | processed | recycling | cancelled
  retry_attempt?: number;
  transaction_amount?: number;
  debit_date?: string;
  external_reference?: string;
  payment?: { id?: number | string; status?: string; status_detail?: string };
}

export interface Payment {
  id: number | string;
  status?: string;
  status_detail?: string;
  transaction_amount?: number;
  money_release_date?: string | null;
  payment_method_id?: string;
  fee_details?: { amount?: number }[];
  transaction_details?: { net_received_amount?: number };
  card?: { last_four_digits?: string };
}

export interface CreateSubscriptionInput {
  reason: string;
  externalReference: string;
  payerEmail: string;
  cardTokenId: string;
  /** Importe en centavos. */
  amountCents: number;
  frequencyDays: number;
  backUrl: string;
}

// ---------- Cliente ----------
export class MercadoPagoClient {
  constructor(
    private accessToken: string = config.mp.accessToken,
    private baseUrl: string = config.mp.apiBase,
  ) {}

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    if (!this.accessToken) throw new MercadoPagoError(500, "Falta MP_ACCESS_TOKEN.", null);
    const res = await fetch(this.baseUrl + path, {
      method,
      headers: { Authorization: `Bearer ${this.accessToken}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    if (!res.ok) {
      const msg = (data as { message?: string } | null)?.message ?? `Mercado Pago respondió ${res.status}`;
      throw new MercadoPagoError(res.status, msg, data);
    }
    return data as T;
  }

  /**
   * Crea la suscripción con la tarjeta tokenizada. Mercado Pago valida la tarjeta con un cobro mínimo
   * (que devuelve) y después genera la primera cuota; las siguientes se cobran solas cada `frequencyDays` días.
   */
  createSubscription(i: CreateSubscriptionInput): Promise<Preapproval> {
    return this.request<Preapproval>("POST", "/preapproval", {
      reason: i.reason,
      external_reference: i.externalReference,
      payer_email: i.payerEmail,
      card_token_id: i.cardTokenId,
      back_url: i.backUrl,
      status: "authorized",
      auto_recurring: {
        frequency: i.frequencyDays,
        frequency_type: "days",
        transaction_amount: Math.round(i.amountCents) / 100,
        currency_id: "ARS",
      },
    });
  }

  getSubscription(id: string): Promise<Preapproval> {
    return this.request<Preapproval>("GET", `/preapproval/${encodeURIComponent(id)}`);
  }

  /** Reemplaza la tarjeta de una suscripción existente (token nuevo generado en el navegador). */
  updateSubscriptionCard(id: string, cardTokenId: string): Promise<Preapproval> {
    return this.request<Preapproval>("PUT", `/preapproval/${encodeURIComponent(id)}`, { card_token_id: cardTokenId });
  }

  /** Cancela: Mercado Pago deja de generar cuotas. */
  cancelSubscription(id: string): Promise<Preapproval> {
    return this.request<Preapproval>("PUT", `/preapproval/${encodeURIComponent(id)}`, { status: "cancelled" });
  }

  getAuthorizedPayment(id: string): Promise<AuthorizedPayment> {
    return this.request<AuthorizedPayment>("GET", `/authorized_payments/${encodeURIComponent(id)}`);
  }

  getPayment(id: string): Promise<Payment> {
    return this.request<Payment>("GET", `/v1/payments/${encodeURIComponent(id)}`);
  }
}

// ---------- Firma de webhooks ----------
/**
 * Valida el header x-signature ("ts=...,v1=...") según la documentación de Mercado Pago:
 * HMAC-SHA256 (clave secreta de tu integración) sobre `id:<data.id>;request-id:<x-request-id>;ts:<ts>;`.
 * Si falta alguno de los datos, se omite de la plantilla.
 */
export function verifyWebhookSignature(o: {
  secret: string;
  xSignature: string | undefined;
  xRequestId: string | undefined;
  dataId: string | undefined;
}): boolean {
  if (!o.secret || !o.xSignature) return false;
  let ts = "";
  let v1 = "";
  for (const part of o.xSignature.split(",")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === "ts") ts = rest.join("=");
    if (k === "v1") v1 = rest.join("=");
  }
  if (!ts || !v1) return false;

  let manifest = "";
  if (o.dataId) manifest += `id:${/^[a-z0-9]+$/i.test(o.dataId) ? o.dataId.toLowerCase() : o.dataId};`;
  if (o.xRequestId) manifest += `request-id:${o.xRequestId};`;
  manifest += `ts:${ts};`;

  const expected = Buffer.from(crypto.createHmac("sha256", o.secret).update(manifest).digest("hex"));
  const received = Buffer.from(v1);
  return expected.length === received.length && crypto.timingSafeEqual(expected, received);
}

/** Usado por las pruebas para generar una firma válida. */
export function signWebhookForTests(secret: string, dataId: string, xRequestId: string, ts: string): string {
  const manifest = `id:${dataId.toLowerCase()};request-id:${xRequestId};ts:${ts};`;
  return `ts=${ts},v1=${crypto.createHmac("sha256", secret).update(manifest).digest("hex")}`;
}
