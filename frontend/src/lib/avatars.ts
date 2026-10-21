/** Avatares de perfil: dibujos propios (emoji sobre degradé), sin imágenes externas. Las claves deben coincidir con server/src/profiles.ts. */
export const AVATARS: Record<string, { emoji: string; from: string; to: string; label: string }> = {
  rex: { emoji: "🦖", from: "#15803d", to: "#4ade80", label: "Dinosaurio" },
  panda: { emoji: "🐼", from: "#475569", to: "#94a3b8", label: "Panda" },
  zorro: { emoji: "🦊", from: "#c2410c", to: "#fdba74", label: "Zorro" },
  cohete: { emoji: "🚀", from: "#4338ca", to: "#818cf8", label: "Cohete" },
  fantasma: { emoji: "👻", from: "#6d28d9", to: "#c4b5fd", label: "Fantasma" },
  pulpo: { emoji: "🐙", from: "#be185d", to: "#f9a8d4", label: "Pulpo" },
  unicornio: { emoji: "🦄", from: "#0e7490", to: "#a5f3fc", label: "Unicornio" },
  robot: { emoji: "🤖", from: "#334155", to: "#7c8db5", label: "Robot" },
};
export const AVATAR_KEYS = Object.keys(AVATARS);
