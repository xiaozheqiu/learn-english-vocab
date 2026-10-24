/**
 * 当前页面是否处于可见状态。
 *
 * 三个主页面改成常驻（切 tab 不卸载）之后，各页挂在 window 上的快捷键
 * （复习的 1–4、测试的 1–4/回车）在页面被藏起来时必须自我关闭，
 * 否则用户在词表里打字也会触发上一页的按键。
 */
import { createContext, useContext } from "react";

const PageActiveContext = createContext(true);

export const PageActiveProvider = PageActiveContext.Provider;

export function usePageActive(): boolean {
  return useContext(PageActiveContext);
}
