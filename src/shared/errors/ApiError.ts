export class ApiError extends Error {
  constructor(
    public statusCode: number,
    public message: string,
    public isOperational: boolean = true,
    public errors?: any[]
  ) {
    super(message);
    Object.setPrototypeOf(this, ApiError.prototype);
  }

  static badRequest(message: string, errors?: any[]): ApiError {
    return new ApiError(400, message, true, errors);
  }

  static unauthorized(message: string = 'No autorizado'): ApiError {
    return new ApiError(401, message);
  }

  static forbidden(message: string = 'Acceso denegado'): ApiError {
    return new ApiError(403, message);
  }

  static notFound(message: string = 'Recurso no encontrado'): ApiError {
    return new ApiError(404, message);
  }

  static conflict(message: string): ApiError {
    return new ApiError(409, message);
  }

  static internal(message: string = 'Error interno del servidor'): ApiError {
    return new ApiError(500, message, false);
  }
}
