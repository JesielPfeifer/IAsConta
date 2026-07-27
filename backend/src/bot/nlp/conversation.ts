// Simple conversation state for WhatsApp bot interactions
// Tracks pending questions per sender

interface PendingState {
  transactionId: string;
  question: 'fixa' | 'parcelas' | null;
  userId: string;
  timestamp: number;
}

const pendingStates = new Map<string, PendingState>();
const STATE_TTL = 300_000; // 5 minutes

function cleanExpired() {
  const now = Date.now();
  for (const [key, state] of pendingStates) {
    if (now - state.timestamp > STATE_TTL) {
      pendingStates.delete(key);
    }
  }
}

export function setPendingState(senderId: string, state: PendingState) {
  cleanExpired();
  pendingStates.set(senderId, state);
}

export function getPendingState(senderId: string): PendingState | null {
  cleanExpired();
  const state = pendingStates.get(senderId);
  if (state && Date.now() - state.timestamp > STATE_TTL) {
    pendingStates.delete(senderId);
    return null;
  }
  return state || null;
}

export function clearPendingState(senderId: string) {
  pendingStates.delete(senderId);
}
