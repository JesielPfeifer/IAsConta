import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

let cachedUserId: string | null = null;
let cachedSettings: Record<string, string | null> = {};
let cacheTime = 0;

async function loadSettings(userId: string): Promise<Record<string, string | null>> {
  const now = Date.now();
  if (cachedUserId === userId && Object.keys(cachedSettings).length > 0 && now - cacheTime < 60_000) {
    return cachedSettings;
  }

  const row = await prisma.userSettings.findUnique({ where: { userId } });
  cachedUserId = userId;
  cachedSettings = row ? { ...row } as any : {};
  cacheTime = now;
  return cachedSettings;
}

export function clearSettingsCache() {
  cachedUserId = null;
  cachedSettings = {};
  cacheTime = 0;
}

export async function getSetting(userId: string, key: string, envFallback?: string): Promise<string> {
  const settings = await loadSettings(userId);
  if (settings[key]) return settings[key]!;
  return envFallback || "";
}

export async function getSettings(userId: string): Promise<Record<string, string | null>> {
  return loadSettings(userId);
}
