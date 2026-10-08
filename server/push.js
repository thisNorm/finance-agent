import { createECDH, createCipheriv, createPrivateKey, generateKeyPairSync, hkdfSync, randomBytes, randomUUID, sign } from "node:crypto";
import { z } from "zod";
import { createVault } from "./codef-bank.js";

// Web Push straight to the browsers the user turned it on in (the app added to a phone's home screen, a desktop
// browser). The message is encrypted for that one browser (RFC 8291), so the push service in between (Google,
// Apple, Mozilla, Microsoft) carries it without being able to read it; the server signs who it is with VAPID (RFC 8292).

const b64u = (buf) => Buffer.from(buf).toString("base64url");
const raw = (s) => Buffer.from(s, "base64url");

// Only the browser vendors' push services: the server posts to whatever address a subscription names,
// so anything else would let a caller point it at the local network.
const PUSH_HOSTS = /^(?:fcm\.googleapis\.com|(?:updates\.)?push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9-]+\.push\.apple\.com|[a-z0-9-]+\.notify\.windows\.com)$/;
export const pushSubscriptionSchema = z
  .object({
    subscription: z
      .object({
        endpoint: z
          .string()
          .url()
          .max(1000)
          .refine((u) => {
            const url = new URL(u);
            return url.protocol === "https:" && PUSH_HOSTS.test(url.hostname);
          }, "지원하는 브라우저 푸시 주소가 아닙니다."),
        expirationTime: z.number().nullable().optional(),
        keys: z
          .object({
            p256dh: z.string().regex(/^[A-Za-z0-9_-]+$/).refine((k) => raw(k).length === 65, "푸시 키 형식이 올바르지 않습니다."),
            auth: z.string().regex(/^[A-Za-z0-9_-]+$/).refine((k) => raw(k).length === 16, "푸시 키 형식이 올바르지 않습니다."),
          })
          .strict(),
      })
      .strict(),
    label: z.string().trim().max(60).default(""),
  })
  .strict();

// RFC 8291 aes128gcm: one record, padding delimiter 0x02. asPrivate and salt are only fixed in tests.
export function encryptPayload(plaintext, { p256dh, auth }, { asPrivate = null, salt = randomBytes(16) } = {}) {
  const ua = raw(p256dh),
    ecdh = createECDH("prime256v1");
  if (asPrivate) ecdh.setPrivateKey(asPrivate);
  else ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey(),
    shared = ecdh.computeSecret(ua),
    ikm = Buffer.from(hkdfSync("sha256", shared, raw(auth), Buffer.concat([Buffer.from("WebPush: info\0"), ua, asPublic]), 32)),
    cek = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16)),
    nonce = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12)),
    cipher = createCipheriv("aes-128-gcm", cek, nonce),
    body = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(plaintext), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]),
    rs = Buffer.alloc(4);
  rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([asPublic.length]), asPublic, body]);
}

function newKeys() {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" }),
    jwk = privateKey.export({ format: "jwk" });
  return { privateJwk: jwk, publicKey: b64u(Buffer.concat([Buffer.from([4]), raw(jwk.x), raw(jwk.y)])) };
}
// RFC 8292: a short-lived ES256 token for the push service's origin
export function vapidAuthorization(endpoint, keys, now = Date.now()) {
  const head = b64u(JSON.stringify({ typ: "JWT", alg: "ES256" })),
    claims = b64u(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: "mailto:alaseo@users.noreply.github.com" })),
    signature = sign("sha256", Buffer.from(`${head}.${claims}`), { key: createPrivateKey({ key: keys.privateJwk, format: "jwk" }), dsaEncoding: "ieee-p1363" });
  return `vapid t=${head}.${claims}.${b64u(signature)}, k=${keys.publicKey}`;
}

export function createPush({ vaultPath = null, fetcher = fetch } = {}) {
  const vault = createVault(vaultPath);
  const data = () => vault.read() || { keys: null, devices: [] };
  // the signing key is made once and kept; a new one would silently orphan every subscribed device
  const keys = () => {
    const d = data();
    if (d.keys) return d.keys;
    const k = newKeys();
    vault.write({ ...d, keys: k });
    return k;
  };
  const status = () => ({ publicKey: keys().publicKey, devices: data().devices.map(({ id, label, at }) => ({ id, label, at })) });
  return {
    status,
    subscribe(input) {
      const p = pushSubscriptionSchema.parse(input),
        d = data();
      keys();
      // the same browser subscribing again replaces its old entry
      const devices = d.devices.filter((x) => x.endpoint !== p.subscription.endpoint);
      if (devices.length >= 10) throw Error("푸시 받는 기기는 10대까지입니다. 쓰지 않는 기기를 먼저 지우세요.");
      devices.push({ id: randomUUID(), label: p.label, at: new Date().toISOString(), endpoint: p.subscription.endpoint, keys: p.subscription.keys });
      vault.write({ ...data(), devices });
      return status();
    },
    remove(id) {
      const d = data();
      vault.write({ ...d, devices: d.devices.filter((x) => x.id !== z.string().uuid().parse(id)) });
      return status();
    },
    // to every device; a subscription the browser gave up on (404/410) is dropped
    async send(title, body, url = "/") {
      const d = data();
      if (!d.devices.length) return null;
      const k = keys(),
        payload = JSON.stringify({ title, body: String(body).slice(0, 1000), url }),
        gone = [];
      const results = await Promise.all(
        d.devices.map(async (device) => {
          try {
            const r = await fetcher(device.endpoint, {
              method: "POST",
              headers: {
                Authorization: vapidAuthorization(device.endpoint, k),
                "Content-Encoding": "aes128gcm",
                "Content-Type": "application/octet-stream",
                TTL: "86400",
                Urgency: "normal",
              },
              body: encryptPayload(payload, device.keys),
              signal: AbortSignal.timeout(15_000),
            });
            if (r.status === 404 || r.status === 410) gone.push(device.id);
            return r.ok;
          } catch {
            return false;
          }
        }),
      );
      if (gone.length) vault.write({ ...data(), devices: data().devices.filter((x) => !gone.includes(x.id)) });
      return results.some(Boolean);
    },
  };
}
