import { useEffect, useState, type ReactNode } from "react";
import { useAuth } from "../auth/auth";
import logo from "../assets/rexplay-logo.webp";
import "../splash.css";

const SPLASH_MS = 2000; // tiempo mínimo que se ve el logo
const FADE_MS = 450; // duración del fundido de salida
const MAX_WAIT_MS = 6000; // tope por si la sesión tarda demasiado en resolverse

/**
 * Pantalla de carga inicial (estilo Disney+/HBO).
 * Se muestra una sola vez por carga de página: logo centrado + ruedita abajo a la izquierda.
 * A los 2 s (y cuando ya se sabe si hay sesión) deja pasar a las rutas, que redirigen solas:
 * sin sesión -> /ingresar, con sesión -> la app.
 */
export default function Splash({ children }: { children: ReactNode }) {
  const { loading } = useAuth();
  const [imgReady, setImgReady] = useState(false);
  const [minElapsed, setMinElapsed] = useState(false);
  const [maxElapsed, setMaxElapsed] = useState(false);
  const [gone, setGone] = useState(false);

  // Los 2 s empiezan a contar cuando el logo ya se pintó (así siempre se alcanza a ver)
  useEffect(() => {
    if (!imgReady) return;
    const t = setTimeout(() => setMinElapsed(true), SPLASH_MS);
    return () => clearTimeout(t);
  }, [imgReady]);

  useEffect(() => {
    const t = setTimeout(() => setMaxElapsed(true), MAX_WAIT_MS);
    return () => clearTimeout(t);
  }, []);

  const ready = (minElapsed && !loading) || maxElapsed;

  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(() => setGone(true), FADE_MS);
    return () => clearTimeout(t);
  }, [ready]);

  return (
    <>
      {ready && children}
      {!gone && (
        <div
          className={`splash${ready ? " splash--leaving" : ""}`}
          role="status"
          aria-label="Cargando RexPlay"
        >
          <img
            className="splash-logo"
            src={logo}
            alt="RexPlay"
            onLoad={() => setImgReady(true)}
            onError={() => setImgReady(true)}
          />
          <span className="splash-spinner" aria-hidden="true" />
        </div>
      )}
    </>
  );
}
