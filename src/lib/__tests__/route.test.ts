import { describe, expect, it } from "vitest";
import { parseRoute, routeHref } from "../route";

describe("hash 路由", () => {
  it("解析所有已声明路由", () => {
    expect(parseRoute("#/lock")).toBe("lock");
    expect(parseRoute("#/setup")).toBe("setup");
    expect(parseRoute("#/review")).toBe("review");
    expect(parseRoute("#/quiz")).toBe("quiz");
    expect(parseRoute("#/guide")).toBe("guide");
    expect(parseRoute("#/")).toBe("list");
    expect(parseRoute("")).toBe("list");
  });

  it("未知路由回落词表", () => {
    expect(parseRoute("#/nope")).toBe("list");
    expect(parseRoute("#/review/deep")).toBe("list");
  });

  it("href 与 parse 互逆", () => {
    for (const route of ["lock", "setup", "list", "review", "quiz", "guide"] as const) {
      expect(parseRoute(routeHref(route))).toBe(route);
    }
  });
});
