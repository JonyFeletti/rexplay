/** Error con código HTTP; el manejador de errores de Express lo convierte en { detail } para el frontend. */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
