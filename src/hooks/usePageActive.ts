/**
 * 当前页面是否处于可见状态。
 *
 * 主页面常驻（切 tab 不卸载）之后，挂在 window 上的快捷键
 * （词表的 Shift+↑↓ 扩选）在页面被藏起来时必须自我关闭，
 * 否则用户在别的页面按键也会触发词表的选中逻辑。
 */
import { createContext, useContext } from "react";

const PageActiveContext = createContext(true);

export const PageActiveProvider = PageActiveContext.Provider;

export function usePageActive(): boolean {
  return useContext(PageActiveContext);
}
