/**
 * Entry point for the corner overlay window.
 *
 * In the app, `window.overtime` comes from the preload script. Opened as a
 * plain page (preview, screenshots) it is missing, so a mock with canned
 * states is installed instead: `?mock=<scenario>`, `?bg=1` for a wallpaper
 * behind the scene, `?sheet=<name>` for character contact sheets.
 */

import type { OvertimeApi } from '../../shared/ipc';
import { installMock, SCENARIO_NAMES, type MockUi } from './mock';
import { renderSheet, SHEETS } from './sheet';
import { OverlayUi } from './ui';
import { SceneView } from './view';

function stageEl(): HTMLElement {
  const stage = document.getElementById('stage');
  if (!stage) throw new Error('overlay: #stage missing from index.html');
  return stage;
}

function start(api: OvertimeApi, mockUi?: MockUi): void {
  const stage = stageEl();
  const view = new SceneView(stage);
  const ui = new OverlayUi(api, view, stage);
  let first = true;
  const apply = (state: Parameters<SceneView['render']>[0]): void => {
    view.render(state);
    ui.update(state);
    if (first && mockUi) applyMockUi(view, ui, mockUi);
    first = false;
  };
  api.onState(apply);
  api.onEffect((e) => view.effect(e));
  void api.getState().then((s) => {
    if (first) apply(s);
  });
}

function applyMockUi(view: SceneView, ui: OverlayUi, m: MockUi): void {
  if (m.menu) ui.openMenu();
  if (m.fireConfirm) ui.askFire();
  if (m.chat !== undefined) ui.openChat(m.chat);
  if (m.hover) {
    view.setPointerOver(true);
    ui.showCard();
  }
  const tip = m.tip;
  // Menu buttons fan out over ~0.3 s; place the tooltip once they land.
  if (tip) window.setTimeout(() => ui.previewTip(tip), m.menu ? 450 : 0);
  if (m.sipAt !== undefined) window.setTimeout(() => view.sip(), m.sipAt);
  const effect = m.effect;
  if (effect) window.setTimeout(() => view.effect(effect, true), m.effectAt ?? 0);
}

function main(): void {
  if (typeof window.overtime !== 'undefined') {
    start(window.overtime);
    return;
  }
  // Preview mode only: never reached inside the app.
  const params = new URLSearchParams(location.search);
  (window as unknown as { __overtimeMock: unknown }).__overtimeMock = {
    scenarios: SCENARIO_NAMES,
    sheets: SHEETS,
  };
  const bg = params.get('bg');
  if (bg) {
    const cls = bg === 'light' ? 'preview-bg-light' : bg === 'busy' ? 'preview-bg-busy' : 'preview-bg';
    document.body.classList.add(cls);
  }
  const sheet = params.get('sheet');
  if (sheet) {
    renderSheet(sheet, stageEl());
    return;
  }
  const { api, ui } = installMock(params.get('mock') ?? 'working');
  start(api, ui);
}

main();
