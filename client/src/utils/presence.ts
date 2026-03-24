const CLIENT_ID_STORAGE_KEY = 'whiteboard-client-id';

function createClientId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `client-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function getOrCreateClientId(): string {
  if (typeof window === 'undefined') {
    return 'server-render';
  }

  const existingClientId = window.localStorage.getItem(CLIENT_ID_STORAGE_KEY);
  if (existingClientId) {
    return existingClientId;
  }

  const nextClientId = createClientId();
  window.localStorage.setItem(CLIENT_ID_STORAGE_KEY, nextClientId);
  return nextClientId;
}
