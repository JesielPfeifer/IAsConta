import { Request, Response, NextFunction } from "express";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();
const MAX_ATTEMPTS = 5;
const LOCK_DURATION_MS = 15 * 60 * 1000; // 15 minutes

// Rate limiting store (in-memory, resets on restart)
const rateStore = new Map<string, { count: number; resetAt: number }>();
const RATE_WINDOW_MS = 60 * 1000; // 1 minute window
const MAX_REQUESTS = 20; // max requests per window

export function rateLimitMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  const key = `rate:${ip}:${req.path}`;

  const now = Date.now();
  const entry = rateStore.get(key);

  if (!entry || now > entry.resetAt) {
    rateStore.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
    next();
    return;
  }

  entry.count++;
  if (entry.count > MAX_REQUESTS) {
    res.status(429).json({ error: "Muitas requisições. Tente novamente em breve." });
    return;
  }

  next();
}

// CORS: restrict to known origins
export function corsOptions() {
  const allowedOrigins = [
    "http://localhost:3000",
    "http://localhost:3002",
    "http://localhost:5173",
    "http://127.0.0.1:3002",
    "https://iasconta.jesielpfeifer.com",
    "http://iasconta.jesielpfeifer.com",
    "https://gtqlcw.easypanel.host",
  ];

  return {
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
      // Allow same-origin requests (no origin header) and known origins
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Origem não permitida"));
      }
    },
    credentials: true,
  };
}

// Account lockout after failed attempts
export async function checkAccountLock(email: string): Promise<{
  locked: boolean;
  message?: string;
  remainingAttempts?: number;
}> {
  const user = await prisma.user.findUnique({
    where: { email },
    include: { settings: true },
  });

  if (!user) {
    return { locked: false, remainingAttempts: MAX_ATTEMPTS };
  }

  const settings = user.settings;
  if (!settings) return { locked: false, remainingAttempts: MAX_ATTEMPTS };

  // Check if locked
  if (settings.lockedUntil && new Date(settings.lockedUntil) > new Date()) {
    const remaining = Math.ceil(
      (new Date(settings.lockedUntil).getTime() - Date.now()) / 60000
    );
    return {
      locked: true,
      message: `Conta bloqueada. Tente novamente em ${remaining} minuto(s).`,
    };
  }

  // Auto-reset lock if expired
  if (settings.lockedUntil && new Date(settings.lockedUntil) <= new Date()) {
    await prisma.userSettings.update({
      where: { userId: user.id },
      data: { failedLoginAttempts: 0, lockedUntil: null },
    });
  }

  const remaining = MAX_ATTEMPTS - (settings.failedLoginAttempts || 0);
  return { locked: false, remainingAttempts: remaining };
}

export async function recordFailedAttempt(email: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { email },
    include: { settings: true },
  });
  if (!user) return false;

  const attempts = (user.settings?.failedLoginAttempts || 0) + 1;

  if (attempts >= MAX_ATTEMPTS) {
    await prisma.userSettings.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        failedLoginAttempts: attempts,
        lockedUntil: new Date(Date.now() + LOCK_DURATION_MS),
      },
      update: {
        failedLoginAttempts: attempts,
        lockedUntil: new Date(Date.now() + LOCK_DURATION_MS),
      },
    });
    return true; // locked
  }

  await prisma.userSettings.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      failedLoginAttempts: attempts,
    },
    update: {
      failedLoginAttempts: attempts,
    },
  });

  return false;
}

export async function resetFailedAttempts(email: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return;

  await prisma.userSettings.upsert({
    where: { userId: user.id },
    create: { userId: user.id, failedLoginAttempts: 0, lockedUntil: null },
    update: { failedLoginAttempts: 0, lockedUntil: null },
  });
}
