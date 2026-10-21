import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import Avatar from "./Avatar";
import { api, getActiveProfileId, type Me, type Profile } from "../lib/api";

export default function ProfileChip() {
  const [profile, setProfile] = useState<Profile | null>(null);

  useEffect(() => {
    const id = getActiveProfileId();
    if (!id) return;
    api<Me>("/api/me")
      .then((me) => setProfile(me.profiles.find((p) => p.id === id) ?? null))
      .catch(() => setProfile(null));
  }, []);

  if (!profile) return null;
  return (
    <Link to="/perfiles" className="profile-chip" title="Cambiar de perfil" aria-label={`Perfil ${profile.name}. Cambiar de perfil`}>
      <Avatar avatar={profile.avatar} size={34} />
      <span className="profile-chip-name">{profile.name}</span>
    </Link>
  );
}