import { createSign } from 'node:crypto';

export function signAppJwt(appId, keyBase64) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const unsigned = encode({ alg: 'RS256', typ: 'JWT' }) + '.' + encode({ iat: now - 60, exp: now + 480, iss: String(appId) });
  const signature = createSign('RSA-SHA256').update(unsigned).sign(Buffer.from(keyBase64, 'base64'), 'base64url');
  return unsigned + '.' + signature;
}
