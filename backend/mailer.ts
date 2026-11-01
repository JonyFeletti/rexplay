import nodemailer from "nodemailer";
import { config } from "./config.js";
import { supabaseAdmin } from "./supabase.js";

export interface MailContent {
  subject: string;
  text: string;
  html: string;
}

const transport = config.mail.smtpUrl
  ? nodemailer.createTransport(config.mail.smtpUrl)
  : nodemailer.createTransport({ jsonTransport: true });

export const devOutbox: { to: string; subject: string; text: string }[] = [];

const money = (cents: number): string =>
  new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(cents / 100);
const longDate = (d: Date): string =>
  new Intl.DateTimeFormat("es-AR", { dateStyle: "full", timeZone: "America/Argentina/Buenos_Aires" }).format(d);
const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));

function layout(
  title: string,
  paragraphs: string[],
  cta?: { label: string; url: string },
  highlight?: string,
): { text: string; html: string } {
  const text = [title, "", ...paragraphs, ...(highlight ? ["", highlight] : []), ...(cta ? ["", `${cta.label}: ${cta.url}`] : []), "", "— El equipo de RexPlay"].join("\n");
  const html = `<!doctype html><html lang="es"><body style="margin:0;background:#0f1117;font-family:Arial,sans-serif;color:#e8eaf0">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#171a23;border:1px solid #252936;border-radius:14px">
<tr><td style="padding:28px">
<h1 style="margin:0 0 4px;font-size:22px;color:#ffba45">RexPlay</h1>
<h2 style="margin:0 0 18px;font-size:18px;color:#fff">${esc(title)}</h2>
${paragraphs.map((p) => `<p style="margin:0 0 14px;line-height:1.5;color:#c9cdd8">${esc(p)}</p>`).join("")}
${highlight ? `<p style="margin:18px 0;text-align:center"><span style="display:inline-block;letter-spacing:8px;font-size:32px;font-weight:700;color:#ffba45;background:#0f1117;border:1px solid #252936;border-radius:10px;padding:12px 12px 12px 20px">${esc(highlight)}</span></p>` : ""}
${cta ? `<p style="margin:22px 0"><a href="${esc(cta.url)}" style="background:#ffba45;color:#281800;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:999px;display:inline-block">${esc(cta.label)}</a></p>` : ""}
<p style="margin:22px 0 0;color:#8b91a3;font-size:13px">— El equipo de RexPlay</p>
</td></tr></table></td></tr></table></body></html>`;
  return { text, html };
}

export const templates = {
  verificationCode(p: { code: string; ttlMinutes: number }): MailContent {
    const title = "Tu código de verificación";
    const body = layout(
      title,
      [
        "Usá este código para verificar tu email y terminar de crear tu cuenta de RexPlay.",
        `Vence en ${p.ttlMinutes} minutos. Si no lo pediste vos, ignorá este mail.`,
      ],
      undefined,
      p.code,
    );
    return { subject: "Tu código de RexPlay", ...body };
  },
  paymentApproved(p: { name: string; amountCents: number; initial: boolean; nextBillingAt: Date }): MailContent {
    const title = p.initial ? "¡Bienvenido a RexPlay! Tu suscripción está activa" : "Cobramos tu suscripción de RexPlay";
    const body = layout(title, [
      `Hola ${p.name}, recibimos tu pago de ${money(p.amountCents)}.`,
      `Tu próximo cobro automático es el ${longDate(p.nextBillingAt)}. Podés cancelar cuando quieras desde tu cuenta.`,
    ], { label: p.initial ? "Empezar a ver" : "Ver mi cuenta", url: `${config.appUrl}${p.initial ? "/" : "/cuenta"}` });
    return { subject: title, ...body };
  },
  paymentFailed(p: { name: string; amountCents: number; graceEndsAt: Date; graceDays: number }): MailContent {
    const title = "No pudimos cobrar tu suscripción";
    const body = layout(title, [
      `Hola ${p.name}, intentamos cobrarte ${money(p.amountCents)} y la tarjeta fue rechazada.`,
      `Mantenés el acceso durante ${p.graceDays} días, hasta el ${longDate(p.graceEndsAt)}.`,
      "Para evitar el corte, revisá tu tarjeta o cargá una nueva.",
    ], { label: "Actualizar mi tarjeta", url: `${config.appUrl}/cuenta` });
    return { subject: title, ...body };
  },
  signupPaymentFailed(p: { name: string }): MailContent {
    const body = layout("No pudimos procesar tu primer pago", [
      `Hola ${p.name}, el banco rechazó el primer pago y tu suscripción no se activó. No se te cobró nada.`,
      "Podés volver a intentarlo con otra tarjeta.",
    ], { label: "Probar de nuevo", url: `${config.appUrl}/cuenta` });
    return { subject: "No pudimos procesar tu primer pago en RexPlay", ...body };
  },
  subscriptionCanceled(p: { name: string; reason: "nonpayment" | "user" }): MailContent {
    const lines = p.reason === "nonpayment"
      ? [`Hola ${p.name}, no pudimos cobrar tu suscripción dentro del período de gracia, la cancelamos.`, "Podés reactivarla cuando quieras."]
      : [`Hola ${p.name}, terminó el período que tenías pago y tu suscripción quedó cancelada.`, "Podés reactivarla cuando quieras."];
    const body = layout("Tu suscripción de RexPlay fue cancelada", lines, { label: "Reactivar", url: `${config.appUrl}/cuenta` });
    return { subject: "Tu suscripción de RexPlay fue cancelada", ...body };
  },
};

/** Envío directo, sin registro en email_log (para mails con códigos que no deben quedar guardados). */
export async function sendPlain(a: { to: string; content: MailContent }): Promise<boolean> {
  try {
    await transport.sendMail({
      from: config.mail.from,
      to: a.to,
      subject: a.content.subject,
      text: a.content.text,
      html: a.content.html,
    });
    if (!config.mail.smtpUrl && process.env.NODE_ENV !== "test") {
      console.log(`[mail simulado → ${a.to}] ${a.content.subject}`);
    }
    return true;
  } catch (e) {
    console.error("No se pudo enviar el mail", a.content.subject, e);
    return false;
  }
}

export async function sendOnce(a: {
  userId: string | null;
  to: string;
  template: string;
  dedupeKey: string;
  content: MailContent;
}): Promise<boolean> {
  const { data: claim, error: claimErr } = await supabaseAdmin
    .from("email_log")
    .insert({
      user_id: a.userId,
      to_email: a.to,
      template: a.template,
      dedupe_key: a.dedupeKey,
      subject: a.content.subject,
      status: "pending",
    })
    .select("id")
    .single();

  if (claimErr?.code === "23505") return false;
  if (claimErr) {
    console.error("No se pudo registrar el mail", claimErr);
    return false;
  }

  try {
    await transport.sendMail({
      from: config.mail.from,
      to: a.to,
      subject: a.content.subject,
      text: a.content.text,
      html: a.content.html,
    });

    await supabaseAdmin
      .from("email_log")
      .update({ status: config.mail.smtpUrl ? "sent" : "logged" })
      .eq("id", claim.id);

    if (!config.mail.smtpUrl) {
      devOutbox.push({ to: a.to, subject: a.content.subject, text: a.content.text });
      if (devOutbox.length > 200) devOutbox.shift();
      if (process.env.NODE_ENV !== "test") console.log(`[mail simulado → ${a.to}] ${a.content.subject}`);
    }
    return true;
  } catch (e) {
    await supabaseAdmin
      .from("email_log")
      .update({ status: "failed", error: String((e as Error)?.message ?? e).slice(0, 500) })
      .eq("id", claim.id);
    console.error("No se pudo enviar el mail", a.template, e);
    return false;
  }
}