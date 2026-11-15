import type { Express, Request, Response } from "express";
import { XMLParser } from "fast-xml-parser";

const EPG_URL = "https://www.open-epg.com/files/argentina3.xml";
const CACHE_DURATION = 1000 * 60 * 60; // 1 hora

let epgCache: any = null;
let epgCacheTime = 0;

export function registerEpgRoutes(app: Express): void {
  app.get("/api/epg", async (_req: Request, res: Response) => {
    try {
      const now = Date.now();
      if (epgCache && now - epgCacheTime < CACHE_DURATION) {
        return res.json(epgCache);
      }

      const response = await fetch(EPG_URL);
      if (!response.ok) throw new Error("Error al descargar la guía");

      const xmlData = await response.text();
      const parser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: "@_",
      });

      const jsonObj = parser.parse(xmlData);

      const canalesEPG = (jsonObj.tv.channel || []).map((c: any) => ({
        id: c["@_id"],
        nombre: Array.isArray(c["display-name"])
          ? c["display-name"][0]
          : c["display-name"],
      }));

      const programasRaw = Array.isArray(jsonObj.tv.programme)
        ? jsonObj.tv.programme
        : [jsonObj.tv.programme];

      const programasEPG = programasRaw.map((p: any) => ({
        canalId: p["@_channel"],
        inicio: p["@_start"],
        fin: p["@_stop"],
        titulo: typeof p.title === "object" ? p.title["#text"] : p.title,
        descripcion: p.desc
          ? typeof p.desc === "object"
            ? p.desc["#text"]
            : p.desc
          : null,
      }));

      const resultado = { canales: canalesEPG, programas: programasEPG };
      epgCache = resultado;
      epgCacheTime = now;

      res.json(resultado);
    } catch (error) {
      console.error("Error EPG:", error);
      res.status(500).json({ error: "No se pudo cargar la guía EPG." });
    }
  });
}