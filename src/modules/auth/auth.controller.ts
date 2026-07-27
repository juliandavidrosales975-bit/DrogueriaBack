import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { asyncHandler } from '@shared/middlewares/asyncHandler';
import { ApiError } from '@shared/errors/ApiError';

export class AuthController {
  private authService = new AuthService();

  login = asyncHandler(async (req: Request, res: Response) => {
    const { email, password } = req.body;
    const ipAddress = req.ip;
    const userAgent = req.headers['user-agent'];

    const result = await this.authService.login(email, password, ipAddress, userAgent);

    res.json({
      success: true,
      message: 'Login exitoso',
      data: result,
    });
  });

  logout = asyncHandler(async (req: Request, res: Response) => {
    const refreshToken = req.body.refreshToken || req.cookies?.refreshToken;
    if (refreshToken) {
      await this.authService.logout(refreshToken);
    }
    res.clearCookie('refreshToken');
    res.json({
      success: true,
      message: 'Logout exitoso',
    });
  });

  refreshToken = asyncHandler(async (req: Request, res: Response) => {
    const refreshToken = req.body.refreshToken || req.cookies?.refreshToken;
    if (!refreshToken) {
      throw ApiError.unauthorized('Refresh token no proporcionado');
    }

    const result = await this.authService.refresh(refreshToken);

    res.json({
      success: true,
      message: 'Token renovado',
      data: result,
    });
  });

  me = asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) {
      throw ApiError.unauthorized('No autenticado');
    }
    const user = await this.authService.getMe(req.user.id);
    res.json({
      success: true,
      data: user,
    });
  });
}
