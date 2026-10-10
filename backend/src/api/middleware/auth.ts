import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        name: string;
        salary: number | null;
        partnerId: string | null;
      };
    }
  }
}

const JWT_SECRET = process.env.JWT_SECRET as string;
if (!JWT_SECRET) throw new Error("JWT_SECRET env var is required");

/** Cookie httpOnly da sessão web. */
export const SESSION_COOKIE = "token";
/** Sessão de 30 minutos, deslizante: renova a cada requisição autenticada. */
export const SESSION_TTL = "30m";
export const SESSION_TTL_MS = 30 * 60 * 1000;

function sessionCookieOptions(req: Request) {
  const proto = (req.headers["x-forwarded-proto"] as string | undefined) || req.protocol;
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: proto === "https",
    path: "/",
    maxAge: SESSION_TTL_MS,
  };
}

export function setSessionCookie(req: Request, res: Response, token: string): void {
  res.cookie(SESSION_COOKIE, token, sessionCookieOptions(req));
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { path: "/" });
}

function readCookie(req: Request, name: string): string | null {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  const bearer = header && header.startsWith("Bearer ") ? header.slice(7) : null;
  const cookieToken = readCookie(req, SESSION_COOKIE);
  const token = bearer || cookieToken;

  if (!token) {
    res.status(401).json({ error: "Token não fornecido" });
    return;
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET) as {
      id: string;
      email: string;
      name: string;
      salary: number | null;
      partnerId: string | null;
    };

    req.user = {
      id: payload.id,
      email: payload.email,
      name: payload.name,
      salary: payload.salary,
      partnerId: payload.partnerId,
    };

    // Sessão web deslizante: renova o cookie a cada requisição autenticada
    // (expira após 30 minutos de inatividade). Bearer (bots/scripts) não altera.
    if (!bearer && cookieToken) {
      const claims = {
        id: payload.id,
        email: payload.email,
        name: payload.name,
        salary: payload.salary,
        partnerId: payload.partnerId,
      };
      setSessionCookie(req, res, jwt.sign(claims, JWT_SECRET, { expiresIn: SESSION_TTL }));
    }

    next();
  } catch {
    res.status(401).json({ error: "Token inválido ou expirado" });
  }
}
