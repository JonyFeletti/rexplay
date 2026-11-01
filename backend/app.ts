import crypto from "node:crypto";
import express, { NextFunction, Request, RequestHandler, Response } from "express";
import * as billing from "./billing.js";
import * as emailVerification from "./emailVerification.js";
import { config } from "./config.js";
import { HttpError } from "./errors.js";
import { verifyWebhookSignature } from "./mercadopago.js";
import * as profiles from "./profiles.js";
import * as progress from "./progress.js";
import { requireAuth, type AuthedRequest } from "./middleware/requireAuth.js";
import { supabaseAdmin } from "./supabase.js";
import type { CardInput } from "./types.js";

const TERMS_VERSION = "2026-10";

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const body = (req: Request): Record<string, unknown> => (req.body ?? {}) as Record<string, unknown>;
const ah =
  (fn: (req: Request, res: Response) => Promise<unknown> | unknown): RequestHandler =>
  (req, res, next) =>
    Promise.resolve(fn(req, res)).catch(next);

const buckets = new Map<string, { n: number; reset: number }>();
function rateLimit(name: string, max: number, windowMs: number): RequestHandler {
  return (req, _res, next) => {
    if (process.env.NODE_ENV === "test") return next();
    const k = `${name}:${req.ip}`;
    const t = Date.now();
    const b = buckets.get(k);
    if (!b || b.reset < t) buckets.set(k, { n: 1, reset: t + windowMs });
    else if (++b.n > max) return next(new HttpError(429, "Demasiados intentos. Esperá un minuto."));
    if (buckets.size > 5000) for (const [key, v] of buckets) if (v.reset < t) buckets.delete(key);
    next();
  };
}

const intIn = (v: unknown, min: number, max: number, what: string): number => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw new HttpError(400, `Valor inválido: ${what}.`);
  return Math.floor(n);
};
const pathOrNull = (v: unknown): string | null =>
  typeof v === "string" && /^\/[A-Za-z0-9._-]{1,100}$/.test(v) ? v : null;
const mediaType = (v: unknown): "movie" | "tv" => {
  if (v !== "movie" && v !== "tv") throw new HttpError(400, "Tipo de contenido inválido.");
  return v;
};

interface ParsedCard extends CardInput {
  identification?: { type: string; number: string };
}

function parseCard(v: unknown): ParsedCard {
  const c = (v ?? {}) as Record<string, unknown>;
  const token = str(c.token);
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(token)) {
    throw new HttpError(400, "No pudimos validar la tarjeta. Volvé a cargarla.");
  }
  const idn = (c.identification ?? {}) as Record<string, unknown>;
  const idType = str(idn.type).replace(/[^A-Za-z]/g, "").slice(0, 10);
  const idNumber = str(idn.number).replace(/\D/g, "").slice(0, 15);
  return {
    token,
    payment_method_id: str(c.payment_method_id).replace(/[^a-z0-9_]/gi, "").slice(0, 40) || undefined,
    identification: idType && idNumber ? { type: idType.toUpperCase(), number: idNumber } : undefined,
  };
}

async function requireProfileId(req: AuthedRequest): Promise<number> {
  const header = String(req.headers["x-profile-id"] ?? "");
  const id = Number(header);
  if (!Number.isInteger(id) || id <= 0) {
    throw new HttpError(409, "Elegí un perfil para continuar.");
  }
  const { data } = await supabaseAdmin
    .from("sub_profiles")
    .select("id")
    .eq("id", id)
    .eq("user_id", req.userId!)
    .maybeSingle();
  if (!data) throw new HttpError(403, "Ese perfil no te pertenece.");
  return id;
}

function parseProgress(b: Record<string, unknown>): progress.ProgressInput {
  const type = mediaType(b.media_type);
  const title = str(b.title).trim().slice(0, 200);
  if (!title) throw new HttpError(400, "Falta el título.");
  const duration = intIn(b.duration_seconds ?? 0, 0, 86_400, "duración");
  let position = intIn(b.position_seconds, 0, 86_400, "posición");
  if (duration > 0 && position > duration) position = duration;
  return {
    media_type: type,
    tmdb_id: intIn(b.tmdb_id, 1, 99_999_999, "id"),
    season: type === "tv" ? intIn(b.season, 0, 9_999, "temporada") : 0,
    episode: type === "tv" ? intIn(b.episode, 1, 9_999, "episodio") : 0,
    title,
    episode_title: str(b.episode_title).trim().slice(0, 200) || null,
    poster_path: pathOrNull(b.poster_path),
    backdrop_path: pathOrNull(b.backdrop_path),
    position_seconds: position,
    duration_seconds: duration,
    source: b.source === "player" ? "player" : "estimated",
  };
}

export function registerSubscriptionRoutes(app: express.Express): void {
  // ---------- Webhook MP (antes de express.json) ----------
  app.post(
    "/webhooks/mercadopago",
    express.raw({ type: () => true }),
    ah(async (req, res) => {
      const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      let payload: { type?: string; data?: { id?: string | number } } = {};
      try {
        payload = JSON.parse(raw.toString("utf8") || "{}");
      } catch {}
      const dataId = String(req.query["data.id"] ?? payload.data?.id ?? "");
      const type = String(payload.type ?? req.query.type ?? req.query.topic ?? "");

      if (config.mp.webhookSecret) {
        const ok = verifyWebhookSignature({
          secret: config.mp.webhookSecret,
          xSignature: str(req.headers["x-signature"]),
          xRequestId: str(req.headers["x-request-id"]),
          dataId,
        });
        if (!ok) throw new HttpError(401, "Firma inválida.");
      } else if (config.isProd) {
        throw new HttpError(500, "Webhook sin clave secreta configurada.");
      }

      if (!dataId || !type) return res.json({ received: true, result: "ignored" });
      const result = await billing.handleWebhookEvent({
        type,
        dataId,
        eventId: str(req.headers["x-request-id"]) || `${type}:${dataId}:${Date.now()}`,
      });
      res.json({ received: true, result });
    }),
  );

  // ---------- API pública ----------
  app.get("/api/plans", (_req, res) => {
    res.json(Object.values(billing.PLANS));
  });

  app.get("/api/config", (_req, res) => {
    res.json({ mp_public_key: config.mp.publicKey });
  });

  // ---------- Alta de cuenta con verificación de email (código de 6 dígitos) ----------
  app.post(
    "/api/email-verification/send",
    rateLimit("verif-send", 8, 60_000),
    ah(async (req, res) => {
      const { resendInSeconds } = await emailVerification.sendCode(str(body(req).email));
      res.json({ ok: true, resend_in: resendInSeconds });
    }),
  );

  app.post(
    "/api/email-verification/verify",
    rateLimit("verif-check", 20, 60_000),
    ah(async (req, res) => {
      const b = body(req);
      const token = await emailVerification.verifyCode(str(b.email), str(b.code));
      res.json({ ok: true, verification_token: token });
    }),
  );

  /** Crea la cuenta. Solo funciona con un email previamente verificado (token de un solo uso). */
  app.post(
    "/api/signup",
    rateLimit("signup", 10, 60_000),
    ah(async (req, res) => {
      const b = body(req);
      const name = str(b.name).trim().slice(0, 80);
      const email = emailVerification.normalizeEmail(str(b.email));
      const password = str(b.password);

      if (name.length < 2) throw new HttpError(400, "Ingresá tu nombre.");
      if (email.length > 254 || !emailVerification.EMAIL_RE.test(email)) throw new HttpError(400, "El email no es válido.");
      if (password.length < 8 || password.length > 72) {
        throw new HttpError(400, "La contraseña debe tener entre 8 y 72 caracteres.");
      }

      const proofId = await emailVerification.checkProof(email, str(b.verification_token));

      const { error } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true, // ya lo verificamos nosotros con el código; Supabase no manda su propio mail
        user_metadata: { name },
      });
      if (error) {
        if (error.code === "email_exists" || /already (been )?registered|already exists/i.test(error.message)) {
          throw new HttpError(409, "Ya existe una cuenta con ese email. Iniciá sesión.");
        }
        if (error.code === "weak_password") throw new HttpError(400, "Esa contraseña es muy débil. Probá con otra.");
        console.error("No se pudo crear el usuario", error);
        throw new HttpError(400, "No pudimos crear la cuenta. Probá de nuevo.");
      }

      await emailVerification.consumeProof(proofId);
      res.status(201).json({ ok: true });
    }),
  );

  /** "Me": devuelve perfil, suscripción y pagos del usuario autenticado. */
  app.get(
    "/api/me",
    requireAuth,
    ah(async (req: AuthedRequest, res) => {
      const userId = req.userId!;
      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("id, name, doc_type, doc_number, created_at")
        .eq("id", userId)
        .maybeSingle();

      res.json({
        user: {
          id: userId,
          email: req.userEmail ?? "",
          name: profile?.name ?? req.userEmail ?? "Usuario",
          doc_type: profile?.doc_type ?? null,
          doc_number: profile?.doc_number ?? null,
        },
        subscription: await billing.subscriptionView(userId),
        payments: await billing.userPayments(userId),
        profiles: await profiles.listProfiles(userId, profile?.name ?? "Perfil"),
        max_profiles: profiles.MAX_PROFILES,
        avatars: profiles.AVATARS,
      });
    }),
  );

  /** Guardar doc_type / doc_number en el perfil (opcional, lo puede llamar el frontend al pagar). */
  app.patch(
    "/api/me",
    requireAuth,
    ah(async (req: AuthedRequest, res) => {
      const b = body(req);
      const docType = str(b.doc_type).slice(0, 10) || null;
      const docNumber = str(b.doc_number).replace(/\D/g, "").slice(0, 15) || null;
      await supabaseAdmin
        .from("profiles")
        .update({ doc_type: docType, doc_number: docNumber })
        .eq("id", req.userId!);
      res.json({ ok: true });
    }),
  );

  // ---------- Perfiles ----------
  app.get(
    "/api/profiles",
    requireAuth,
    ah(async (req: AuthedRequest, res) => {
      const userId = req.userId!;
      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("name")
        .eq("id", userId)
        .maybeSingle();
      res.json({
        profiles: await profiles.listProfiles(userId, profile?.name ?? "Perfil"),
        max: profiles.MAX_PROFILES,
        avatars: profiles.AVATARS,
      });
    }),
  );

  app.post(
    "/api/profiles",
    requireAuth,
    rateLimit("profiles", 30, 60_000),
    ah(async (req: AuthedRequest, res) => {
      const b = body(req);
      res.status(201).json(await profiles.createProfile(req.userId!, b.name, b.avatar));
    }),
  );

  app.patch(
    "/api/profiles/:id",
    requireAuth,
    rateLimit("profiles", 30, 60_000),
    ah(async (req: AuthedRequest, res) => {
      const b = body(req);
      res.json(
        await profiles.updateProfile(
          req.userId!,
          intIn(req.params.id, 1, 2_147_483_647, "perfil"),
          { name: b.name, avatar: b.avatar },
        ),
      );
    }),
  );

  app.delete(
    "/api/profiles/:id",
    requireAuth,
    ah(async (req: AuthedRequest, res) => {
      await profiles.deleteProfile(req.userId!, intIn(req.params.id, 1, 2_147_483_647, "perfil"));
      res.json({ ok: true });
    }),
  );

  // ---------- Continuar viendo ----------
  app.get(
    "/api/continue",
    requireAuth,
    ah(async (req: AuthedRequest, res) => {
      const profileId = await requireProfileId(req);
      res.json(await progress.continueList(profileId));
    }),
  );

  app.get(
    "/api/progress/:type/:id",
    requireAuth,
    ah(async (req: AuthedRequest, res) => {
      const profileId = await requireProfileId(req);
      res.json({
        progress: await progress.getProgress(
          profileId,
          mediaType(req.params.type),
          intIn(req.params.id, 1, 99_999_999, "id"),
        ),
      });
    }),
  );

  app.put(
    "/api/progress",
    requireAuth,
    rateLimit("progress", 120, 60_000),
    ah(async (req: AuthedRequest, res) => {
      const profileId = await requireProfileId(req);
      res.json(await progress.saveProgress(profileId, parseProgress(body(req))));
    }),
  );

  app.delete(
    "/api/progress/:type/:id",
    requireAuth,
    ah(async (req: AuthedRequest, res) => {
      const profileId = await requireProfileId(req);
      await progress.removeProgress(
        profileId,
        mediaType(req.params.type),
        intIn(req.params.id, 1, 99_999_999, "id"),
      );
      res.json({ ok: true });
    }),
  );

  // ---------- Suscripciones ----------
  app.post(
    "/api/subscription",
    requireAuth,
    rateLimit("resub", 10, 60_000),
    ah(async (req: AuthedRequest, res) => {
      const userId = req.userId!;
      const b = body(req);
      const planId = str(b.plan_id) || "unico";
      if (!billing.PLANS[planId]) throw new HttpError(400, "Elegí un plan.");
      if (b.accept_terms !== true) {
        throw new HttpError(400, "Tenés que aceptar el cobro recurrente para suscribirte.");
      }
      const last = await billing.latestSubscription(userId);
      if (last && ["pending", "active", "past_due"].includes(last.status)) {
        throw new HttpError(409, "Ya tenés una suscripción en curso.");
      }
      const card = parseCard(b.card);

      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("name")
        .eq("id", userId)
        .maybeSingle();

      const user = {
        id: userId,
        email: req.userEmail ?? "",
        name: profile?.name ?? req.userEmail ?? "Usuario",
      };

      // registrar consentimiento
      const plan = billing.PLANS[planId];
      const nowIso = new Date().toISOString();
      await supabaseAdmin.from("signup_responses").insert({
        user_id: userId,
        submitted_at: nowIso,
        plan_id: plan.id,
        price_cents: plan.price,
        period_days: plan.period_days,
        accepted_terms_at: nowIso,
        ip: req.ip ?? null,
        user_agent: str(req.headers["user-agent"]).slice(0, 300) || null,
        answers_json: {
          name: user.name,
          email: user.email,
          doc_type: card.identification?.type ?? null,
          doc_number: card.identification?.number ?? null,
          plan_id: planId,
          payment_method_id: card.payment_method_id ?? null,
          kind: "resubscribe",
          accepted_terms: true,
          terms_version: TERMS_VERSION,
        },
      });

      await billing.startSubscription(user, planId, card);
      res.json({ ok: true });
    }),
  );

  app.post(
    "/api/subscription/cancel",
    requireAuth,
    ah(async (req: AuthedRequest, res) => {
      await billing.cancelByUser(req.userId!);
      res.json({ ok: true });
    }),
  );

  app.post(
    "/api/subscription/card",
    requireAuth,
    rateLimit("card", 10, 60_000),
    ah(async (req: AuthedRequest, res) => {
      await billing.changeCard(req.userId!, parseCard(body(req).card));
      res.json({ ok: true });
    }),
  );

  // ---------- Panel admin (opcional) ----------
  function requireAdmin(req: Request, _res: Response, next: NextFunction): void {
    if (!config.adminToken) {
      return next(new HttpError(503, "El panel está deshabilitado: definí ADMIN_TOKEN."));
    }
    const given = Buffer.from(String(req.headers.authorization ?? "").replace(/^Bearer\s+/i, ""));
    const expected = Buffer.from(config.adminToken);
    if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
      return next(new HttpError(401, "Token de administrador inválido."));
    }
    next();
  }

  app.get(
    "/api/admin/summary",
    requireAdmin,
    ah(async (_req, res) => res.json(await billing.merchantSummary())),
  );

  app.get(
    "/api/admin/customers",
    requireAdmin,
    ah(async (_req, res) => res.json(await billing.customersList())),
  );

  app.post(
    "/api/admin/resync",
    requireAdmin,
    ah(async (req, res) => {
      const id = str(body(req).authorized_payment_id).trim();
      if (!id) throw new HttpError(400, "Falta authorized_payment_id.");
      res.json({ result: await billing.syncAuthorizedPayment(id) });
    }),
  );
}

/**
 * Manejador de errores de Express. Se llama una sola vez al final,
 * después de montar todas las rutas (en server.ts).
 */
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof HttpError) {
    res.status(err.status).json({ detail: err.message });
    return;
  }
  if (err instanceof SyntaxError) {
    res.status(400).json({ detail: "Revisá los datos e intentá de nuevo." });
    return;
  }
  console.error(err);
  res.status(500).json({ detail: "Algo salió mal. Probá de nuevo." });
}