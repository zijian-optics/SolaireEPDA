/** 应用级「保存当前编辑」：由顶栏菜单或 Ctrl/Cmd+S 触发，各视图自行订阅并执行保存逻辑。 */
export const SOLAIRE_SAVE_EVENT = "solaire-save-current";

export function dispatchSolaireSave(): void {
  window.dispatchEvent(new CustomEvent(SOLAIRE_SAVE_EVENT));
}
