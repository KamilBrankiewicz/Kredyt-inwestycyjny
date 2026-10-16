// WYŁĄCZNIE podpięcie zdarzeń elementów statycznych → UI.*; globalny handler błędów; rejestracja SW.
window.addEventListener('error', (e) => {
  console.error(e.error || e.message);
  UI.showToast('Coś poszło nie tak. Twoje dane są bezpieczne w przeglądarce.');
});
window.addEventListener('unhandledrejection', (e) => {
  console.error(e.reason);
  UI.showToast('Coś poszło nie tak. Twoje dane są bezpieczne w przeglądarce.');
});

document.addEventListener('DOMContentLoaded', () => {
  const $ = (id) => document.getElementById(id);

  $('params-form').addEventListener('input', (e) => UI.handleParamInput(e));
  $('params-form').addEventListener('change', (e) => UI.handleParamChange(e));
  $('params-form').addEventListener('click', (e) => UI.handleParamClick(e));
  $('btn-params-close').addEventListener('click', () => UI.closeParams());
  $('summary-bar').addEventListener('click', () => UI.openParams());

  document.querySelector('.bottom-nav').addEventListener('click', (e) => UI.handleNavClick(e));
  $('verdict').addEventListener('click', (e) => UI.handleVerdictClick(e));

  $('sched-years').addEventListener('click', () => UI.setScheduleMode('years'));
  $('sched-months').addEventListener('click', () => UI.setScheduleMode('months'));
  $('schedule-table').addEventListener('change', (e) => UI.handleScheduleChange(e));

  $('scenario-list').addEventListener('click', (e) => UI.handleScenarioClick(e));
  $('fab-save').addEventListener('click', () => UI.openSaveModal());
  $('btn-save-scenario-2').addEventListener('click', () => UI.openSaveModal());
  $('btn-save-new').addEventListener('click', () => UI.saveScenario(true));
  $('btn-save-overwrite').addEventListener('click', () => UI.saveScenario(false));
  $('btn-save-cancel').addEventListener('click', () => UI.closeModal('modal-save'));

  $('btn-help').addEventListener('click', () => UI.openHelp());
  $('btn-help-close').addEventListener('click', () => UI.closeModal('modal-help'));
  ['mini-amount', 'mini-rate', 'mini-n'].forEach((id) => $(id).addEventListener('input', () => UI.updateMiniCalc()));

  $('btn-settings').addEventListener('click', () => UI.openSettings());
  $('btn-settings-close').addEventListener('click', () => UI.closeModal('modal-settings'));
  $('theme-select').addEventListener('change', (e) => UI.handleThemeChange(e));
  $('btn-export').addEventListener('click', () => UI.exportJson());
  $('import-file').addEventListener('change', (e) => UI.importJson(e));
  $('btn-clear').addEventListener('click', () => UI.confirmClear());
  $('btn-confirm-cancel').addEventListener('click', () => UI.closeModal('modal-confirm'));
  $('btn-confirm-ok').addEventListener('click', () => UI.clearData());

  document.querySelectorAll('.modal-overlay').forEach((o) => o.addEventListener('click', (e) => UI.handleOverlayClick(e)));
  document.addEventListener('keydown', (e) => UI.handleKeydown(e));

  UI.init();
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch((err) => console.error('SW:', err));
  // Nowa wersja przejęła stronę → przeładuj raz, żeby nie działał stary JS z poprzedniego cache.
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController) location.reload(); });
}
