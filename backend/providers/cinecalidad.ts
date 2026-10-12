import * as cheerio from "cheerio";
import { registerProvider, type MediaRequest, type Player } from "../providers";

const BASE_URL = "https://www.cinecalidad.my/pelicula/";

function slugify(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const SERVER_MAP: Record<string, { id: string; server: string }> = {
  OnlineFilemoon:   { id: "filemoon",   server: "Filemoon" },
  OnlineVoe:        { id: "voe",        server: "Voe" },
  OnlineDoodstream: { id: "doodstream", server: "Doodstream" },
};

async function resolverCinecalidad(media: MediaRequest): Promise<Player[]> {
  if (media.type !== "movie") return [];

  const slug = slugify(media.title);

  const candidatos = [
    `${slug}-online-descarga/`,
    ...(media.year ? [`${slug}-${media.year}-online-descarga/`] : []),
  ];

  for (const candidato of candidatos) {
    const url = new URL(candidato, BASE_URL).toString();

    const response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(15000),
    }).catch(() => null);

    if (!response || !response.ok) continue;

    const html = await response.text();
    const $ = cheerio.load(html);

    const panel = $("#panel_online");
    const linklist = panel.find("ul.linklist");
    if (!panel.length || !linklist.length) continue;

    const players: Player[] = [];

    linklist.find("a").each((_, el) => {
      const service = $(el).attr("service");
      const data = $(el).attr("data");
      if (!service || !data) return;

      const info = SERVER_MAP[service];
      if (!info) return;

      let embedUrl = "";
      if (service === "OnlineFilemoon")   embedUrl = `https://bysedikamoum.com/e/${data}`;
      if (service === "OnlineVoe")        embedUrl = `https://voe.sx/e/${data}`;
      if (service === "OnlineDoodstream") embedUrl = `https://playmogo.com/e/${data}`;

      if (embedUrl) {
        players.push({
          provider: `cinecalidad-${info.id}`,
          server: info.server,
          embedUrl,
        });
      }
    });

    return players; // si encontramos la ficha, devolvemos lo que haya
  }

  return [];
}

// Se registra PRIMERO para que tenga prioridad
registerProvider("cinecalidad", resolverCinecalidad, true);