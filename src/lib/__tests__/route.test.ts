import { describe, expect, it } from "vitest";
import { parseRoute, routeHref } from "../route";

describe("hash 路由", () => {
  it("解析现存路由", () => {
    expect(parseRoute("#/guide")).toBe("guide");
    expect(parseRoute("#/")).toBe("list");
    expect(parseRoute("")).toBe("list");
  });

  it("已移除功能的路由回落到词表", () => {
    for (const gone of ["#/review", "#/quiz", "#/leech", "#/lock", "#/setup", "#/triage"]) {
      expect(parseRoute(gone)).toBe("list");
    }
  });

  it("未知路由回落词表", () => {
    expect(parseRoute("#/nope")).toBe("list");
    expect(parseRoute("#/guide/deep")).toBe("list");
  });

  it("href 与 parse 互逆", () => {
    for (const route of ["list", "guide"] as const) {
      expect(parseRoute(routeHref(route))).toBe(route);
    }
  });
});
