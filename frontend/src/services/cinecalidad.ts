
export interface Reproductores {
  voe: string | null;
  doodstream: string | null;
  trailer: string | null;
}

export async function buscarReproductores(
  titulo: string,
  anio: string
) {
  const params = new URLSearchParams({
    title: titulo,
    year: anio,
  });

  const response = await fetch(
    `/api/pelicula?${params.toString()}`
  );

  const resultado = await response.json();

  if (!response.ok) {
    throw new Error(
      resultado.error || "No se encontró la película"
    );
  }

  return resultado as {
    encontrado: boolean;
    url: string;
    reproductores: Reproductores;
  };
}
