// ============================================================
// Minimal admin auth. MVP-grade: a single shared bearer token in
// the environment (ADMIN_TOKEN), checked with a constant-time
// comparison. Good enough to protect the admin product-CRUD routes
// from casual access; swap for real per-user auth (see admin_users
// table already in db.js) before you hand this out to more than
// one person.
// ============================================================
import crypto from 'node:crypto';

function timingSafeStringEqual(a, b) {
  const aBuf = Buffer.from(String(a));
  const bBuf = Buffer.from(String(b));
  if (aBuf.length !== bBuf.length) {
    // Still run a comparison of equal-length buffers so the function
    // takes roughly constant time regardless of length mismatches.
    crypto.timingSafeEqual(aBuf, aBuf);
    return false;
  }
  return crypto.timingSafeEqual(aBuf, bBuf);
}

/** Returns true if the request carries a valid `Authorization: Bearer <ADMIN_TOKEN>` header. */
export function isAdminRequest(req) {
  const token = process.env.ADMIN_TOKEN;
  if (!token) return false; // fail closed if not configured
  const header = req.headers.authorization || '';
  const [scheme, value] = header.split(' ');
  if (scheme !== 'Bearer' || !value) return false;
  return timingSafeStringEqual(value, token);
}
