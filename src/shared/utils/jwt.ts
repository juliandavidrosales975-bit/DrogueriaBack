import jwt, { Secret, SignOptions } from 'jsonwebtoken';
import { env } from '@config/env';

export type TokenPayload = {
  sub: string;
  email: string;
  role: string;
};

function signToken(payload: TokenPayload, secret: Secret, expiresIn: string): string {
  const options: SignOptions = { expiresIn: expiresIn as SignOptions['expiresIn'] };
  return jwt.sign(payload, secret, options);
}

export function signAccessToken(payload: TokenPayload): string {
  return signToken(payload, env.jwt.secret, env.jwt.accessExpiration);
}

export function signRefreshToken(payload: TokenPayload): string {
  return signToken(payload, env.jwt.secret, env.jwt.refreshExpiration);
}

export function verifyAccessToken(token: string): TokenPayload {
  return jwt.verify(token, env.jwt.secret) as TokenPayload;
}

export function verifyRefreshToken(token: string): TokenPayload {
  return jwt.verify(token, env.jwt.secret) as TokenPayload;
}
