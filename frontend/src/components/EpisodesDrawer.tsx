import type { Episode } from "../types/episode";

export default function EpisodesDrawer({
  open,
  onClose,
  seasons,
  currentSeason,
  onSeasonChange,
  episodes,
  currentEpisode,
  onEpisodeClick,
}: {
  open: boolean;
  onClose: () => void;
  seasons: { id: number; name: string; season_number: number }[];
  currentSeason: number | null;
  onSeasonChange: (season: number) => void;
  episodes: Episode[];
  currentEpisode: number | null;
  onEpisodeClick: (episodeNumber: number) => void;
}) {
  return (
    <div className={`episodes-drawer ${open ? "open" : ""}`}>
      <div className="episodes-drawer-header">
        <h2>Episodios</h2>
        <button className="episodes-drawer-close" onClick={onClose} aria-label="Cerrar">
          ✕
        </button>
      </div>

      <div className="episodes-drawer-season">
        <label htmlFor="season-select">Temporada</label>
        <select
          id="season-select"
          value={currentSeason ?? ""}
          onChange={(e) => onSeasonChange(Number(e.target.value))}
        >
          {seasons
            .filter((s) => s.season_number >= 0)
            .map((s) => (
              <option key={s.id} value={s.season_number}>
                {s.name}
              </option>
            ))}
        </select>
      </div>

      <div className="episodes-drawer-list">
        {episodes.map((ep) => (
          <button
            key={ep.id}
            className={`episode-card ${ep.episode_number === currentEpisode ? "active" : ""}`}
            onClick={() => onEpisodeClick(ep.episode_number)}
          >
            <div className="episode-card-info">
              <span className="episode-card-label">E{ep.episode_number}</span>
              <span className="episode-card-title">{ep.name || `Episodio ${ep.episode_number}`}</span>
            </div>
            {ep.episode_number === currentEpisode && (
              <span className="episode-card-playing">▶ Reproduciendo</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}