/**
 * PBKDF2-HMAC-SHA256 的纯 JS 实现（§4.2 兜底路径）。
 *
 * 为什么需要它：WebCrypto 的 `crypto.subtle` 只在**安全上下文**存在
 * （https、localhost、127.0.0.1、file://）。用局域网 IP 打开页面
 * （比如手机连同一 Wi-Fi 访问 http://192.168.x.x:5173）时 `crypto.subtle` 是
 * undefined，`crypto.subtle.importKey` 就会抛
 * `Cannot read properties of undefined (reading 'importKey')` —— 设 PIN 直接失败。
 *
 * 这里按 RFC 8018 实现同一套 PBKDF2-HMAC-SHA256：
 * - 参数相同（盐、迭代次数、dkLen=32）时，输出与 WebCrypto **逐字节一致**，
 *   所以同一个 PIN 在 http 局域网里设的哈希，换到 https 上仍能验证，反之亦然；
 * - 只有实现路径不同（JS 比浏览器原生慢一个量级），不是降级成弱哈希。
 *
 * 实测对比见 `src/lib/__tests__/lock.test.ts` 里对 WebCrypto 的交叉校验。
 */

/** SHA-256 轮常量（前 64 个质数立方根小数部分前 32 位） */
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/**
 * 压缩函数用到的临时缓冲区。sha256 全程同步、不重入，
 * 所以模块级复用是安全的 —— PBKDF2 跑 10 万轮时能省掉 20 万次分配。
 */
const W = new Uint32Array(64);
let padded = new Uint8Array(256);
let inward = new Uint8Array(256);

function ensureCapacity(bytes: number): Uint8Array {
  if (padded.length < bytes) padded = new Uint8Array(bytes);
  return padded;
}

function compress(state: Uint32Array, block: Uint8Array, offset: number): void {
  for (let i = 0; i < 16; i += 1) {
    const at = offset + i * 4;
    W[i] =
      ((block[at]! << 24) | (block[at + 1]! << 16) | (block[at + 2]! << 8) | block[at + 3]!) >>> 0;
  }
  for (let i = 16; i < 64; i += 1) {
    const x = W[i - 15]!;
    const y = W[i - 2]!;
    const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
    const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
    W[i] = (W[i - 16]! + s0 + W[i - 7]! + s1) >>> 0;
  }

  let a = state[0]!;
  let b = state[1]!;
  let c = state[2]!;
  let d = state[3]!;
  let e = state[4]!;
  let f = state[5]!;
  let g = state[6]!;
  let h = state[7]!;

  for (let i = 0; i < 64; i += 1) {
    const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
    const ch = (e & f) ^ (~e & g);
    const t1 = (h + S1 + ch + K[i]! + W[i]!) >>> 0;
    const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
    const maj = (a & b) ^ (a & c) ^ (b & c);
    const t2 = (S0 + maj) >>> 0;
    h = g;
    g = f;
    f = e;
    e = (d + t1) >>> 0;
    d = c;
    c = b;
    b = a;
    a = (t1 + t2) >>> 0;
  }

  state[0] = (state[0]! + a) >>> 0;
  state[1] = (state[1]! + b) >>> 0;
  state[2] = (state[2]! + c) >>> 0;
  state[3] = (state[3]! + d) >>> 0;
  state[4] = (state[4]! + e) >>> 0;
  state[5] = (state[5]! + f) >>> 0;
  state[6] = (state[6]! + g) >>> 0;
  state[7] = (state[7]! + h) >>> 0;
}

/** 对若干段拼接后的内容求 SHA-256；分段是为了给 HMAC 省掉拼接分配 */
function sha256Segments(segments: readonly Uint8Array[]): Uint8Array {
  let length = 0;
  for (const segment of segments) length += segment.length;

  // 补齐 0x80 + 8 字节长度，凑成 64 字节整数倍
  const total = Math.ceil((length + 9) / 64) * 64;
  const buf = ensureCapacity(total);
  let at = 0;
  for (const segment of segments) {
    buf.set(segment, at);
    at += segment.length;
  }
  buf[length] = 0x80;
  buf.fill(0, length + 1, total - 8);
  const bits = length * 8;
  const high = Math.floor(bits / 0x1_0000_0000);
  const low = bits >>> 0;
  buf[total - 8] = (high >>> 24) & 0xff;
  buf[total - 7] = (high >>> 16) & 0xff;
  buf[total - 6] = (high >>> 8) & 0xff;
  buf[total - 5] = high & 0xff;
  buf[total - 4] = (low >>> 24) & 0xff;
  buf[total - 3] = (low >>> 16) & 0xff;
  buf[total - 2] = (low >>> 8) & 0xff;
  buf[total - 1] = low & 0xff;

  const state = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  for (let offset = 0; offset < total; offset += 64) compress(state, buf, offset);

  const out = new Uint8Array(32);
  for (let i = 0; i < 8; i += 1) {
    const word = state[i]!;
    out[i * 4] = (word >>> 24) & 0xff;
    out[i * 4 + 1] = (word >>> 16) & 0xff;
    out[i * 4 + 2] = (word >>> 8) & 0xff;
    out[i * 4 + 3] = word & 0xff;
  }
  return out;
}

export function sha256(message: Uint8Array): Uint8Array {
  return sha256Segments([message]);
}

/** 预计算内外填充的 HMAC-SHA256，PBKDF2 里密钥固定，每轮只剩两次压缩 */
function createHmac(key: Uint8Array): (message: Uint8Array) => Uint8Array {
  const block = new Uint8Array(64);
  block.set(key.length > 64 ? sha256(key) : key);
  const inner = new Uint8Array(64);
  const outer = new Uint8Array(64);
  for (let i = 0; i < 64; i += 1) {
    inner[i] = block[i]! ^ 0x36;
    outer[i] = block[i]! ^ 0x5c;
  }
  return (message) => sha256Segments([outer, sha256Segments([inner, message])]);
}

export interface Pbkdf2Options {
  /** 每跑这么多轮让出一次事件循环，避免长任务把页面卡住（默认 8192） */
  yieldEvery?: number;
}

/**
 * PBKDF2-HMAC-SHA256，与 WebCrypto 同名算法输出一致。
 * 只实现 dkLen = 32（PIN 哈希固定 256 位）。
 */
export async function pbkdf2Sha256(
  password: Uint8Array,
  salt: Uint8Array,
  iterations: number,
  { yieldEvery = 8192 }: Pbkdf2Options = {},
): Promise<Uint8Array> {
  if (iterations < 1) throw new Error("PBKDF2 迭代次数必须 ≥ 1");

  const prf = createHmac(password);
  // U1 = HMAC(P, S || INT(i))，i 从 1 开始
  const seed = ensureInward(salt.length + 4);
  seed.set(salt);
  seed[salt.length] = 0;
  seed[salt.length + 1] = 0;
  seed[salt.length + 2] = 0;
  seed[salt.length + 3] = 1;

  let u = prf(seed);
  const out = new Uint8Array(u);

  for (let round = 1; round < iterations; round += 1) {
    u = prf(u);
    for (let i = 0; i < out.length; i += 1) out[i] = out[i]! ^ u[i]!;
    if (yieldEvery > 0 && round % yieldEvery === 0) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  return out;
}

function ensureInward(bytes: number): Uint8Array {
  if (inward.length < bytes) inward = new Uint8Array(bytes);
  return inward.subarray(0, bytes);
}

export function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}
