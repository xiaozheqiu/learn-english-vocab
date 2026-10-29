import { useRef, useState } from "react";
import { CheckCircle2, FileDown, FileUp, MonitorDown, Trash2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { parseExport } from "@/lib/db";
import { dayKey } from "@/lib/date";
import type { VocabStore } from "@/hooks/useVocabStore";

export interface DataSectionProps {
  store: Pick<VocabStore, "exportData" | "importData" | "wipeProgress" | "refresh">;
  canInstall: boolean;
  onInstall: () => void;
  /** 降级到内存态时的提示（§5 F4） */
  memoryMode?: boolean;
}

type Notice = { tone: "ok" | "error"; text: string } | null;

interface PendingImport {
  fileName: string;
  payload: unknown;
  mastery: number;
}

/**
 * 数据分区（§2.3 / §5 F4）：
 * 导出 JSON、覆盖式导入（二次确认）、清空进度（二次确认，保留偏好）、安装到桌面。
 * 导入与清空都会 store.refresh()，让浮窗外面的词表立刻看到新数据。
 */
export function DataSection({
  store,
  canInstall,
  onInstall,
  memoryMode = false,
}: DataSectionProps) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [pending, setPending] = useState<PendingImport | null>(null);
  const [confirmWipe, setConfirmWipe] = useState(false);
  const [busy, setBusy] = useState(false);

  const exportJson = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const payload = await store.exportData();
      const fileName = `ox5000-mastered-${dayKey(new Date())}.json`;
      download(fileName, JSON.stringify(payload, null, 2));
      setNotice({ tone: "ok", text: `已导出 ${fileName}` });
    } catch (error) {
      setNotice({ tone: "error", text: `导出失败：${message(error)}` });
    } finally {
      setBusy(false);
    }
  };

  const pickFile = async (file: File) => {
    setNotice(null);
    setBusy(true);
    try {
      const text = await file.text();
      // 先本地解析一遍做预览，坏文件在覆盖数据之前就挡住
      const parsed = parseExport(text);
      setPending({
        fileName: file.name,
        payload: parsed,
        mastery: parsed.mastery.length,
      });
    } catch (error) {
      setPending(null);
      setNotice({ tone: "error", text: `不是有效的进度文件：${message(error)}` });
    } finally {
      setBusy(false);
    }
  };

  const confirmImport = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      await store.importData(pending.payload);
      await store.refresh();
      setNotice({ tone: "ok", text: `已导入 ${pending.mastery} 条已掌握` });
      setPending(null);
    } catch (error) {
      setNotice({ tone: "error", text: `导入失败：${message(error)}` });
    } finally {
      setBusy(false);
    }
  };

  const confirmClear = async () => {
    setBusy(true);
    try {
      await store.wipeProgress();
      await store.refresh();
      setConfirmWipe(false);
      setNotice({ tone: "ok", text: "已掌握标记已清空，偏好保留" });
    } catch (error) {
      setNotice({ tone: "error", text: `清空失败：${message(error)}` });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      {memoryMode && (
        <p
          className="rounded-btn border border-due/30 bg-due-wash px-3 py-2 text-[12px] leading-5 text-due"
          role="status"
        >
          浏览器禁止本地存储，本次数据只在内存里；导出可以留一份底。
        </p>
      )}

      {notice && (
        <p
          role={notice.tone === "error" ? "alert" : "status"}
          className={
            notice.tone === "error"
              ? "rounded-btn border border-danger/25 bg-danger-wash px-3 py-2 text-[12px] leading-5 text-danger"
              : "rounded-btn border border-brand/25 bg-brand-wash px-3 py-2 text-[12px] leading-5 text-brand-ink"
          }
        >
          {notice.text}
        </p>
      )}

      {/* 导出 */}
      <section aria-labelledby="data-export-title">
        <h3 id="data-export-title" className="text-[13px] font-medium text-ink">
          导出备份
        </h3>
        <p className="mt-0.5 text-[12px] leading-5 text-ink-soft">
          下载一个 JSON：已掌握的单词与显示偏好。换设备或清缓存前先留一份。
        </p>
        <Button
          variant="outline"
          size="touch"
          className="mt-1.5 w-full"
          onClick={() => void exportJson()}
          disabled={busy}
        >
          <FileDown className="h-4 w-4" aria-hidden="true" />
          导出 JSON
        </Button>
      </section>

      {/* 导入 */}
      <section aria-labelledby="data-import-title">
        <h3 id="data-import-title" className="text-[13px] font-medium text-ink">
          导入备份
        </h3>
        <p className="mt-0.5 text-[12px] leading-5 text-ink-soft">
          覆盖式导入：当前进度会被文件内容替换，操作前需要再确认一次。
        </p>

        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          aria-label="选择进度 JSON 文件"
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0];
            // 重置 value，同一个文件改完还能再选一次
            event.target.value = "";
            if (file) void pickFile(file);
          }}
        />
        <Button
          variant="outline"
          size="touch"
          className="mt-1.5 w-full"
          onClick={() => fileInput.current?.click()}
          disabled={busy}
        >
          <FileUp className="h-4 w-4" aria-hidden="true" />
          选择 JSON 文件
        </Button>

        {pending && (
          <div className="mt-2 rounded-btn border border-due/30 bg-due-wash px-3 py-2.5">
            <p className="flex items-start gap-1.5 text-[12px] font-medium leading-5 text-due">
              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              将用「{pending.fileName}」覆盖当前进度
            </p>
            <p className="mt-1 text-[12px] leading-5 text-due tnum">已掌握 {pending.mastery} 条</p>
            <div className="mt-2 flex gap-1.5">
              <Button
                size="touch"
                className="flex-1"
                onClick={() => void confirmImport()}
                disabled={busy}
              >
                <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                确认导入
              </Button>
              <Button
                size="touch"
                variant="outline"
                className="flex-1"
                onClick={() => setPending(null)}
                disabled={busy}
              >
                取消
              </Button>
            </div>
          </div>
        )}
      </section>

      {/* 安装到桌面 */}
      {canInstall && (
        <section aria-labelledby="data-install-title">
          <h3 id="data-install-title" className="text-[13px] font-medium text-ink">
            安装到桌面
          </h3>
          <p className="mt-0.5 text-[12px] leading-5 text-ink-soft">装成独立应用，断网也能查词。</p>
          <Button size="touch" className="mt-1.5 w-full" onClick={onInstall}>
            <MonitorDown className="h-4 w-4" aria-hidden="true" />
            安装应用
          </Button>
        </section>
      )}

      {/* 清空进度 */}
      <section aria-labelledby="data-clear-title" className="border-t border-line pt-3">
        <h3 id="data-clear-title" className="text-[13px] font-medium text-ink">
          清空掌握标记
        </h3>
        <p className="mt-0.5 text-[12px] leading-5 text-ink-soft">
          删除全部「已掌握」记录。<strong className="font-medium text-ink">偏好会保留</strong>
          ，词表本身不受影响。
        </p>

        {!confirmWipe ? (
          <Button
            variant="outline"
            size="touch"
            className="mt-1.5 w-full border-danger/30 text-danger hover:border-danger/50 hover:bg-danger-wash"
            onClick={() => setConfirmWipe(true)}
            disabled={busy}
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
            清空进度…
          </Button>
        ) : (
          <div className="mt-2 rounded-btn border border-danger/30 bg-danger-wash px-3 py-2.5">
            <p
              className="flex items-start gap-1.5 text-[12px] font-medium leading-5 text-danger"
              role="alert"
            >
              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              清空后无法从本机恢复。已有备份的话，可以先导出再清空。
            </p>
            <div className="mt-2 flex gap-1.5">
              <Button
                size="touch"
                variant="danger"
                className="flex-1"
                onClick={() => void confirmClear()}
                disabled={busy}
              >
                确认清空
              </Button>
              <Button
                size="touch"
                variant="outline"
                className="flex-1"
                onClick={() => setConfirmWipe(false)}
                disabled={busy}
              >
                取消
              </Button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

/** 触发浏览器下载；用完立刻回收 object URL */
function download(fileName: string, text: string): void {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // Safari 需要下一拍再回收，否则下载可能被取消
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
