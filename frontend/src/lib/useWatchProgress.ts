import { useEffect, useRef, type RefObject } from "react";
import { api, getActiveProfileId } from "./api";

export type WatchMeta = {
  mediaType: "movie" | "tv";
  tmdbId: number;
  season: number;
  episode: number;
  title: string;
  episodeTitle?: string | null;
  posterPath?: string | null;
  backdropPath?: string | null;
  durationSeconds: number;
};

const SAVE_EVERY_MS = 15_000;

const asSeconds = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : null;
};

export function extractPlayerProgress(raw: unknown): { time: number; duration: number | null } | null {
  let v: unknown = raw;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return null;
    }
  }
  for (let depth = 0; depth < 3 && v && typeof v === "object"; depth++) {
    const o = v as Record<string, unknown>;
    const time = asSeconds(o.currentTime ?? o.current_time ?? o.position);
    if (time !== null) return { time, duration: asSeconds(o.duration ?? o.total) };
    v = o.data ?? o.payload ?? o.detail ?? null;
  }
  return null;
}

export function useWatchProgress(
  meta: WatchMeta | null,
  startSeconds: number,
  iframeRef: RefObject<HTMLIFrameElement | null>,
  playerOrigin: string
): void {
  const latest = useRef({ meta, startSeconds });
  useEffect(() => {
    latest.current = { meta, startSeconds };
  });

  const key = meta ? `${meta.mediaType}:${meta.tmdbId}:${meta.season}:${meta.episode}` : "";

  useEffect(() => {
    const first = latest.current.meta;
    if (!key || !first) return;
    if (!getActiveProfileId()) return; // sin perfil activo no se guarda

    let position = latest.current.startSeconds;
    let duration = first.durationSeconds;
    let exact = false;
    let last = Date.now();

    const tick = () => {
      const now = Date.now();
      const dt = Math.min(5, (now - last) / 1000);
      last = now;
      if (!exact && document.visibilityState === "visible") position += dt;
    };

    const send = () => {
      const m = latest.current.meta ?? first;
      if (position < 1) return;
      const pos = duration > 0 ? Math.min(position, duration) : position;
      api("/api/progress", {
        method: "PUT",
        body: {
          media_type: m.mediaType,
          tmdb_id: m.tmdbId,
          season: m.season,
          episode: m.episode,
          title: m.title,
          episode_title: m.episodeTitle ?? null,
          poster_path: m.posterPath ?? null,
          backdrop_path: m.backdropPath ?? null,
          position_seconds: Math.floor(pos),
          duration_seconds: Math.floor(duration),
          source: exact ? "player" : "estimated",
        },
      }).catch(() => undefined);
    };

    const onMessage = (ev: MessageEvent) => {
      if (ev.origin !== playerOrigin) return;
      if (iframeRef.current && ev.source !== iframeRef.current.contentWindow) return;
      const p = extractPlayerProgress(ev.data);
      if (!p) return;
      exact = true;
      position = p.time;
      if (p.duration && p.duration > 0) duration = p.duration;
      last = Date.now();
    };
    const onVisibility = () => {
      tick();
      if (document.visibilityState === "hidden") send();
    };

    const ticker = setInterval(tick, 1000);
    const saver = setInterval(() => {
      tick();
      send();
    }, SAVE_EVERY_MS);
    window.addEventListener("message", onMessage);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", send);

    return () => {
      clearInterval(ticker);
      clearInterval(saver);
      window.removeEventListener("message", onMessage);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", send);
      tick();
      send();
    };
  }, [key, playerOrigin, iframeRef]);
}