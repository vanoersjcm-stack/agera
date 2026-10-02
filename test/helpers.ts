const API_URL = process.env.API_URL ?? `http://localhost:${process.env.PORT ?? 3000}`;
const REALM_URL = process.env.KEYCLOAK_REALM_URL ?? 'http://localhost:8080/realms/agera';
const CLIENT_ID = process.env.KEYCLOAK_CLIENT_ID ?? 'agera-backend';
const CLIENT_SECRET = process.env.KEYCLOAK_CLIENT_SECRET ?? 'dev-backend-secret-change-me';

export interface ApiResponse<T> {
  status: number;
  body: T;
}

export async function getToken(username: string, password: string): Promise<string> {
  const response = await fetch(`${REALM_URL}/protocol/openid-connect/token`, {
    method: 'POST',
    body: new URLSearchParams({
      grant_type: 'password',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      username,
      password,
    }),
  });
  if (!response.ok) {
    throw new Error(`Token request for ${username} failed with ${response.status}`);
  }
  const { access_token: token } = (await response.json()) as { access_token: string };
  return token;
}

export async function api<T>(token: string | null, method: string, path: string, body?: unknown): Promise<ApiResponse<T>> {
  const headers: Record<string, string> = {};
  if (token !== null) {
    headers.Authorization = `Bearer ${token}`;
  }
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as T };
}

export async function waitFor<T>(probe: () => Promise<T | undefined>, timeoutMs = 3000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const result = await probe();
    if (result !== undefined) {
      return result;
    }
    if (Date.now() > deadline) {
      throw new Error(`Condition not met within ${timeoutMs}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/** Ensures the next write lands in a later millisecond than the previous one. */
export function nextMillisecond(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 5));
}
