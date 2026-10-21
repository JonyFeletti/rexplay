import { useState, type FormEvent } from "react";
import { Link, Navigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../auth/auth";

export default function Ingresar() {
  const { user } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/" replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setError(error.message);
    setBusy(false);
  }

  return (
    <div className="bill-page">
      <form className="bill-card" onSubmit={submit}>
        <h1>Iniciar sesión</h1>
        <label>
          Email
          <input type="email" value={email} autoComplete="email" onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label>
          Contraseña
          <input type="password" value={password} autoComplete="current-password" onChange={(e) => setPassword(e.target.value)} required />
        </label>
        <button className="bill-btn" disabled={busy}>{busy ? "Entrando…" : "Entrar"}</button>
        {error && <p className="bill-error" role="alert">{error}</p>}
        <p className="bill-muted">¿No tenés cuenta? <Link to="/suscribite">Suscribite</Link></p>
      </form>
    </div>
  );
}