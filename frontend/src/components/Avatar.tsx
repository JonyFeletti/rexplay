import { AVATARS } from "../lib/avatars";

/** Círculo con el avatar del perfil. `size` en píxeles. */
export default function Avatar({ avatar, size = 48 }: { avatar: string; size?: number }) {
  const a = AVATARS[avatar] ?? AVATARS.rex;
  return (
    <span
      className="avatar"
      role="img"
      aria-label={a.label}
      style={{ width: size, height: size, fontSize: size * 0.52, background: `linear-gradient(135deg, ${a.from}, ${a.to})` }}
    >
      {a.emoji}
    </span>
  );
}
