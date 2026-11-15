import { useEffect, useRef, useState } from "react";

type Programa = {
  canalId: string;
  inicio: string;
  fin: string;
  titulo: string;
  descripcion: string | null;
};

export function GuiaEPG({
  programas,
  canalActualId,
  onCambiarCanal,
  canalesSupabase,
  epgCanales
}: {
  programas: Programa[];
  canalActualId: string;
  onCambiarCanal: (id: string) => void;
  canalesSupabase: any[];
  epgCanales: any[];
}) {
  const [horaActual, setHoraActual] = useState(new Date());
  const scrollRef = useRef<HTMLDivElement>(null);

  // Actualizar la hora cada minuto para mover la línea de "AHORA"
  useEffect(() => {
    const timer = setInterval(() => setHoraActual(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  // Encontrar los programas del canal actual
  const canalEPG = epgCanales.find(c => c.nombre.includes(canalActualId) || canalActualId.includes(c.nombre));
  const programasDelCanal = programas
    .filter(p => p.canalId === canalEPG?.id)
    .sort((a, b) => new Date(a.inicio).getTime() - new Date(b.inicio).getTime());

  // Encontrar el programa actual
  const programaActualIndex = programasDelCanal.findIndex(p => {
    const inicio = new Date(p.inicio);
    const fin = new Date(p.fin);
    return horaActual >= inicio && horaActual < fin;
  });

  // Si no hay programa actual, mostramos el primero
  const idx = programaActualIndex >= 0 ? programaActualIndex : 0;

  // Lógica para navegar con las flechas arriba/abajo (cambiar de canal)
  const cambiarCanalArribaAbajo = (direccion: 1 | -1) => {
    const indexActual = canalesSupabase.findIndex(c => c.nombre === canalActualId);
    let nuevoIndex = indexActual + direccion;
    if (nuevoIndex < 0) nuevoIndex = canalesSupabase.length - 1;
    if (nuevoIndex >= canalesSupabase.length) nuevoIndex = 0;
    onCambiarCanal(canalesSupabase[nuevoIndex].nombre);
  };

  // Auto-scroll al programa actual al abrir
  useEffect(() => {
    if (scrollRef.current && programaActualIndex >= 0) {
      const item = scrollRef.current.children[programaActualIndex] as HTMLElement;
      if (item) {
        scrollRef.current.scrollTo({
          left: item.offsetLeft - 100,
          behavior: "smooth"
        });
      }
    }
  }, [programaActualIndex, canalActualId]);

  if (!programasDelCanal.length) return null;

  return (
    <div className="epg-container">
      {/* Botones para cambiar de canal (Arriba/Abajo) */}
      <div className="epg-nav-channels">
        <button onClick={() => cambiarCanalArribaAbajo(-1)}>▲</button>
        <span>{canalActualId}</span>
        <button onClick={() => cambiarCanalArribaAbajo(1)}>▼</button>
      </div>

      {/* Grilla Horizontal */}
      <div className="epg-timeline" ref={scrollRef}>
        {programasDelCanal.map((prog, i) => {
          const esActual = i === idx;
          const inicio = new Date(prog.inicio);
          const fin = new Date(prog.fin);
          
          // Calcular porcentaje de progreso si es el actual
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
              onClick={() => {
                // Si hacen click en otro programa, podrías cambiar el canal o solo scrollear
                // Acá asumimos que solo se ve la info
              }}
            >
              <div className="epg-time">
                {inicio.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - 
                {fin.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
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
  );
}