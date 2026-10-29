import { describe, expect, it } from "vitest";
import { primaryMeaning } from "../words";

describe("释义首义", () => {
  it("新数据用中文分号分隔，只取第一个义项", () => {
    expect(primaryMeaning("库存；现货；储备")).toBe("库存");
    expect(primaryMeaning("浏览器；浏览者；随便翻看的人")).toBe("浏览器");
    expect(primaryMeaning("政变；成功之举；妙举")).toBe("政变");
  });

  it("兼容旧数据的全角斜杠与竖线", () => {
    expect(primaryMeaning("放弃，抛弃 ／ 遗弃")).toBe("放弃，抛弃");
    expect(primaryMeaning("甲|乙")).toBe("甲");
  });

  it("单义项原样返回", () => {
    expect(primaryMeaning("冰箱")).toBe("冰箱");
    expect(primaryMeaning("  多个空格  ")).toBe("多个空格");
  });

  it("不把中文逗号当分隔符（逗号在单个义项内部也出现）", () => {
    expect(primaryMeaning("库存，存货；储备")).toBe("库存，存货");
  });

  it("空串不抛错", () => {
    expect(primaryMeaning("")).toBe("");
  });
});
