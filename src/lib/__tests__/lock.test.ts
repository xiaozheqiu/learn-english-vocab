import { describe, expect, it } from "vitest";
import {
  createPinHash, hasWebCrypto, hashPin, isValidPin, lockoutRemaining, MAX_ATTEMPTS,
  LOCKOUT_MS, NO_ATTEMPTS, PIN_LENGTH, pinHashBackend,
  registerFailure, timingSafeEqual, verifyPin,
} from "../lock";
import { pbkdf2Sha256, sha256, toHex } from "../sha256";

describe("PIN", () => {
  it("哈希不含明文，同 PIN 不同盐结果不同", async () => {
    const a = await createPinHash("1234", 1000);
    const b = await createPinHash("1234", 1000);
    expect(a.hash).not.toContain("1234");
    expect(a.salt).not.toContain("1234");
    expect(a.hash).not.toBe(b.hash);
    expect(a.hash).toHaveLength(64);
    expect(a.iterations).toBe(1000);
  });

  it("正确 PIN 通过，错误 PIN 不通过", async () => {
    const stored = await createPinHash("1234", 1000);
    expect(await verifyPin("1234", stored)).toBe(true);
    expect(await verifyPin("1235", stored)).toBe(false);
    expect(await verifyPin("", stored)).toBe(false);
  });

  it("固定盐可复现（便于单测）", async () => {
    const a = await hashPin("2468", "0a0b0c0d0e0f10111213141516171819", 1000);
    const b = await hashPin("2468", "0a0b0c0d0e0f10111213141516171819", 1000);
    expect(a).toBe(b);
  });

  it("PIN 格式校验：必须正好 6 位数字", () => {
    expect(PIN_LENGTH).toBe(6);
    expect(isValidPin("123456")).toBe(true);
    expect(isValidPin("000000")).toBe(true);
    // 4/5 位（旧格式）不再被接受为新 PIN
    expect(isValidPin("1234")).toBe(false);
    expect(isValidPin("12345")).toBe(false);
    expect(isValidPin("1234567")).toBe(false);
    expect(isValidPin("12a456")).toBe(false);
    expect(isValidPin("")).toBe(false);
  });

  it("定时安全比较", () => {
    expect(timingSafeEqual("abc", "abc")).toBe(true);
    expect(timingSafeEqual("abc", "abd")).toBe(false);
    expect(timingSafeEqual("abc", "ab")).toBe(false);
  });

  it("连错 5 次锁定 30 秒（验收 8）", () => {
    const now = 1_000_000;
    let state = NO_ATTEMPTS;
    for (let i = 0; i < MAX_ATTEMPTS - 1; i += 1) {
      state = registerFailure(state, now);
      expect(state.lockedUntil).toBe(0);
    }
    state = registerFailure(state, now);
    expect(state.lockedUntil).toBe(now + LOCKOUT_MS);
    expect(state.failures).toBe(0);
    expect(lockoutRemaining(state, now)).toBe(LOCKOUT_MS);
    expect(lockoutRemaining(state, now + LOCKOUT_MS)).toBe(0);
  });
});

/**
 * 定长 6 位：圆点、键盘上限、自动提交长度全部由 PIN_LENGTH 推导，
 * 不再存在「输入的位数和上面圆点总数对不上」的可能（2026-10-25 报的那个问题）。
 */
describe("定长 PIN 的界面口径", () => {
  it("PIN_LENGTH 是唯一长度来源", () => {
    expect(PIN_LENGTH).toBe(6);
  });

  it("旧库里 4–5 位的 PIN 哈希仍能验证通过（哈希只看明文）", async () => {
    const old = await createPinHash("1234", 1000);
    expect(await verifyPin("1234", old)).toBe(true);
    // 但补零/截断都过不了，说明校验没有偷偷放宽
    expect(await verifyPin("123400", old)).toBe(false);
    expect(await verifyPin("123", old)).toBe(false);
  });
});

/**
 * 非安全上下文（用局域网 IP 打开 http 页面）没有 `crypto.subtle`，
 * 之前设 PIN 会抛 `Cannot read properties of undefined (reading 'importKey')`。
 * 现在退回纯 JS 的 PBKDF2-SHA256，并且必须与 WebCrypto 输出完全一致，
 * 否则在 IP 上设的 PIN 换到 https 上就验证不过。
 */
describe("PIN 哈希的两条实现路径", () => {
  it("JS 版 PBKDF2 与 WebCrypto 逐字节一致（RFC 6070 向量 + 交叉校验）", async () => {
    const vectors: [string, string, number][] = [
      ["password", "salt", 1],
      ["password", "salt", 4096],
      ["passwordPASSWORDpassword", "saltSALTsaltSALTsaltSALTsaltSALTsalt", 4096],
      ["1234", "0a0b0c0d0e0f10111213141516171819", 1000],
    ];
    for (const [password, salt, iterations] of vectors) {
      const jsVersion = toHex(
        await pbkdf2Sha256(new TextEncoder().encode(password), new TextEncoder().encode(salt), iterations, {
          yieldEvery: 0,
        }),
      );
      // 走 hashPin 的 WebCrypto 分支（测试环境有 subtle），两条路径必须相等。
      // 用同一个原始盐：JS 版吃 UTF-8 字节，hashPin 吃同字节的十六进制表示。
      const viaHashPin = await hashPin(password, toHex(new TextEncoder().encode(salt)), iterations);
      expect(jsVersion).toBe(viaHashPin);
    }
  });

  it("JS 版 PBKDF2 命中固定向量，防止算法被改坏", async () => {
    // node:crypto 算出的值：pbkdf2Sync("password","salt",1,32,"sha256")
    const got = toHex(
      await pbkdf2Sha256(new TextEncoder().encode("password"), new TextEncoder().encode("salt"), 1, {
        yieldEvery: 0,
      }),
    );
    expect(got).toBe("120fb6cffcf8b32c43e7225256c4f837a86548c92ccc35480805987cb70be17b");
  });

  it("SHA-256 补齐边界（55/56/64 字节）与标准实现一致", () => {
    expect(toHex(sha256(new Uint8Array()))).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(toHex(sha256(new TextEncoder().encode("abc")))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    // 55 字节：长度字段刚好能塞进同一块；56 字节：必须多补一整块
    expect(toHex(sha256(new TextEncoder().encode("a".repeat(55))))).toBe(
      "9f4390f8d30c2dd92ec9f095b65e2b9ae9b0a925a5258e241c9f1e910f734318",
    );
    expect(toHex(sha256(new TextEncoder().encode("a".repeat(56))))).toBe(
      "b35439a4ac6f0948b6d6f9e3c6af0f5f590ce20f1bde7090ef7970686ec6738a",
    );
  });

  it("在 IP 上设的 PIN 能在 WebCrypto 环境里验证通过（反向亦然）", async () => {
    // 注意：库里的 salt 是十六进制字符串，PBKDF2 吃的是解码后的 16 字节
    const salt = "0a0b0c0d0e0f10111213141516171819";
    const saltBytes = new Uint8Array(salt.length / 2);
    for (let i = 0; i < saltBytes.length; i += 1) {
      saltBytes[i] = parseInt(salt.slice(i * 2, i * 2 + 2), 16);
    }
    const jsHash = toHex(
      await pbkdf2Sha256(new TextEncoder().encode("2468"), saltBytes, 1000, { yieldEvery: 0 }),
    );
    // 模拟「库里存的是 IP 环境设的哈希，现在在 https 下解锁」
    const stored = { salt, hash: jsHash, iterations: 1000 };
    expect(await verifyPin("2468", stored)).toBe(true);
    expect(await verifyPin("2469", stored)).toBe(false);
  });

  it("报告当前走哪条实现，便于设置页提示", () => {
    expect(["webcrypto", "js"]).toContain(pinHashBackend());
    // happy-dom / node 环境下有 subtle
    expect(hasWebCrypto()).toBe(true);
  });
});
