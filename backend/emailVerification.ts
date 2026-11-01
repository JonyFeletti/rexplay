import crypto from "node:crypto";
import { config } from "./config.js";
import { HttpError } from "./errors.js";
import { sendPlain, templates } from "./mailer.js";
import { supabaseAdmin } from "./supabase.js";

export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export const CODE_TTL_MS = 10 * 60_000; // el código vence a los 10 minutos
const PROOF_TTL_MS = 30 * 60_000; // después de verificar, hay 30 minutos para crear la cuenta
const MAX_ATTEMPTS = 5; // intentos por código
const RESEND_COOLDOWN_MS = 45_000; // espera mínima entre códigos para el mismo mail
const MAX_SENDS_PER_HOUR = 5; // códigos por mail por hora

export const normalizeEmail = (e: string): string => e.trim().toLowerCase();

const sha256 = (s: string): string => crypto.createHash("sha256").update(s).digest("hex");
const safeEqual = (a: string, b: string): boolean => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

function assertEmail(email: string): void {
  if (email.length > 254 || !EMAIL_RE.test(email)) throw new HttpError(400, "El email no es válido.");
}

/** Genera un código de 6 dígitos, lo guarda hasheado y lo manda por mail. */
export async function sendCode(rawEmail: string): Promise<{ resendInSeconds: number }> {
  const email = normalizeEmail(rawEmail);
  assertEmail(email);

  const now = Date.now();
  const { data: recent, error: recentErr } = await supabaseAdmin
    .from("email_verifications")
    .select("created_at")
    .eq("email", email)
    .gte("created_at", new Date(now - 60 * 60_000).toISOString())
    .order("created_at", { ascending: false });
  if (recentErr) {
    console.error("No se pudo consultar email_verifications", recentErr);
    throw new HttpError(500, "Algo salió mal. Probá de nuevo.");
  }

  if (recent.length >= MAX_SENDS_PER_HOUR) {
    throw new HttpError(429, "Pediste demasiados códigos. Probá de nuevo en un rato.");
  }
  if (recent[0]) {
    const waitMs = new Date(recent[0].created_at).getTime() + RESEND_COOLDOWN_MS - now;
    if (waitMs > 0) {
      throw new HttpError(429, `Esperá ${Math.ceil(waitMs / 1000)} segundos para pedir otro código.`);
    }
  }

  const code = crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
  const salt = crypto.randomBytes(16).toString("hex");

  const { error: insertErr } = await supabaseAdmin.from("email_verifications").insert({
    email,
    code_salt: salt,
    code_hash: sha256(salt + code),
    expires_at: new Date(now + CODE_TTL_MS).toISOString(),
  });
  if (insertErr) {
    console.error("No se pudo guardar el código de verificación", insertErr);
    throw new HttpError(500, "Algo salió mal. Probá de nuevo.");
  }

  if (!config.mail.smtpUrl && !config.isProd) {
    // Sin SMTP configurado (desarrollo) el mail no sale: mostramos el código en la consola del backend.
    console.log(`[verificación] código para ${email}: ${code}`);
  }

  const sent = await sendPlain({
    to: email,
    content: templates.verificationCode({ code, ttlMinutes: CODE_TTL_MS / 60_000 }),
  });
  if (!sent) throw new HttpError(502, "No pudimos enviar el mail. Probá de nuevo en un momento.");

  return { resendInSeconds: RESEND_COOLDOWN_MS / 1000 };
}

/** Valida el código. Si es correcto devuelve un token de un solo uso para crear la cuenta. */
export async function verifyCode(rawEmail: string, rawCode: string): Promise<string> {
  const email = normalizeEmail(rawEmail);
  assertEmail(email);
  const code = rawCode.trim();
  if (!/^\d{6}$/.test(code)) throw new HttpError(400, "El código tiene 6 dígitos.");

  const { data: row, error } = await supabaseAdmin
    .from("email_verifications")
    .select("id, code_salt, code_hash, attempts, expires_at, verified_at")
    .eq("email", email)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error("No se pudo leer email_verifications", error);
    throw new HttpError(500, "Algo salió mal. Probá de nuevo.");
  }

  if (!row) throw new HttpError(400, "Primero pedí un código.");
  if (row.verified_at) throw new HttpError(400, "Ese código ya se usó. Pedí uno nuevo.");
  if (new Date(row.expires_at).getTime() < Date.now()) throw new HttpError(400, "El código venció. Pedí uno nuevo.");
  if (row.attempts >= MAX_ATTEMPTS) throw new HttpError(429, "Superaste los intentos. Pedí un código nuevo.");

  // Se cuenta el intento ANTES de comparar; el filtro por attempts evita que pedidos en paralelo se salteen el límite.
  const { data: bumped } = await supabaseAdmin
    .from("email_verifications")
    .update({ attempts: row.attempts + 1 })
    .eq("id", row.id)
    .eq("attempts", row.attempts)
    .select("id");
  if (!bumped?.length) throw new HttpError(409, "Probá de nuevo.");

  if (!safeEqual(sha256(row.code_salt + code), row.code_hash)) {
    const left = MAX_ATTEMPTS - (row.attempts + 1);
    throw new HttpError(
      400,
      left > 0 ? `Código incorrecto. Te quedan ${left} intento${left === 1 ? "" : "s"}.` : "Código incorrecto. Pedí un código nuevo.",
    );
  }

  const proof = crypto.randomBytes(32).toString("base64url");
  const { error: updErr } = await supabaseAdmin
    .from("email_verifications")
    .update({
      verified_at: new Date().toISOString(),
      proof_hash: sha256(proof),
      proof_expires_at: new Date(Date.now() + PROOF_TTL_MS).toISOString(),
    })
    .eq("id", row.id);
  if (updErr) {
    console.error("No se pudo marcar el mail como verificado", updErr);
    throw new HttpError(500, "Algo salió mal. Probá de nuevo.");
  }
  return proof;
}

/** Comprueba que el token corresponda a un mail verificado (sin gastarlo todavía). Devuelve el id de la verificación. */
export async function checkProof(rawEmail: string, proof: string): Promise<number> {
  const email = normalizeEmail(rawEmail);
  const bad = new HttpError(400, "Tenés que verificar tu email antes de crear la cuenta.");
  if (!proof || proof.length > 200) throw bad;

  const { data: row } = await supabaseAdmin
    .from("email_verifications")
    .select("id, proof_expires_at")
    .eq("email", email)
    .eq("proof_hash", sha256(proof))
    .not("verified_at", "is", null)
    .is("consumed_at", null)
    .maybeSingle();
  if (!row || !row.proof_expires_at || new Date(row.proof_expires_at).getTime() < Date.now()) throw bad;
  return row.id as number;
}

/** Gasta el token una vez que la cuenta se creó. */
export async function consumeProof(id: number): Promise<void> {
  await supabaseAdmin
    .from("email_verifications")
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", id)
    .is("consumed_at", null);
}
