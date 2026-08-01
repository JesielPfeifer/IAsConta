import { PrismaClient } from '@prisma/client';

const DEFAULT_INSTANCE = process.env.WHATSAPP_INSTANCE_NAME || 'contas';
const prismaSettings = new PrismaClient();

async function getBotUserId(): Promise<string> {
  // Find first user with a linked WhatsApp phone
  const wa = await prismaSettings.whatsAppUser.findFirst({
    where: { isActive: true },
  });
  if (wa) return wa.userId;
  
  // Fallback: first user
  const u = await prismaSettings.user.findFirst({ orderBy: { createdAt: 'asc' } });
  return u?.id || '';
}

async function getUserIdByInstance(instanceName: string): Promise<string> {
  const wa = await prismaSettings.whatsAppUser.findFirst({
    where: { instanceName, isActive: true },
  });
  if (wa) return wa.userId;
  // Fallback to bot user
  return getBotUserId();
}

async function getEvoApiKey(userId?: string): Promise<string> {
  if (!userId) return process.env.EVOLUTION_API_KEY || '';
  const { getSetting } = await import('../../api/services/settings.js');
  return getSetting(userId, 'evolutionApiKey', process.env.EVOLUTION_API_KEY);
}

async function getEvoApiUrl(userId?: string): Promise<string> {
  if (!userId) return process.env.EVOLUTION_API_URL || 'http://evolution-api:8080';
  const { getSetting } = await import('../../api/services/settings.js');
  return getSetting(userId, 'evolutionApiUrl', process.env.EVOLUTION_API_URL || 'http://evolution-api:8080');
}

async function headers(userId?: string): Promise<Record<string, string>> {
  const apiKey = await getEvoApiKey(userId ?? await getBotUserId());
  return {
    'Content-Type': 'application/json',
    apikey: apiKey,
  };
}

export async function startWhatsApp(): Promise<void> {
  const botUserId = await getBotUserId();
  const apiUrl = await getEvoApiUrl(botUserId);
  console.log('[whatsapp] Evolution API client ready');
  console.log(`[whatsapp] API URL: ${apiUrl}`);
  console.log(`[whatsapp] Default instance: ${DEFAULT_INSTANCE}`);
  
  // Refresh group cache for default instance (backward compat)
  refreshGroupCache(DEFAULT_INSTANCE).catch(() => {});
}

/**
 * Get or create an Evolution API instance for a user.
 * Returns the instance name.
 */
export async function ensureInstanceForUser(instanceName: string, userId: string): Promise<string> {
  const apiUrl = await getEvoApiUrl(userId);
  const h = await headers(userId);

  try {
    // Check if instance already exists
    const checkUrl = `${apiUrl}/instance/fetchInstances`;
    const checkRes = await fetch(checkUrl, { method: 'GET', headers: h });

    if (checkRes.ok) {
      const instances = await checkRes.json();
      const exists = Array.isArray(instances)
        ? instances.some((i: any) => i.instanceName === instanceName || i.name === instanceName)
        : false;
      if (exists) {
        console.log(`[whatsapp] Instance "${instanceName}" already exists`);
        return instanceName;
      }
    }

    // Create the instance
    const createUrl = `${apiUrl}/instance/create`;
    const createRes = await fetch(createUrl, {
      method: 'POST',
      headers: h,
      body: JSON.stringify({
        instanceName,
        token: instanceName,
        qrcode: true,
        integration: 'WHATSAPP-BAILEYS',
      }),
    });

    if (createRes.ok) {
      console.log(`[whatsapp] Instance "${instanceName}" created for user ${userId}`);
      return instanceName;
    } else {
      const err = await createRes.text();
      console.error(`[whatsapp] Failed to create instance "${instanceName}": ${err}`);
      throw new Error(`Failed to create WhatsApp instance: ${err}`);
    }
  } catch (err) {
    console.error('[whatsapp] ensureInstanceForUser error:', err);
    throw err;
  }
}

/**
 * Remove an instance from Evolution API (logout + delete)
 */
export async function removeInstance(instanceName: string, userId?: string): Promise<boolean> {
  try {
  const ownerId = userId ?? await getBotUserId();
    const apiUrl = await getEvoApiUrl(ownerId);
    const h = await headers(ownerId);

    // Logout first
    await fetch(`${apiUrl}/instance/logout/${instanceName}`, {
      method: 'DELETE',
      headers: h,
    }).catch(() => {});

    // Then delete
    const delRes = await fetch(`${apiUrl}/instance/delete/${instanceName}`, {
      method: 'DELETE',
      headers: h,
    });

    if (delRes.ok) {
      console.log(`[whatsapp] Instance "${instanceName}" removed`);
      return true;
    }
    const err = await delRes.text();
    console.error(`[whatsapp] Failed to delete instance "${instanceName}": ${err}`);
    return false;
  } catch (err) {
    console.error(`[whatsapp] removeInstance error for "${instanceName}":`, err);
    return false;
  }
}

export async function getQRCode(instanceName?: string, userId?: string): Promise<{ base64: string | null; connected: boolean }> {
  const name = instanceName || DEFAULT_INSTANCE;
  try {
    const state = await getConnectionState(name, userId);
    if (state === 'open') {
      return { base64: null, connected: true };
    }

    // Ensure instance exists (only for the default flow)
    if (!instanceName) {
      await ensureDefaultInstance(userId);
    }

    const apiUrl = await getEvoApiUrl(userId);
    const url = `${apiUrl}/instance/connect/${name}`;
    const res = await fetch(url, { method: 'GET', headers: await headers(userId) });

    if (!res.ok) {
      const err = await res.text();
      console.error(`[whatsapp] QRCode error for "${name}": ${res.status} ${err}`);
      return { base64: null, connected: false };
    }

    const data = await res.json();
    return {
      base64: data.base64 || null,
      connected: false,
    };
  } catch (err) {
    console.error(`[whatsapp] getQRCode error for "${name}":`, err);
    return { base64: null, connected: false };
  }
}

async function ensureDefaultInstance(userId?: string): Promise<void> {
  try {
    const apiUrl = await getEvoApiUrl(userId);
    const checkUrl = `${apiUrl}/instance/fetchInstances`;
    const checkRes = await fetch(checkUrl, { method: 'GET', headers: await headers(userId) });

    if (checkRes.ok) {
      const instances = await checkRes.json();
      const exists = Array.isArray(instances)
        ? instances.some((i: any) => i.instanceName === DEFAULT_INSTANCE || i.name === DEFAULT_INSTANCE)
        : false;
      if (exists) return;
    }

    const createUrl = `${apiUrl}/instance/create`;
    const createRes = await fetch(createUrl, {
      method: 'POST',
      headers: await headers(userId),
      body: JSON.stringify({
        instanceName: DEFAULT_INSTANCE,
        token: DEFAULT_INSTANCE,
        qrcode: true,
        integration: 'WHATSAPP-BAILEYS',
      }),
    });

    if (createRes.ok) {
      console.log(`[whatsapp] Default instance "${DEFAULT_INSTANCE}" created`);
    } else {
      const err = await createRes.text();
      console.error(`[whatsapp] Failed to create default instance: ${err}`);
    }
  } catch (err) {
    console.error('[whatsapp] ensureDefaultInstance error:', err);
  }
}

export async function getConnectionState(instanceName?: string, userId?: string): Promise<string> {
  const name = instanceName || DEFAULT_INSTANCE;
  try {
    const apiUrl = await getEvoApiUrl(userId);
    const url = `${apiUrl}/instance/connectionState/${name}`;
    const res = await fetch(url, { method: 'GET', headers: await headers(userId) });

    if (!res.ok) {
      return 'disconnected';
    }

    const data = await res.json();
    return data.instance?.state || data.state || 'disconnected';
  } catch {
    return 'disconnected';
  }
}

export async function disconnectInstance(instanceName?: string, userId?: string): Promise<boolean> {
  const name = instanceName || DEFAULT_INSTANCE;
  try {
    const apiUrl = await getEvoApiUrl(userId);
    const url = `${apiUrl}/instance/logout/${name}`;
    const res = await fetch(url, {
      method: 'DELETE',
      headers: await headers(userId),
    });
    return res.ok;
  } catch (err) {
    console.error(`[whatsapp] disconnect error for "${name}":`, err);
    return false;
  }
}

// Cache for group list — per-instance
const groupCacheMap = new Map<string, { groups: any[]; timestamp: number }>();
const GROUP_CACHE_TTL = 600_000; // 10 minutes

async function refreshGroupCache(instanceName?: string): Promise<void> {
  const name = instanceName || DEFAULT_INSTANCE;
  try {
    const botUserId = await getBotUserId();
    const apiUrl = await getEvoApiUrl(botUserId);
    const h = await headers(botUserId);
    const res = await fetch(`${apiUrl}/group/fetchAllGroups/${name}?getParticipants=false`, { method: 'GET', headers: h });
    if (res.ok) {
      const groups = await res.json();
      if (Array.isArray(groups)) {
        groupCacheMap.set(name, { groups, timestamp: Date.now() });
        console.log(`[whatsapp] Group cache loaded for "${name}": ${groups.length} groups`);
      }
    }
  } catch (err) {
    console.error(`[whatsapp] Failed to refresh group cache for "${name}":`, err);
  }
}

// No global interval — call refreshGroupCache per instance as needed

export async function findGroupByName(groupName: string, instanceName?: string, userId?: string): Promise<{ id: string; name: string } | null> {
  const name = instanceName || DEFAULT_INSTANCE;
  const ownerId = userId ?? await getUserIdByInstance(name);
  const apiUrl = await getEvoApiUrl(ownerId);
  const h = await headers(ownerId);
  
  // Use cache if available and fresh
  const cached = groupCacheMap.get(name);
  let groups: any[];
  if (cached && (Date.now() - cached.timestamp) < GROUP_CACHE_TTL) {
    groups = cached.groups;
  } else {
    const res = await fetch(`${apiUrl}/group/fetchAllGroups/${name}?getParticipants=false`, { method: 'GET', headers: h });
    if (!res.ok) return null;
    groups = await res.json();
    if (Array.isArray(groups)) {
      groupCacheMap.set(name, { groups, timestamp: Date.now() });
    }
  }
  const found = Array.isArray(groups) ? groups.find((g: any) =>
    g.subject?.toLowerCase().includes(groupName.toLowerCase()) ||
    g.name?.toLowerCase().includes(groupName.toLowerCase())
  ) : null;
  return found ? { id: found.id || found.jid, name: found.subject || found.name } : null;
}

export async function sendMessage(
  instanceName: string,
  to: string,
  text: string,
  userId?: string,
): Promise<boolean> {
  try {
    const ownerId = userId ?? await getUserIdByInstance(instanceName);
    const apiUrl = await getEvoApiUrl(ownerId);
    const url = `${apiUrl}/message/sendText/${instanceName || DEFAULT_INSTANCE}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: await headers(ownerId),
      body: JSON.stringify({ number: to, text }),
    });

    if (!response.ok) {
      const errBody = await response.text();
      console.error(`[whatsapp] Failed to send message: ${response.status} ${errBody}`);
      return false;
    }

    return true;
  } catch (err) {
    console.error('[whatsapp] sendMessage error:', err);
    return false;
  }
}
