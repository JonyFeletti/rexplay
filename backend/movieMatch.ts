
export interface Movie {
  id: number;
  title?: string;
  original_title?: string;
  release_date?: string;
  [key: string]: unknown;
}

function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function similarity(a: string, b: string): number {
  const first = normalize(a);
  const second = normalize(b);

  if (!first || !second) return 0;
  if (first === second) return 1;

  const wordsA = new Set(first.split(/\s+/));
  const wordsB = new Set(second.split(/\s+/));

  const intersection = [...wordsA].filter(word => wordsB.has(word)).length;
  const wordScore =
    intersection / new Set([...wordsA, ...wordsB]).size;

  if (first.includes(second) || second.includes(first)) {
    return Math.max(wordScore, 0.85);
  }

  return wordScore;
}

export function findBestMovieMatch(
  title: string,
  year: number | string,
  movies: Movie[]
): Movie | null {
  const requestedYear = String(year).slice(0, 4);

  const ranked = movies.map(movie => {
    const candidateTitle = movie.title || movie.original_title || "";
    const candidateYear = movie.release_date?.slice(0, 4) || "";

    let score = similarity(title, candidateTitle);

    if (requestedYear && candidateYear) {
      score += requestedYear === candidateYear ? 0.25 : -0.15;
    }

    return { movie, score };
  });

  ranked.sort((a, b) => b.score - a.score);

  if (!ranked.length || ranked[0].score < 0.45) {
    return null;
  }

  return ranked[0].movie;
}
