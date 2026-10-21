import { useEffect, useState, type ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../auth/auth";
import { api, getActiveProfileId, type Me } from "../lib/api";

export default function RequireSubscription({
  children,
  needProfile = true,
}: {
  children: ReactNode;
  needProfile?: boolean;
}) {
  const { user, loading: authLoading } = useAuth();
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
    useEffect(() => {
  if (authLoading) return;
  if (!user) {
    setLoading(false);
    return;
  }
  if (me) {
    // Ya tenemos los datos, no volver a pedir
    setLoading(false);
    return;
  }
  api<Me>("/api/me")
    .then(setMe)
    .catch(() => setMe(null))
    .finally(() => setLoading(false));
}, [user, authLoading, me]);

  if (authLoading || loading) return <div className="bill-center">Cargando…</div>;
  if (!user) return <Navigate to="/ingresar" replace />;
  if (!me?.subscription?.has_access) return <Navigate to="/suscribite" replace />;
  if (needProfile && !getActiveProfileId() && (me?.profiles?.length ?? 0) > 0) {
    return <Navigate to="/perfiles" replace />;
  }

  return <>{children}</>;
}