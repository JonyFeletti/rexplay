import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/auth";
import { supabase } from "../lib/supabase";
import CardFields, { type CardFieldsHandle } from "../components/CardFields";
import PasswordInput from "../components/PasswordInput";
import { api, ApiError, money, type CardData, type Plan } from "../lib/api";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const RESEND_SECONDS = 45;

export default function Suscribite() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();

  const [plan, setPlan] = useState<Plan | null>(null);
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [accept, setAccept] = useState(false);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [sending, setSending] = useState(false);

  // Verificación de email (código de 6 dígitos)
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState("");
  const [verifiedToken, setVerifiedToken] = useState("");
  const [verifiedEmail, setVerifiedEmail] = useState("");
  const [sendingCode, setSendingCode] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  const emailKey = form.email.trim().toLowerCase();
  const verified = verifiedToken !== "" && verifiedEmail === emailKey;

  const cardRef = useRef<CardFieldsHandle>(null);
  const [cardReady, setCardReady] = useState(false);

  useEffect(() => {
    api<Plan[]>("/api/plans").then((p) => setPlan(p[0])).catch(() => setError("No pudimos cargar los planes."));
  }, []);

  // Cuenta regresiva para poder reenviar el código
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  /** Valida los datos de la cuenta (sin la aceptación de cobro, que se pide recién al pagar). */
  function validateAccountFields(): string | null {
    if (form.name.trim().length < 2) return "Ingresá tu nombre.";
    if (!EMAIL_RE.test(form.email.trim())) return "El email no es válido.";
    if (form.password.length < 8) return "La contraseña debe tener al menos 8 caracteres.";
    return null;
  }

  /** Valida todo antes de tokenizar la tarjeta (el token es de un solo uso). */
  function validateAccount(): string | null {
    const fieldsError = validateAccountFields();
    if (fieldsError) return fieldsError;
    if (!verified) return "Verificá tu email para continuar.";
    if (!accept) return "Tenés que aceptar el cobro recurrente para suscribirte.";
    return null;
  }

  async function sendCode() {
    if (sendingCode || cooldown > 0) return;
    setError("");
    setMsg("");
    const fieldsError = validateAccountFields();
    if (fieldsError) return setError(fieldsError);

    setSendingCode(true);
    try {
      await api("/api/email-verification/send", { method: "POST", body: { email: form.email.trim() } });
      setCodeSent(true);
      setCode("");
      setCooldown(RESEND_SECONDS);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "No pudimos enviar el código. Probá de nuevo.");
    } finally {
      setSendingCode(false);
    }
  }

  async function verifyCode() {
    if (verifying) return;
    setError("");
    if (!/^\d{6}$/.test(code)) return setError("Ingresá los 6 dígitos del código.");

    setVerifying(true);
    try {
      const res = await api<{ verification_token: string }>("/api/email-verification/verify", {
        method: "POST",
        body: { email: form.email.trim(), code },
      });
      setVerifiedToken(res.verification_token);
      setVerifiedEmail(emailKey);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "No pudimos verificar el código. Probá de nuevo.");
    } finally {
      setVerifying(false);
    }
  }

  /** Vuelve atrás para corregir el email: se descarta el código y la verificación. */
  function changeEmail() {
    setCodeSent(false);
    setCode("");
    setVerifiedToken("");
    setVerifiedEmail("");
    setCooldown(0);
    setError("");
  }

  async function createAccount() {
    if (sending) return;
    setError("");
    setMsg("");

    const accountError = validateAccount();
    if (accountError) return setError(accountError);

    setSending(true);
    try {
      // 1. Tokenizar la tarjeta (Mercado Pago). Los datos sensibles nunca llegan a nuestro servidor.
      const card: CardData = await cardRef.current!.tokenize();

      // 2. Crear la cuenta en el backend (exige el token del email verificado)
      try {
        await api("/api/signup", {
          method: "POST",
          body: {
            name: form.name.trim(),
            email: form.email.trim(),
            password: form.password,
            verification_token: verifiedToken,
          },
        });
      } catch (e) {
        return setError(e instanceof ApiError ? e.message : "No pudimos crear la cuenta.");
      }

      // 3. Iniciar sesión (el email ya está confirmado, no hace falta ningún enlace)
      const { error: loginErr } = await supabase.auth.signInWithPassword({
        email: form.email.trim(),
        password: form.password,
      });
      if (loginErr) {
        return setMsg("Tu cuenta se creó. Iniciá sesión y completá el pago desde tu cuenta.");
      }

      // 4. Con sesión activa: creamos la suscripción y cobramos ahora
      try {
        await api("/api/subscription", {
          method: "POST",
          body: { plan_id: plan?.id, accept_terms: true, card },
        });
      } catch (e) {
        await supabase.auth.signOut();
        return setError(e instanceof ApiError ? e.message : "No pudimos procesar el pago.");
      }
      navigate("/", { replace: true });
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : "Revisá los datos de la tarjeta.");
    } finally {
      setSending(false);
    }
  }

  if (authLoading) return <div className="bill-center">Cargando…</div>;
  if (user) return <Navigate to="/cuenta" replace />;

  return (
    <div className="bill-page">
      <form
        className="bill-card"
        onSubmit={(e) => {
          e.preventDefault();
          void createAccount();
        }}
      >
        <Link to="/ingresar" className="bill-link-top">Ya tengo cuenta</Link>
        <h1>Suscribite a RexPlay</h1>
        {plan && (
          <div className="bill-plan">
            <strong>{money(plan.price)}</strong> <span>cada {plan.period_days} días</span>
            <p className="bill-muted">
              {plan.description}. Se cobra ahora y se renueva automáticamente cada {plan.period_days} días. Cancelás cuando quieras.
            </p>
          </div>
        )}
        <fieldset>
          <legend>Tu cuenta</legend>
          <label>Nombre
            <input value={form.name} autoComplete="name" onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          <label>Email
            <input
              type="email"
              value={form.email}
              autoComplete="email"
              readOnly={codeSent}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </label>
          <label>Contraseña (mínimo 8 caracteres)
            <PasswordInput
              value={form.password}
              autoComplete="new-password"
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
          </label>

          {!codeSent && (
            <button type="button" className="bill-btn bill-block" disabled={sendingCode} onClick={() => void sendCode()}>
              {sendingCode ? "Enviando código…" : "Continuar"}
            </button>
          )}

          {codeSent && !verified && (
            <div className="bill-verify">
              <p className="bill-muted">
                Te enviamos un código de 6 dígitos a <strong>{form.email.trim()}</strong>. Vence en 10 minutos.
              </p>
              <label>Código de verificación
                <input
                  className="bill-code"
                  value={code}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  placeholder="000000"
                  autoFocus
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void verifyCode();
                    }
                  }}
                />
              </label>
              <button
                type="button"
                className="bill-btn bill-block"
                disabled={verifying || code.length !== 6}
                onClick={() => void verifyCode()}
              >
                {verifying ? "Verificando…" : "Verificar email"}
              </button>
              <div className="bill-verify-actions">
                <button type="button" className="bill-link" disabled={sendingCode || cooldown > 0} onClick={() => void sendCode()}>
                  {cooldown > 0 ? `Reenviar código en ${cooldown}s` : "Reenviar código"}
                </button>
                <button type="button" className="bill-link" onClick={changeEmail}>Cambiar email</button>
              </div>
            </div>
          )}

          {verified && (
            <p className="bill-verified">
              ✓ Email verificado ·{" "}
              <button type="button" className="bill-link" onClick={changeEmail}>Cambiar</button>
            </p>
          )}
        </fieldset>
        <fieldset className={verified ? undefined : "bill-locked"}>
          <legend>
            <svg className="cf-lock" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="4" y="11" width="16" height="10" rx="2" />
              <path d="M8 11V7a4 4 0 0 1 8 0v4" />
            </svg>
            Datos de la tarjeta
          </legend>
          {!verified && <p className="bill-muted bill-small">Verificá tu email para cargar la tarjeta.</p>}
          <div inert={!verified}>
            <CardFields ref={cardRef} onReady={() => setCardReady(true)} />
          </div>
        </fieldset>
        <label className="bill-check">
          <input type="checkbox" checked={accept} disabled={!verified} onChange={(e) => setAccept(e.target.checked)} />
          <span>
            Acepto que se me cobren {plan ? money(plan.price) : "el precio del plan"} hoy y luego cada {plan?.period_days ?? 31} días con la tarjeta que cargue, hasta que cancele la suscripción.
          </span>
        </label>
        {msg && <div className="bill-notice">{msg}</div>}
        {error && <p className="bill-error" role="alert">{error}</p>}
        <button type="submit" className="bill-btn bill-block" disabled={!plan || !cardReady || !verified || sending}>
          {sending ? "Creando tu cuenta…" : `Crear cuenta y pagar ${plan ? money(plan.price) : ""}`.trim()}
        </button>
        <p className="bill-muted bill-small">
          Si no podemos cobrar una renovación, tenés {plan?.grace_days ?? 5} días de gracia y te avisamos por mail.
        </p>
      </form>
    </div>
  );
}
