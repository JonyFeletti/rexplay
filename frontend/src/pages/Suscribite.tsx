import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/auth";
import { supabase } from "../lib/supabase";
import CardFields, { type CardFieldsHandle } from "../components/CardFields";
import PasswordInput from "../components/PasswordInput";
import { api, ApiError, money, type CardData, type Plan } from "../lib/api";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export default function Suscribite() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();

  const [plan, setPlan] = useState<Plan | null>(null);
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [accept, setAccept] = useState(false);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [sending, setSending] = useState(false);

  const cardRef = useRef<CardFieldsHandle>(null);
  const [cardReady, setCardReady] = useState(false);

  useEffect(() => {
    api<Plan[]>("/api/plans").then((p) => setPlan(p[0])).catch(() => setError("No pudimos cargar los planes."));
  }, []);

  /** Valida los datos de la cuenta antes de tokenizar la tarjeta (el token es de un solo uso). */
  function validateAccount(): string | null {
    if (form.name.trim().length < 2) return "Ingresá tu nombre.";
    if (!EMAIL_RE.test(form.email.trim())) return "El email no es válido.";
    if (form.password.length < 8) return "La contraseña debe tener al menos 8 caracteres.";
    if (!accept) return "Tenés que aceptar el cobro recurrente para suscribirte.";
    return null;
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

      // 2. Crear usuario en Supabase
      const { data: signup, error: signupErr } = await supabase.auth.signUp({
        email: form.email.trim(),
        password: form.password,
        options: { data: { name: form.name.trim() } },
      });
      if (signupErr) {
        return setError(
          signupErr.message.toLowerCase().includes("already")
            ? "Ya existe una cuenta con ese email. Iniciá sesión."
            : signupErr.message,
        );
      }

      // 3. Si la confirmación por email está activa, todavía no hay sesión: el pago se completa desde /cuenta
      if (!signup.session) {
        return setMsg(
          `¡Listo! Te mandamos un email a ${form.email.trim()}. Hacé clic en el enlace para confirmar tu cuenta, después iniciá sesión y completá el pago desde tu cuenta.`,
        );
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
        </fieldset>
        <fieldset>
          <legend>
            <svg className="cf-lock" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="4" y="11" width="16" height="10" rx="2" />
              <path d="M8 11V7a4 4 0 0 1 8 0v4" />
            </svg>
            Datos de la tarjeta
          </legend>
          <CardFields ref={cardRef} onReady={() => setCardReady(true)} />
        </fieldset>
        <label className="bill-check">
          <input type="checkbox" checked={accept} onChange={(e) => setAccept(e.target.checked)} />
          <span>
            Acepto que se me cobren {plan ? money(plan.price) : "el precio del plan"} hoy y luego cada {plan?.period_days ?? 31} días con la tarjeta que cargue, hasta que cancele la suscripción.
          </span>
        </label>
        {msg && <div className="bill-notice">{msg}</div>}
        {error && <p className="bill-error" role="alert">{error}</p>}
        <button type="submit" className="bill-btn bill-block" disabled={!plan || !cardReady || sending}>
          {sending ? "Creando tu cuenta…" : `Crear cuenta y pagar ${plan ? money(plan.price) : ""}`.trim()}
        </button>
        <p className="bill-muted bill-small">
          Si no podemos cobrar una renovación, tenés {plan?.grace_days ?? 5} días de gracia y te avisamos por mail.
        </p>
      </form>
    </div>
  );
}
