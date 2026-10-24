import { BookOpen, Database, Info, ShieldQuestion } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

/** 与 package.json 的 version 保持一致（v2.0.0） */
export const APP_VERSION = "2.0.0";

export interface AboutSectionProps {
  onOpenGuide: () => void;
}

/**
 * 关于分区（§2.3 / §4.1 / §11）：
 * 词性对照表入口、数据来源、版本，并把 PIN 的真实定位写清楚。
 */
export function AboutSection({ onOpenGuide }: AboutSectionProps) {
  return (
    <div className="space-y-4">
      <section aria-labelledby="about-guide-title">
        <h3 id="about-guide-title" className="text-[13px] font-medium text-ink">
          词性对照表
        </h3>
        <p className="mt-0.5 text-[12px] leading-5 text-ink-soft">
          名词、动词、形容词等缩写与用法说明。
        </p>
        <Button variant="outline" size="touch" className="mt-1.5 w-full" onClick={onOpenGuide}>
          <BookOpen className="h-4 w-4" aria-hidden="true" />
          打开词性对照表
        </Button>
      </section>

      <section aria-labelledby="about-source-title" className="border-t border-line pt-3">
        <h3
          id="about-source-title"
          className="flex items-center gap-1.5 text-[13px] font-medium text-ink"
        >
          <Database className="h-3.5 w-3.5 text-ink-mute" aria-hidden="true" />
          数据来源
        </h3>
        <ul className="mt-1 space-y-1 text-[12px] leading-5 text-ink-soft">
          <li className="tnum">Oxford 5000 词表，共 5323 条，覆盖 A1–C1 五个等级</li>
          <li>词性与中文释义取自词表原数据，未做改写</li>
          <li>进度、偏好与 PIN 哈希全部保存在本机浏览器，不上传、无服务端</li>
        </ul>
      </section>

      <section aria-labelledby="about-lock-title" className="border-t border-line pt-3">
        <h3
          id="about-lock-title"
          className="flex items-center gap-1.5 text-[13px] font-medium text-ink"
        >
          <ShieldQuestion className="h-3.5 w-3.5 text-ink-mute" aria-hidden="true" />
          关于 PIN
        </h3>
        <p className="mt-1 text-[12px] leading-5 text-ink-soft">
          PIN 是本地隐私屏，学习数据未加密；重置不会删除数据。它只挡住随手拿起你设备的人，
          并不是真正的访问控制——数据就在浏览器里，打开开发者工具即可看到。
        </p>
      </section>

      <section aria-labelledby="about-version-title" className="border-t border-line pt-3">
        <h3
          id="about-version-title"
          className="flex items-center gap-1.5 text-[13px] font-medium text-ink"
        >
          <Info className="h-3.5 w-3.5 text-ink-mute" aria-hidden="true" />
          版本
        </h3>
        <p className="mt-1 flex items-center gap-2 text-[12px] text-ink-soft tnum">
          <Badge variant="brand">v{APP_VERSION}</Badge>
          <span>React + TypeScript · FSRS-5 排期 · 纯前端离线可用</span>
        </p>
      </section>
    </div>
  );
}
