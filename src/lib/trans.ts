/** 查词跳转第三方翻译（§0 决策 4：不做 TTS，查词走现有链接） */

export const isMobile =
  typeof navigator !== "undefined" &&
  /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i.test(navigator.userAgent);

const DESKTOP = "https://fanyi.baidu.com/mtpe-individual/transText?query=";
const MOBILE = "https://fanyi.baidu.com/m/trans?from=en&to=zh&query=";

export function transUrl(word: string): string {
  const encoded = encodeURIComponent(word);
  return isMobile ? `${MOBILE}${encoded}` : `${DESKTOP}${encoded}&lang=en2zh`;
}
