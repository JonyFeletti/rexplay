import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";

type Canal = {
  id: number;
  nombre: string;
  logo: string;
  link: string;
};

export default function Vivo() {
  const [canales, setCanales] = useState<Canal[]>([]);
  const [canalActual, setCanalActual] = useState<Canal | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [idle, setIdle] = useState(false);
  const [wheelVisible, setWheelVisible] = useState(false);
  const [hoveredCanal, setHoveredCanal] = useState<Canal | null>(null);
const [tooltipY, setTooltipY] = useState(0);
  // Números tipeados para cambiar de canal
  const [typedNumber, setTypedNumber] = useState("");
  const typedTimerRef = useRef<number | null>(null);

  const wheelRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const uiRef = useRef<HTMLDivElement>(null);

  // Cargar canales
  useEffect(() => {
    async function cargar() {
      const { data, error } = await supabase
        .from("canales")
        .select("id, nombre, logo, link")
        .order("id", { ascending: true });

      if (error) {
        console.error(error);
        setError("No se pudieron cargar los canales.");
      } else {
        const lista = data ?? [];
        setCanales(lista);
        if (lista.length > 0) setCanalActual(lista[0]);
      }
      setLoading(false);
    }
    cargar();
  }, []);

  // Idle: ocultar UI a los 3s, pero NO si el mouse está sobre la interfaz
  useEffect(() => {
    let timer: number;
    const reset = () => {
      setIdle(false);
      clearTimeout(timer);
      timer = window.setTimeout(() => {
        // Si el mouse está sobre la interfaz, no ocultar
        if (uiRef.current?.matches(":hover") || wheelRef.current?.matches(":hover")) {
          return;
        }
        setIdle(true);
      }, 3000);
    };
    const onMove = () => reset();
    window.addEventListener("mousemove", onMove);
    window.addEventListener("touchstart", onMove);
    window.addEventListener("click", onMove);
    window.addEventListener("keydown", onMove);
    reset();
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("touchstart", onMove);
      window.removeEventListener("click", onMove);
      window.removeEventListener("keydown", onMove);
      clearTimeout(timer);
    };
  }, []);

  // Selector lateral: aparece al acercar el mouse al borde izquierdo
  useEffect(() => {
    let hideTimer: number;
    const show = () => {
      setWheelVisible(true);
      clearTimeout(hideTimer);
    };
    const scheduleHide = (delay = 500) => {
      clearTimeout(hideTimer);
      hideTimer = window.setTimeout(() => {
        if (!wheelRef.current?.matches(":hover")) {
          setWheelVisible(false);
        }
      }, delay);
    };

    const onMove = (e: MouseEvent) => {
      if (e.clientX <= 70) {
        show();
      } else if (!wheelRef.current?.matches(":hover")) {
        scheduleHide();
      }
    };

    document.addEventListener("mousemove", onMove);
    return () => {
      document.removeEventListener("mousemove", onMove);
      clearTimeout(hideTimer);
    };
  }, []);

  // Detectar teclas numéricas para cambiar de canal
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Solo dígitos del 0 al 9
      if (!/^[0-9]$/.test(e.key)) return;
      // Ignorar si el foco está en un input/textarea
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;

      e.preventDefault();

      // Reiniciar el timer si ya había números tipeados
      if (typedTimerRef.current) clearTimeout(typedTimerRef.current);

      setTypedNumber((prev) => {
        // Máximo 4 dígitos
        const next = (prev + e.key).slice(-4);
        return next;
      });

      // Después de 1.5s sin tipear, buscar el canal
      typedTimerRef.current = window.setTimeout(() => {
        setTypedNumber((current) => {
          if (current.length > 0) {
            const num = Number(current);
            const encontrado = canales.find((c) => c.id === num);
            if (encontrado) setCanalActual(encontrado);
          }
          return "";
        });
      }, 1500);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      if (typedTimerRef.current) clearTimeout(typedTimerRef.current);
    };
  }, [canales]);

  const indiceActual = useMemo(
    () => (canalActual ? canales.findIndex((c) => c.id === canalActual.id) : -1),
    [canalActual, canales],
  );

  function irASiguiente() {
    if (canales.length === 0) return;
    const next = indiceActual + 1 >= canales.length ? 0 : indiceActual + 1;
    setCanalActual(canales[next]);
  }

  function irAAnterior() {
    if (canales.length === 0) return;
    const prev = indiceActual - 1 < 0 ? canales.length - 1 : indiceActual - 1;
    setCanalActual(canales[prev]);
  }

  function recargar() {
    if (iframeRef.current && canalActual) {
      const url = new URL(canalActual.link);
      url.searchParams.set("_t", String(Date.now()));
      iframeRef.current.src = url.toString();
    }
  }

  return (
    <div className={`watch-page ${idle ? "player-idle" : ""}`}>
      {/* Iframe */}
      <div className="watch-player-fullscreen">
        {loading && <p className="watch-loading">Cargando canales...</p>}
        {error && <p className="watch-error">{error}</p>}
        {!loading && canalActual && (
          <iframe
            ref={iframeRef}
            key={canalActual.id}
            className="watch-frame"
            src={canalActual.link}
            title={canalActual.nombre}
            allow="autoplay; fullscreen; encrypted-media"
            sandbox="allow-scripts allow-same-origin allow-forms allow-presentation"
            allowFullScreen
          />
        )}
      </div>

      {/* Barra superior */}
      <div className="watch-top-bar" ref={uiRef}>
        <div className="watch-top-left">
          <Link
  to="/"
  className="watch-back-btn"
  onClick={() => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {
        // Ignorar errores si el navegador lo rechaza
      });
    }
  }}
>
  ← Volver
</Link>
          {canalActual && (
            <div className="live-channel-info">
              <img
                src={canalActual.logo}
                alt={canalActual.nombre}
                className="live-channel-logo"
              />
              <div>
                <h1>{canalActual.nombre}</h1>
                <p>
                  <span className="watch-chip">CH {canalActual.id}</span>
                  <span className="live-badge">
                    <span className="live-dot" />
                    VIVO
                  </span>
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="watch-top-right">
          <div className="quick-tuner">
            <button
              className="quick-tuner-btn"
              onClick={irAAnterior}
              aria-label="Canal anterior"
            >
              −
            </button>
            <span className="quick-tuner-label">CH</span>
            <button
              className="quick-tuner-btn"
              onClick={irASiguiente}
              aria-label="Canal siguiente"
            >
              +
            </button>
          </div>

          <button className="watch-btn-primary" onClick={recargar}>
            ⟳ VIVO
          </button>
        </div>
      </div>

      {/* Selector vertical de canales */}
      <div
        ref={wheelRef}
        className={`channel-wheel ${wheelVisible ? "visible" : ""}`}
        onMouseEnter={() => setWheelVisible(true)}
        onMouseLeave={() => setWheelVisible(false)}
      >
        {canales.map((canal) => (
          <div
            key={canal.id}
            className={`channel-wheel-item ${canal.id === canalActual?.id ? "active" : ""}`}
            onMouseEnter={(e) => {
  setHoveredCanal(canal);
  const rect = e.currentTarget.getBoundingClientRect();
  setTooltipY(rect.top + rect.height / 2);
}}
onMouseLeave={() => setHoveredCanal(null)}
            onClick={() => setCanalActual(canal)}
          >
            <img src={canal.logo} alt={canal.nombre} />
            {hoveredCanal?.id === canal.id && (
              <span className="channel-wheel-tooltip">{canal.nombre}</span>
            )}
          </div>
        ))}
      </div>

      {/* Números tipeados para cambiar de canal */}
      {typedNumber && (
  <div className="channel-typed-overlay">
    <span className="channel-typed-number">{typedNumber}</span>
  </div>
)}
{hoveredCanal && (
  <div className="channel-wheel-tooltip-fixed" style={{ top: tooltipY }}>
    {hoveredCanal.nombre}
  </div>
)}

      {/* Pantalla completa */}
      <button
        className="watch-fullscreen-btn"
        onClick={() => {
          if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen();
          } else {
            document.exitFullscreen();
          }
        }}
        aria-label="Pantalla completa"
      >
        ⛶
      </button>
    </div>
  );
}