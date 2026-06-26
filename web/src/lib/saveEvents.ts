/** 应用级「保存当前编辑」：由顶栏菜单或 Ctrl/Cmd+S 触发，各视图自行订阅并执行保存逻辑。 */
import { isImeCompositionActive } from "./ime";

export const SOLAIRE_SAVE_EVENT = "solaire-save-current";

export function dispatchSolaireSave(): void {
  if (isImeCompositionActive()) return;
  window.dispatchEvent(new CustomEvent(SOLAIRE_SAVE_EVENT));
}
