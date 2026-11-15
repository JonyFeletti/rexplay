import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useAuth } from "../auth/auth";
import { SplashHoldContext } from "./splashHold";
import logo from "../assets/rexplay-logo.webp";
import "../splash.css";

const SPLASH_MS = 2000; // tiempo mínimo que se ve el logo
const FADE_MS = 450; // duración del fundido de salida
const MAX_WAIT_MS = 6000; // tope por si la sesión/datos tardan demasiado

/**
 * Pantalla de carga inicial (estilo Disney+/HBO).
 * La app se monta detrás desde el principio, así la sesión y la suscripción se verifican
 * mientras se ve el logo. Cuando pasan los 2 s y todo está listo, se funde y queda directamente
 * la pantalla destino (login o app), sin pasos intermedios de "Cargando…".
 * Se muestra una sola vez por carga de página.
 */
export default function Splash({ children }: { children: ReactNode }) {
  const { loading } = useAuth();
  const [imgReady, setImgReady] = useState(false);
  const [minElapsed, setMinElapsed] = useState(false);
  const [maxElapsed, setMaxElapsed] = useState(false);
  const [holds, setHolds] = useState(0);
  const [done, setDone] = useState(false); // se "traba" en true: el splash no vuelve a aparecer
  const [gone, setGone] = useState(false);

  const adjustHolds = useCallback((d: number) => setHolds((h) => h + d), []);

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

  useEffect(() => {
    if (done) return;
    if ((minElapsed && !loading && holds === 0) || maxElapsed) setDone(true);
  }, [done, minElapsed, loading, holds, maxElapsed]);

  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setGone(true), FADE_MS);
    return () => clearTimeout(t);
  }, [done]);

  return (
    <SplashHoldContext.Provider value={adjustHolds}>
      {children}
      {!gone && (
        <div
          className={`splash${done ? " splash--leaving" : ""}`}
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
    </SplashHoldContext.Provider>
  );
}
