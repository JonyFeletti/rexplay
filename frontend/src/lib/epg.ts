export function encontrarCanalEPG(nombreSupabase: string, canalesEPG: any[]) {
  if (!canalesEPG) return null;
  
  // Normalizamos: minúsculas, sin acentos, sin "hd", sin ".ar"
  const normalizar = (str: string) => str.toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/hd/g, "")
    .replace(/\.ar/g, "")
    .replace(/[^a-z0-9]/g, "")
    .trim();

  const target = normalizar(nombreSupabase);

  // Buscamos coincidencia exacta o parcial
  return canalesEPG.find(c => {
    const nombreEPG = normalizar(c.nombre);
    return nombreEPG === target || nombreEPG.includes(target) || target.includes(nombreEPG);
  });
}