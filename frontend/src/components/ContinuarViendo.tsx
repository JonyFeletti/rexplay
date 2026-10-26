import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, getActiveProfileId, type ContinueItem } from "../lib/api";

const IMG = "https://image.tmdb.org/t/p/";

const minutes = (seconds: number) => Math.max(1, Math.round(seconds / 60));

function progressLabel(i: ContinueItem): string {
  if (i.source === "player" && i.remaining_seconds !== null) return `${minutes(i.remaining_seconds)} min restantes`;
  return `Viste ~${minutes(i.position_seconds)} min`;
}

export default function ContinuarViendo() {
  const navigate = useNavigate();
  const [items, setItems] = useState<ContinueItem[]>([]);
  const rowRef = useRef<HTMLDivElement>(null);
  const profileId = getActiveProfileId();

  useEffect(() => {
    if (!profileId) return;
    let alive = true;
    api<ContinueItem[]>("/api/continue")
      .then((d) => alive && setItems(d))
      .catch(() => alive && setItems([]));
    return () => {
      alive = false;
    };
  }, [profileId]);

  if (items.length === 0) return null;

  const scroll = (dir: 1 | -1) =>
    rowRef.current?.scrollBy({ left: dir * rowRef.current.clientWidth * 0.8, behavior: "smooth" });

  async function remove(i: ContinueItem) {
    setItems((list) => list.filter((x) => !(x.media_type === i.media_type && x.tmdb_id === i.tmdb_id)));
    await api(`/api/progress/${i.media_type}/${i.tmdb_id}`, { method: "DELETE" }).catch(() => undefined);
  }

  return (
    <section className="cw" aria-labelledby="cw-title">
      <h2 id="cw-title">Continuar viendo</h2>
      <div className="cw-wrap">
        <button className="cw-arrow cw-prev" onClick={() => scroll(-1)} aria-label="Anteriores">‹</button>
        <div className="cw-row" ref={rowRef}>
          {items.map((i) => {
            const img = i.backdrop_path
              ? `${IMG}w780${i.backdrop_path}`
              : i.poster_path
              ? `${IMG}w500${i.poster_path}`
              : null;
            return (
              <div className="cw-item" key={`${i.media_type}:${i.tmdb_id}`}>
                <button
                  className="cw-card"
                  onClick={() => {
                    if (i.media_type === "movie") {
                      navigate(`/ver/movie/${i.tmdb_id}`);
                    } else {
                      navigate(`/ver/tv/${i.tmdb_id}/${i.season}/${i.episode}`);
                    }
                  }}
                  aria-label={`Continuar ${i.title}. ${progressLabel(i)}`}
                >
                  <span className="cw-thumb">
                    {img ? <img src={img} alt="" loading="lazy" /> : <span className="cw-noimg">{i.title}</span>}
                    {i.ratio !== null && (
                      <span className="cw-bar" aria-hidden="true">
                        <span style={{ width: `${Math.round(i.ratio * 100)}%` }} />
                      </span>
                    )}
                  </span>
                </button>
                <button
                  className="cw-remove"
                  onClick={() => remove(i)}
                  aria-label={`Quitar ${i.title} de Continuar viendo`}
                  title="Quitar de Continuar viendo"
                >
                  ✕
                </button>
                <p className="cw-time">{progressLabel(i)}</p>
                <p className="cw-title">{i.title}</p>
                {i.media_type === "tv" && (
                  <p className="cw-ep">
                    T{i.season}:E{i.episode}
                    {i.episode_title ? ` ${i.episode_title}` : ""}
                  </p>
                )}
              </div>
            );
          })}
        </div>
        <button className="cw-arrow cw-next" onClick={() => scroll(1)} aria-label="Siguientes">›</button>
      </div>
    </section>
  );
}