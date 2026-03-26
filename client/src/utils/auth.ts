const ACCOUNT_ID_STORAGE_KEY = 'whiteboard-account-id';
const AUTH_TOKEN_STORAGE_KEY = 'whiteboard-auth-token';

export interface LocalAuthIdentity {
  accountId: string;
  authToken: string;
}

function createStableId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function getOrCreateAuthIdentity(): LocalAuthIdentity {
  if (typeof window === 'undefined') {
    return {
      accountId: 'server-render-account',
      authToken: 'server-render-token',
    };
  }

  let accountId = window.localStorage.getItem(ACCOUNT_ID_STORAGE_KEY);
  let authToken = window.localStorage.getItem(AUTH_TOKEN_STORAGE_KEY);

  if (!accountId) {
    accountId = createStableId('acct');
    window.localStorage.setItem(ACCOUNT_ID_STORAGE_KEY, accountId);
  }

  if (!authToken) {
    authToken = createStableId('token');
    window.localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, authToken);
  }

  return {
    accountId,
    authToken,
  };
}
