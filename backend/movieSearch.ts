
import stringSimilarity from "string-similarity";

export interface PeliculaTMDB {
  title: string;
  release_date: string;
}

export interface ResultadoBusqueda {
  titulo: string;
  anio: string | null;
  url: string;
}

function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function compararPeliculas(
  pelicula: PeliculaTMDB,
  resultados: ResultadoBusqueda[]
): ResultadoBusqueda | null {
  const tituloBuscado = normalizar(pelicula.title);
  const anioBuscado = pelicula.release_date?.slice(0, 4);

  let mejorResultado: ResultadoBusqueda | null = null;
  let mejorPuntuacion = 0;

  for (const resultado of resultados) {
    const tituloResultado = normalizar(resultado.titulo);
    const similitud = stringSimilarity.compareTwoStrings(
      tituloBuscado,
      tituloResultado
    );

    const mismoAnio =
      Boolean(anioBuscado) && resultado.anio === anioBuscado;

    const puntuacion = similitud + (mismoAnio ? 0.25 : 0);

    if (puntuacion > mejorPuntuacion) {
      mejorPuntuacion = puntuacion;
      mejorResultado = resultado;
    }
  }

  // Evita devolver coincidencias demasiado diferentes.
  return mejorPuntuacion >= 0.65 ? mejorResultado : null;
}
