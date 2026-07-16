import { PrismaClient } from '@prisma/client';

const INSTANCE_NAME = process.env.WHATSAPP_INSTANCE_NAME || 'contas';
const prismaSettings = new PrismaClient();

async function getBotUserId(): Promise<string> {
  const email = process.env.BOT_DEFAULT_EMAIL || '';
  if (!email) return '';
  const u = await prismaSettings.user.findUnique({ where: { email } });
  return u?.id || '';
}

async function getEvoApiKey(): Promise<string> {
  const botUserId = await getBotUserId();
  if (!botUserId) return process.env.EVOLUTION_API_KEY || '';
  const { getSetting } = await import('../../api/services/settings.js');
  return getSetting(botUserId, 'evolutionApiKey', process.env.EVOLUTION_API_KEY);
}

async function getEvoApiUrl(): Promise<string> {
  const botUserId = await getBotUserId();
  if (!botUserId) return process.env.EVOLUTION_API_URL || 'http://evolution-api:8080';
  const { getSetting } = await import('../../api/services/settings.js');
  return getSetting(botUserId, 'evolutionApiUrl', process.env.EVOLUTION_API_URL || 'http://evolution-api:8080');
}

async function headers(): Promise<Record<string, string>> {
  const apiKey = await getEvoApiKey();
  return {
    'Content-Type': 'application/json',
    apikey: apiKey,
  };
}

export async function startWhatsApp(): Promise<void> {
  const apiUrl = await getEvoApiUrl();
  console.log('[whatsapp] Evolution API client ready');
  console.log(`[whatsapp] API URL: ${apiUrl}`);
  console.log(`[whatsapp] Instance: ${INSTANCE_NAME}`);
}

export async function getQRCode(): Promise<{ base64: string | null; connected: boolean }> {
  try {
    const state = await getConnectionState();
    if (state === 'open') {
      return { base64: null, connected: true };
    }

    await ensureInstance();

    const apiUrl = await getEvoApiUrl();
    const url = `${apiUrl}/instance/connect/${INSTANCE_NAME}`;
    const res = await fetch(url, { method: 'GET', headers: await headers() });

    if (!res.ok) {
      const err = await res.text();
      console.error(`[whatsapp] QRCode error: ${res.status} ${err}`);
      return { base64: null, connected: false };
    }

    const data = await res.json();
    return {
      base64: data.base64 || null,
      connected: false,
    };
  } catch (err) {
    console.error('[whatsapp] getQRCode error:', err);
    return { base64: null, connected: false };
  }
}

async function ensureInstance(): Promise<void> {
  try {
    const apiUrl = await getEvoApiUrl();
    const checkUrl = `${apiUrl}/instance/fetchInstances`;
    const checkRes = await fetch(checkUrl, { method: 'GET', headers: await headers() });

    if (checkRes.ok) {
      const instances = await checkRes.json();
      const exists = Array.isArray(instances)
        ? instances.some((i: any) => i.instanceName === INSTANCE_NAME || i.name === INSTANCE_NAME)
        : false;
      if (exists) return;
    }

    const createUrl = `${apiUrl}/instance/create`;
    const createRes = await fetch(createUrl, {
      method: 'POST',
      headers: await headers(),
      body: JSON.stringify({
        instanceName: INSTANCE_NAME,
        token: INSTANCE_NAME,
        qrcode: true,
        integration: 'WHATSAPP-BAILEYS',
      }),
    });

    if (createRes.ok) {
      console.log(`[whatsapp] Instance "${INSTANCE_NAME}" created`);
    } else {
      const err = await createRes.text();
      console.error(`[whatsapp] Failed to create instance: ${err}`);
    }
  } catch (err) {
    console.error('[whatsapp] ensureInstance error:', err);
  }
}

export async function getConnectionState(): Promise<string> {
  try {
    const apiUrl = await getEvoApiUrl();
    const url = `${apiUrl}/instance/connectionState/${INSTANCE_NAME}`;
    const res = await fetch(url, { method: 'GET', headers: await headers() });

    if (!res.ok) {
      return 'disconnected';
    }

    const data = await res.json();
    return data.instance?.state || data.state || 'disconnected';
  } catch {
    return 'disconnected';
  }
}

export async function disconnectInstance(): Promise<boolean> {
  try {
    const apiUrl = await getEvoApiUrl();
    const url = `${apiUrl}/instance/logout/${INSTANCE_NAME}`;
    const res = await fetch(url, {
      method: 'DELETE',
      headers: await headers(),
    });
    return res.ok;
  } catch (err) {
    console.error('[whatsapp] disconnect error:', err);
    return false;
  }
}

export async function findGroupByName(groupName: string): Promise<{ id: string; name: string } | null> {
  const url = await getEvoApiUrl();
  const h = await headers();
  const res = await fetch(`${url}/group/fetchAllGroups/${INSTANCE_NAME}`, { method: 'GET', headers: h });
  if (!res.ok) return null;
  const groups = await res.json();
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
): Promise<boolean> {
  try {
    const apiUrl = await getEvoApiUrl();
    const url = `${apiUrl}/message/sendText/${instanceName || INSTANCE_NAME}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: await headers(),
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
