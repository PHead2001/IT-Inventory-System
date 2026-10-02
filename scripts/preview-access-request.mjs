import { PARENT_REF } from './preview-access-core.mjs';

const MAX_AUTH_ERROR_BYTES = 4096;
const coded = (code) =>
  Object.assign(new Error('Preview access request failed'), { code });

function isAuthAdminMutation(url, method) {
  let target;
  try {
    target = new URL(url);
  } catch {
    return false;
  }
  return (
    target.protocol === 'https:' &&
    /^[a-z0-9]{20}\.supabase\.co$/.test(target.hostname) &&
    target.hostname !== `${PARENT_REF}.supabase.co` &&
    !target.username &&
    !target.password &&
    !target.port &&
    !target.search &&
    !target.hash &&
    ((method === 'POST' && target.pathname === '/auth/v1/admin/users') ||
      (method === 'PUT' &&
        /^\/auth\/v1\/admin\/users\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          target.pathname,
        )))
  );
}

function hasDuplicateKeys(json) {
  const tokens = [...json.matchAll(/"(?:[^"\\]|\\.)*"|[{}\[\]:]/g)];
  const scopes = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index][0];
    if (token === '{') scopes.push(new Set());
    else if (token === '[') scopes.push(null);
    else if (token === '}' || token === ']') scopes.pop();
    else if (token.startsWith('"') && tokens[index + 1]?.[0] === ':') {
      const key = JSON.parse(token);
      const keys = scopes.at(-1);
      if (keys.has(key)) return true;
      keys.add(key);
    }
  }
  return false;
}

async function isPasswordLengthRejection(response) {
  let reader;
  try {
    reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_AUTH_ERROR_BYTES) return false;
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const json = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const data = JSON.parse(json);
    if (hasDuplicateKeys(json)) return false;
    if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
    const modern =
      data.code === 'weak_password' && data.error_code === undefined;
    const legacy = data.code === 422 && data.error_code === 'weak_password';
    return (
      (modern || legacy) &&
      Array.isArray(data.weak_password?.reasons) &&
      data.weak_password.reasons.length === 1 &&
      data.weak_password.reasons[0] === 'length'
    );
  } catch {
    return false;
  } finally {
    try {
      await reader?.cancel();
    } catch {
      /* Error bodies are never reported. */
    }
    try {
      reader?.releaseLock();
    } catch {
      /* Preserve the sanitized outcome. */
    }
  }
}

export function createPreviewRequest(fetchImpl = fetch) {
  return async (
    url,
    { method = 'GET', headers = {}, body, allowNotFound = false } = {},
  ) => {
    let response;
    try {
      response = await fetchImpl(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: 'error',
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      throw coded('NETWORK_ERROR');
    }
    if (response.redirected) throw coded('REDIRECT_DENIED');
    if (allowNotFound && response.status === 404) return null;
    if (!response.ok) {
      if (
        response.status === 422 &&
        isAuthAdminMutation(url, method) &&
        (await isPasswordLengthRejection(response))
      )
        throw coded('AUTH_PASSWORD_LENGTH_PENDING');
      throw coded(`HTTP_${response.status}`);
    }
    if (response.status === 204) return null;
    try {
      return await response.json();
    } catch {
      throw coded('RESPONSE_INVALID_JSON');
    }
  };
}
