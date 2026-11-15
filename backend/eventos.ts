import type { Express, Request, Response, NextFunction } from "express";
import { supabaseAdmin } from "./supabase.js";
import { requireAuth, type AuthedRequest } from "./middleware/requireAuth.js";

export function registerEventosRoutes(app: Express): void {
  /** GET /api/eventos → lista de eventos deportivos (leídos de Supabase). */
  app.get("/api/eventos", requireAuth, async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const { data, error } = await supabaseAdmin
        .from("eventos_deportivos")
        .select("id, external_id, tipo_evento, titulo, fecha, hora, liga, estado, equipos, logo_competicion, servidores, updated_at")
        .order("fecha", { ascending: true })
        .order("hora", { ascending: true });

      if (error) throw error;
      res.json(data ?? []);
    } catch (e) {
      next(e);
    }
  });

  /** GET /api/eventos/:id → un evento específico. */
  app.get("/api/eventos/:id", requireAuth, async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ detail: "ID inválido." });
      }

      const { data, error } = await supabaseAdmin
        .from("eventos_deportivos")
        .select("*")
        .eq("id", id)
        .maybeSingle();

      if (error) throw error;
      if (!data) return res.status(404).json({ detail: "Evento no encontrado." });

      res.json(data);
    } catch (e) {
      next(e);
    }
  });
}