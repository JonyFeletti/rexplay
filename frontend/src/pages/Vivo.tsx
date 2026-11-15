import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";

type Canal = {
  id: number;
  nombre: string;
  logo: string;
  link: string;
};

type Programa = {
  canalId: string;
  inicio: string;
  fin: string;
  titulo: string;
  descripcion: string | null;
};

type EpgData = {
  canales: { id: string; nombre: string }[];
  programas: Programa[];
};

// --- Parser de fechas ---
function parseEpgDate(str: string): Date {
  const match = str.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/);
  if (!match) {
    const fallback = new Date(str);
    return isNaN(fallback.getTime()) ? new Date() : fallback;
  }
  const [, year, month, day, hour, minute, second] = match;
  return new Date(Date.UTC(
    parseInt(year), parseInt(month) - 1, parseInt(day),
    parseInt(hour), parseInt(minute), parseInt(second)
  ));
}

// --- Alias manuales ---
const ALIAS_CANALES: Record<string, string> = {
  "americatv": "AMERICA TV HD.ar",
  "canal26": "CANAL 26 HD.ar",
  "tn": "TN HD.ar",
  "todo noticias": "TN HD.ar",
};

function normalizar(str: string) {
  if (!str) return "";
  return str.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/hd/g, "").replace(/\.ar/g, "").replace(/[^a-z0-9]/g, "").trim();
}

function encontrarCanalEPG(nombreSupabase: string, canalesEPG: { id: string; nombre: string }[]) {
  if (!canalesEPG) return null;
  const target = normalizar(nombreSupabase);
  
  const aliasTarget = ALIAS_CANALES[target];
  if (aliasTarget) {
    const manual = canalesEPG.find(c => normalizar(c.nombre) === normalizar(aliasTarget));
    if (manual) return manual;
  }
  
  let encontrado = canalesEPG.find(c => normalizar(c.nombre) === target);
  if (!encontrado) {
    encontrado = canalesEPG.find(c => {
      const nombreEPG = normalizar(c.nombre);
      return nombreEPG.startsWith(target) || target.startsWith(nombreEPG);
    });
  }
  if (!encontrado && target.length > 4) {
    encontrado = canalesEPG.find(c => {
      const nombreEPG = normalizar(c.nombre);
      return nombreEPG.includes(target) && Math.abs(nombreEPG.length - target.length) < 4;
    });
  }
  return encontrado;
}

// --- Componente de la Guía ---
// --- Componente de la Guía ---
function GuiaEPG({
  programas,
  canalesSupabase,
  epgCanales,
  canalGuiaInicial,
  onSeleccionarPrograma,
  onCerrar,
}: {
  programas: Programa[];
  canalesSupabase: Canal[];
  epgCanales: { id: string; nombre: string }[];
  canalGuiaInicial: string;
  onSeleccionarPrograma: (nombreCanal: string) => void;
  onCerrar: () => void;
}) {
  const [canalGuia, setCanalGuia] = useState(canalGuiaInicial);
  const [horaActual, setHoraActual] = useState(new Date());
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = setInterval(() => setHoraActual(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    setCanalGuia(canalGuiaInicial);
  }, [canalGuiaInicial]);

    const canalEPG = encontrarCanalEPG(canalGuia, epgCanales);
  const programasOrdenados = programas
    .filter((p) => p.canalId === canalEPG?.id)
    .sort((a, b) => parseEpgDate(a.inicio).getTime() - parseEpgDate(b.inicio).getTime());

  const programaActualIndex = programasOrdenados.findIndex((p) => {
    const inicio = parseEpgDate(p.inicio);
    const fin = parseEpgDate(p.fin);
    return horaActual >= inicio && horaActual < fin;
  });

  // Si encontramos el programa actual, rotamos la lista para que él sea el primero.
  // Si no lo encontramos (por ejemplo, si no hay EPG), dejamos la lista normal.
  const programasDelCanal = programaActualIndex >= 0 
    ? [
        ...programasOrdenados.slice(programaActualIndex),
        ...programasOrdenados.slice(0, programaActualIndex)
      ]
    : programasOrdenados;

  // Como ahora el programa actual es siempre el primero de la lista, el índice es 0
  const idx = 0;

  const cambiarCanalArribaAbajo = (direccion: 1 | -1) => {
    const indexActual = canalesSupabase.findIndex((c) => c.nombre === canalGuia);
    let nuevoIndex = indexActual + direccion;
    if (nuevoIndex < 0) nuevoIndex = canalesSupabase.length - 1;
    if (nuevoIndex >= canalesSupabase.length) nuevoIndex = 0;
    setCanalGuia(canalesSupabase[nuevoIndex].nombre);
  };

  // Auto-scroll instantáneo
  useEffect(() => {
    if (scrollRef.current && programaActualIndex >= 0) {
      const item = scrollRef.current.children[programaActualIndex] as HTMLElement;
      if (item) {
        scrollRef.current.scrollTo({
          left: item.offsetLeft - 50,
          behavior: "auto", 
        });
      }
    }
  }, [programaActualIndex, canalGuia]);

  // Factor de escala: 1 minuto = 3px (30 min = 90px, 1 hora = 180px)
  const PX_POR_MINUTO = 3;

  return (
    <div className="epg-container">
      <div className="epg-header">
        <div className="epg-nav-channels">
          <button onClick={() => cambiarCanalArribaAbajo(-1)} aria-label="Anterior">−</button>
          <button onClick={() => cambiarCanalArribaAbajo(1)} aria-label="Siguiente">+</button>
          <span className="epg-canal-nombre">{canalGuia}</span>
        </div>
        <button className="epg-close-btn" onClick={onCerrar}>✕</button>
      </div>

      {!programasDelCanal.length ? (
        <div className="epg-content">
          <div className="epg-empty">Sin información de programación para este canal.</div>
        </div>
      ) : (
        <div className="epg-content" ref={scrollRef}>
          <div className="epg-timeline">
            {programasDelCanal.map((prog, i) => {
              const esActual = i === idx;
              const inicio = parseEpgDate(prog.inicio);
              const fin = parseEpgDate(prog.fin);
              
              // Calcular ancho exacto en base a la duración
              const duracionMinutos = (fin.getTime() - inicio.getTime()) / 60000;
              const anchoPx = duracionMinutos * PX_POR_MINUTO;

              let progreso = 0;
              if (esActual) {
                const total = fin.getTime() - inicio.getTime();
                const transcurrido = horaActual.getTime() - inicio.getTime();
                progreso = Math.min(100, Math.max(0, (transcurrido / total) * 100));
              }

              return (
                <div 
                  key={i} 
                  className={`epg-item ${esActual ? "actual" : ""}`}
                  style={{ width: `${anchoPx}px` }} // Ancho dinámico
                  onClick={() => onSeleccionarPrograma(canalGuia)}
                >
                  {/* Horario en la parte superior */}
                  <div className="epg-time">
                    {inicio.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </div>
                  
                  <div className="epg-title">{prog.titulo}</div>
                  
                  {esActual && (
                    <div className="epg-progress-bar">
                      <div className="epg-progress-fill" style={{ width: `${progreso}%` }} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// --- Componente Principal ---
export default function Vivo() {
  const [canales, setCanales] = useState<Canal[]>([]);
  const [canalActual, setCanalActual] = useState<Canal | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [idle, setIdle] = useState(false);
  const [wheelVisible, setWheelVisible] = useState(false);
  const [hoveredCanal, setHoveredCanal] = useState<Canal | null>(null);
  const [tooltipY, setTooltipY] = useState(0);

  const [typedNumber, setTypedNumber] = useState("");
  const typedTimerRef = useRef<number | null>(null);

  const wheelRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const uiRef = useRef<HTMLDivElement>(null);

  const [epg, setEpg] = useState<EpgData | null>(null);
  const [mostrarGuia, setMostrarGuia] = useState(false);

  useEffect(() => {
    fetch("/api/epg").then((res) => res.json()).then(setEpg).catch((err) => console.error(err));
  }, []);

  useEffect(() => {
    async function cargar() {
      const { data, error } = await supabase.from("canales").select("id, nombre, logo, link").order("id", { ascending: true });
      if (error) setError("No se pudieron cargar los canales.");
      else {
        const lista = data ?? [];
        setCanales(lista);
        if (lista.length > 0) setCanalActual(lista[0]);
      }
      setLoading(false);
    }
    cargar();
  }, []);

  useEffect(() => {
    let timer: number;
    const reset = () => {
      setIdle(false);
      clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (uiRef.current?.matches(":hover") || wheelRef.current?.matches(":hover")) return;
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

  useEffect(() => {
    let hideTimer: number;
    const show = () => { setWheelVisible(true); clearTimeout(hideTimer); };
    const scheduleHide = (delay = 500) => {
      clearTimeout(hideTimer);
      hideTimer = window.setTimeout(() => {
        if (!wheelRef.current?.matches(":hover")) setWheelVisible(false);
      }, delay);
    };
    const onMove = (e: MouseEvent) => {
      if (e.clientX <= 70) show();
      else if (!wheelRef.current?.matches(":hover")) scheduleHide();
    };
    document.addEventListener("mousemove", onMove);
    return () => { document.removeEventListener("mousemove", onMove); clearTimeout(hideTimer); };
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Tab") { e.preventDefault(); setMostrarGuia((prev) => !prev); return; }
      if (e.key === "Escape") { setMostrarGuia(false); return; }
      if (!/^[0-9]$/.test(e.key)) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      e.preventDefault();
      if (typedTimerRef.current) clearTimeout(typedTimerRef.current);
      setTypedNumber((prev) => (prev + e.key).slice(-4));
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

  const indiceActual = useMemo(() => (canalActual ? canales.findIndex((c) => c.id === canalActual.id) : -1), [canalActual, canales]);

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

  const canalEPGActual = canalActual && epg ? encontrarCanalEPG(canalActual.nombre, epg.canales) : null;
  const ahora = new Date();
  const programaActual = epg?.programas.find(
    (p) => p.canalId === canalEPGActual?.id && parseEpgDate(p.inicio) <= ahora && parseEpgDate(p.fin) > ahora
  );

  return (
    <div className={`watch-page ${idle ? "player-idle" : ""}`}>
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

      <div className="watch-top-bar" ref={uiRef}>
        <div className="watch-top-left">
          <Link to="/" className="watch-back-btn" onClick={() => { if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); }}>
            ← Volver
          </Link>
          {canalActual && (
            <div className="live-channel-info">
              <img src={canalActual.logo} alt={canalActual.nombre} className="live-channel-logo" />
              <div className="live-channel-details">
                <h1>{canalActual.nombre}</h1>
                <div className="live-channel-meta">
                  <span className="watch-chip">CH {canalActual.id}</span>
                  <span className="live-badge"><span className="live-dot" /> VIVO</span>
                  
                  {/* Título del programa al lado de los datos del canal */}
                  {programaActual && (
                    <div className="epg-current-program" onClick={() => setMostrarGuia(true)} title="Ver programación completa">
                      <strong>{programaActual.titulo}</strong>
                      <span>
                        {parseEpgDate(programaActual.inicio).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} -{" "}
                        {parseEpgDate(programaActual.fin).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="watch-top-right">
          <div className="quick-tuner">
            <button className="quick-tuner-btn" onClick={irAAnterior} aria-label="Canal anterior">−</button>
            <span className="quick-tuner-label">CH</span>
            <button className="quick-tuner-btn" onClick={irASiguiente} aria-label="Canal siguiente">+</button>
          </div>
          <button className="watch-btn-primary" onClick={recargar}>⟳ VIVO</button>
        </div>
      </div>

      <div ref={wheelRef} className={`channel-wheel ${wheelVisible ? "visible" : ""}`} onMouseEnter={() => setWheelVisible(true)} onMouseLeave={() => setWheelVisible(false)}>
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
          </div>
        ))}
      </div>

      {hoveredCanal && (
        <div className="channel-wheel-tooltip-fixed" style={{ top: tooltipY }}>{hoveredCanal.nombre}</div>
      )}

      {typedNumber && (
        <div className="channel-typed-overlay"><span className="channel-typed-number">{typedNumber}</span></div>
      )}

      {mostrarGuia && epg && canalActual && (
        <GuiaEPG
          programas={epg.programas}
          canalesSupabase={canales}
          epgCanales={epg.canales}
          canalGuiaInicial={canalActual.nombre}
          onSeleccionarPrograma={(nombreCanal) => {
            const c = canales.find((c) => c.nombre === nombreCanal);
            if (c) { setCanalActual(c); setMostrarGuia(false); }
          }}
          onCerrar={() => setMostrarGuia(false)}
        />
      )}

      <button className="watch-fullscreen-btn" onClick={() => { if (!document.fullscreenElement) document.documentElement.requestFullscreen(); else document.exitFullscreen(); }} aria-label="Pantalla completa">⛶</button>
    </div>
  );
}