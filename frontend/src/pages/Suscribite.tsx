import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/auth";
import { supabase } from "../lib/supabase";
import CardForm, { type CardFormHandle } from "../components/CardForm";
import { api, ApiError, money, type CardData, type Plan } from "../lib/api";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export default function Suscribite() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();

  const [plan, setPlan] = useState<Plan | null>(null);
const [form, setForm] = useState({ name: "", email: "", password: "" });
const [accept, setAccept] = useState(false);
const [error, setError] = useState("");
const [msg, setMsg] = useState("");        // <-- añade esta línea
const [sending, setSending] = useState(false);

const cardRef = useRef<CardFormHandle>(null);
const [cardReady, setCardReady] = useState(false);
const [brickEmail, setBrickEmail] = useState("");

  useEffect(() => {
    api<Plan[]>("/api/plans").then((p) => setPlan(p[0])).catch(() => setError("No pudimos cargar los planes."));
  }, []);

  function lockEmail(value: string) {
    const v = value.trim();
    if (!brickEmail && EMAIL_RE.test(v)) setBrickEmail(v);
  }

  async function onCard(card: CardData) {
  setError("");
  if (form.name.trim().length < 2) return fail("Ingresá tu nombre.");
  if (!EMAIL_RE.test(form.email.trim())) return fail("El email no es válido.");
  if (form.password.length < 8) return fail("La contraseña debe tener al menos 8 caracteres.");
  if (!accept) return fail("Tenés que aceptar el cobro recurrente para suscribirte.");

  // 1. Crear usuario en Supabase
  const { data: signup, error: signupErr } = await supabase.auth.signUp({
    email: form.email.trim(),
    password: form.password,
    options: { data: { name: form.name.trim() } },
  });
  if (signupErr) {
    if (signupErr.message.toLowerCase().includes("already")) {
      return fail("Ya existe una cuenta con ese email. Iniciá sesión.");
    }
    return fail(signupErr.message);
  }

  // 2. Si la confirmación por email está activa, no hay sesión todavía
  if (!signup.session) {
    // Guardamos la tarjeta en localStorage para retomarla después de confirmar
    // (o podrías pedirla de nuevo en /cuenta; es más seguro no guardarla).
    setMsg(
      "¡Listo! Te mandamos un email a " +
        form.email +
        ". Hacé clic en el enlace para confirmar tu cuenta, después iniciá sesión y completá el pago desde tu cuenta."
    );
    setSending(false);
    return;
  }

  // 3. Si la confirmación está desactivada, tenemos sesión: cobramos ahora
  try {
    await api("/api/subscription", {
      method: "POST",
      body: { plan_id: plan?.id, accept_terms: true, card },
    });
  } catch (e) {
    await supabase.auth.signOut();
    return fail(e instanceof ApiError ? e.message : "No pudimos procesar el pago.");
  }
  navigate("/", { replace: true });
}

  async function createAccount() {
    if (sending) return;
    setSending(true);
    setError("");
    try {
      await cardRef.current?.submit();
    } catch (e) {
      setError((prev) => prev || (e instanceof Error && e.message ? e.message : "Revisá los datos de la tarjeta."));
    } finally {
      setSending(false);
    }
  }

  function fail(msg: string): never {
    setError(msg);
    throw new Error(msg);
  }

  if (authLoading) return <div className="bill-center">Cargando…</div>;
  if (user) return <Navigate to="/cuenta" replace />;

  return (
    <div className="bill-page">
      <div className="bill-card">
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
              onBlur={(e) => lockEmail(e.target.value)}
              onChange={(e) => {
                setForm({ ...form, email: e.target.value });
                if (document.activeElement !== e.target) lockEmail(e.target.value);
              }}
            />
          </label>
          <label>Contraseña (mínimo 8 caracteres)
            <input type="password" value={form.password} autoComplete="new-password" onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </label>
        </fieldset>
        <label className="bill-check">
          <input type="checkbox" checked={accept} onChange={(e) => setAccept(e.target.checked)} />
          <span>
            Acepto que se me cobren {plan ? money(plan.price) : "el precio del plan"} hoy y luego cada {plan?.period_days ?? 31} días con la tarjeta que cargue, hasta que cancele la suscripción.
          </span>
        </label>
        <fieldset>
          <legend>Medio de pago</legend>
          {plan && (brickEmail ? (
            <CardForm
              ref={cardRef}
              hideSubmit
              payerEmail={brickEmail}
              onBrickReady={() => setCardReady(true)}
              amount={plan.price / 100}
              submitLabel={`Suscribirme y pagar ${money(plan.price)}`}
              onCard={onCard}
            />
          ) : (
            <p className="bill-muted">Ingresá tu email arriba y, al pasar al campo siguiente, se muestran los datos de la tarjeta.</p>
          ))}
        </fieldset>
        {msg && <div className="bill-notice">{msg}</div>}
        {error && <p className="bill-error" role="alert">{error}</p>}
        <button
          type="button"
          className="bill-btn bill-block"
          disabled={!plan || !cardReady || sending}
          onClick={createAccount}
        >
          {sending ? "Creando tu cuenta…" : `Crear cuenta y pagar ${plan ? money(plan.price) : ""}`.trim()}
        </button>
        <p className="bill-muted bill-small">
          Si no podemos cobrar una renovación, tenés {plan?.grace_days ?? 5} días de gracia y te avisamos por mail.
        </p>
      </div>
    </div>
  );
}