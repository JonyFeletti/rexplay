// backend/middleware/requireAuth.ts
import type { Request, Response, NextFunction } from "express";
import { supabaseAdmin } from "../supabase.js";

export interface AuthedRequest extends Request {
  userId?: string;
  userEmail?: string;
}

export async function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ detail: "Iniciá sesión para continuar." });
  }

  const token = header.slice(7);
  const { data, error } = await supabaseAdmin.auth.getUser(token);

  if (error || !data.user) {
    return res.status(401).json({ detail: "Sesión inválida o expirada." });
  }

  req.userId = data.user.id;
  req.userEmail = data.user.email ?? undefined;
  next();
}