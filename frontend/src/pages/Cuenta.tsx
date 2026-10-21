import { useEffect, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/auth";
import { supabase } from "../lib/supabase";
import CardForm from "../components/CardForm";
import { api, ApiError, fmtDate, money, type CardData, type Me } from "../lib/api";

const FAILURE: Record<string, string> = {
  fondos_insuficientes: "Fondos insuficientes",
  tarjeta_invalida: "Tarjeta inválida",
  requiere_autorizacion: "Requiere autorización",
  tarjeta_bloqueada: "Tarjeta bloqueada",
  limite_de_intentos: "Límite de intentos",
  rechazado: "Rechazado por el banco",
};

export default function Cuenta() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [showCard, setShowCard] = useState(false);
  const [accept, setAccept] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  async function refresh() {
    const data = await api<Me>("/api/me");
    setMe(data);
  }

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setLoading(false);
      return;
    }
    refresh().finally(() => setLoading(false));
  }, [user, authLoading]);

  async function logout() {
    await supabase.auth.signOut();
    navigate("/ingresar", { replace: true });
  }

  if (authLoading || loading) return <div className="bill-center">Cargando…</div>;
  if (!user || !me?.user) return <Navigate to="/ingresar" replace />;

  const s = me.subscription;
  const canSubscribe = !s || s.status === "canceled";

  async function run(fn: () => Promise<unknown>, ok: string) {
    setError("");
    setMsg("");
    try {
      await fn();
      setMsg(ok);
      setShowCard(false);
      await refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Algo salió mal.");
      throw e;
    }
  }

  const changeCard = (card: CardData) =>
    run(() => api("/api/subscription/card", { method: "POST", body: { card } }), "Listo, guardamos tu nueva tarjeta.");

  const resubscribe = (card: CardData) => {
    if (!accept) {
      setError("Tenés que aceptar el cobro recurrente.");
      return Promise.reject(new Error("terms"));
    }
    return run(
      () => api("/api/subscription", { method: "POST", body: { accept_terms: true, card, plan_id: "unico" } }),
      "Estamos procesando tu pago. Te avisamos por mail apenas se confirme."
    ).then(() => navigate("/", { replace: true }));
  };

  const cancel = async () => {
    if (!confirm("¿Querés cancelar tu suscripción?")) return;
    await run(() => api("/api/subscription/cancel", { method: "POST" }), "Suscripción cancelada.").catch(() => undefined);
  };

  return (
    <div className="bill-page">
      <div className="bill-card">
        <div className="bill-row">
          <h1>Mi cuenta</h1>
          <div>
            {s?.has_access && <Link to="/" className="bill-link">Ver RexPlay</Link>}{" "}
            <button className="bill-link" onClick={logout}>Cerrar sesión</button>
          </div>
        </div>
        <p className="bill-muted">{me.user.name} · {me.user.email}</p>

        {s?.status === "pending" && <div className="bill-notice">Estamos confirmando tu primer pago con Mercado Pago.</div>}
        {s?.status === "past_due" && (
          <div className="bill-notice bill-warn">
            No pudimos cobrar tu tarjeta. Mantenés el acceso hasta el <strong>{fmtDate(s.grace_ends_at)}</strong>.
          </div>
        )}
        {s?.status === "active" && s.cancel_at_period_end && (
          <div className="bill-notice bill-warn">Tu suscripción termina el {fmtDate(s.current_period_end)}.</div>
        )}
        {s?.status === "canceled" && (
          <div className="bill-notice bill-bad">
            {s.canceled_reason === "initial_payment_failed"
              ? "No pudimos cobrar tu primer pago."
              : "Tu suscripción terminó."}
          </div>
        )}
        {msg && <div className="bill-notice">{msg}</div>}
        {error && <p className="bill-error" role="alert">{error}</p>}

        {s && s.status !== "canceled" && (
          <dl className="bill-kv">
            <div><dt>Plan</dt><dd>{s.plan_name} · {money(s.price)} cada {s.period_days} días</dd></div>
            {s.card_brand && <div><dt>Tarjeta</dt><dd>{s.card_brand}{s.card_last4 ? ` terminada en ${s.card_last4}` : ""}</dd></div>}
            {s.next_billing_at && <div><dt>Próximo cobro</dt><dd>{fmtDate(s.next_billing_at)}</dd></div>}
          </dl>
        )}

        {s && ["active", "past_due"].includes(s.status) && (
          <div className="bill-actions">
            <button className="bill-btn bill-ghost" onClick={() => setShowCard(!showCard)}>Actualizar tarjeta</button>
            {!(s.status === "active" && s.cancel_at_period_end) && (
              <button className="bill-btn bill-danger" onClick={cancel}>Cancelar suscripción</button>
            )}
          </div>
        )}
        {showCard && s && (
          <div className="bill-sub">
            <CardForm amount={s.price / 100} payerEmail={me.user.email} submitLabel="Guardar tarjeta" onCard={changeCard} />
          </div>
        )}

        {canSubscribe && (
          <div className="bill-sub">
            <h2>{s ? "Reactivar mi suscripción" : "Suscribirme"}</h2>
            <label className="bill-check">
              <input type="checkbox" checked={accept} onChange={(e) => setAccept(e.target.checked)} />
              <span>Acepto que se me cobren $5.999 hoy y luego cada 31 días hasta que cancele.</span>
            </label>
            <CardForm amount={5999} payerEmail={me.user.email} submitLabel="Suscribirme y pagar $5.999" onCard={resubscribe} />
          </div>
        )}

        <h2>Pagos</h2>
        {me.payments && me.payments.length > 0 ? (
          <table className="bill-table">
            <thead><tr><th>Fecha</th><th>Concepto</th><th>Monto</th><th>Estado</th></tr></thead>
            <tbody>
              {me.payments.map((p, i) => (
                <tr key={i}>
                  <td>{fmtDate(p.created_at)}</td>
                  <td>{p.kind === "initial" ? "Alta" : "Renovación"}</td>
                  <td>{money(p.amount)}</td>
                  <td>{p.status === "succeeded" ? "Aprobado" : `Rechazado: ${FAILURE[p.failure_reason ?? ""] ?? "error"}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="bill-muted">Todavía no hay pagos.</p>}
      </div>
    </div>
  );
}