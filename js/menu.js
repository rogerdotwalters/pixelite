/**
 * menu.js
 * ---------------------------------------------------------------------------
 * Wires up the top menu bar (File / Edit / Project / Effects / Palettes).
 * This file only handles opening/closing dropdowns and dispatching clicks;
 * the actual work (new image, export, undo, palette import/export) is
 * delegated to the `app` object passed in, keeping this file a thin
 * "menu -> action" mapping that's easy to extend.
 *
 * ============================================================
 *  HOW TO ADD A NEW MENU ITEM
 * ============================================================
 *   1. Add a <button class="menu-item" data-action="yourAction"> inside the
 *      right dropdown in index.html.
 *   2. Add a case for 'yourAction' in the switch statement below.
 *   The Effects menu (brightness-contrast, hue-saturation, grayscale,
 *   invert) follows this exact pattern — see app.js's "image adjustment
 *   filters" section for what each action actually does.
 */

function initMenu(app) {
  const menuBar = document.getElementById('menu-bar');

  // Open/close dropdowns on click, close when clicking elsewhere.
  menuBar.querySelectorAll('.menu').forEach((menu) => {
    const trigger = menu.querySelector('.menu-trigger');
    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = menu.classList.contains('open');
      menuBar.querySelectorAll('.menu.open').forEach((m) => m.classList.remove('open'));
      if (!isOpen) menu.classList.add('open');
    });
  });
  document.addEventListener('click', () => {
    menuBar.querySelectorAll('.menu.open').forEach((m) => m.classList.remove('open'));
  });

  // Dispatch dropdown item clicks by their data-action attribute.
  menuBar.querySelectorAll('.menu-item[data-action]').forEach((item) => {
    item.addEventListener('click', () => {
      menuBar.querySelectorAll('.menu.open').forEach((m) => m.classList.remove('open'));
      handleAction(item.dataset.action, app);
    });
  });

  // Keep Undo/Redo enabled-state in sync. app.onChange fires on every
  // history/frame change, so this stays correct even as the active frame
  // (and therefore the active HistoryManager instance) changes underneath us.
  app.onChange(() => refreshMenuState(app));
  refreshMenuState(app);
}

function handleAction(action, app) {
  switch (action) {
    case 'new':
      app.promptNewImage();
      break;
    case 'open':
      app.openImageFromDisk();
      break;
    case 'import-frames':
      app.importFramesFromDisk();
      break;
    case 'import-spritesheet':
      app.importSpriteSheetFromDisk();
      break;
    case 'export-png':
      app.promptExport('png');
      break;
    case 'export-jpg':
      app.promptExport('jpg');
      break;
    case 'undo':
      app.undo();
      break;
    case 'redo':
      app.redo();
      break;
    case 'brightness-contrast':
      app.openBrightnessContrastDialog();
      break;
    case 'hue-saturation':
      app.openHueSaturationDialog();
      break;
    case 'grayscale':
      app.applyGrayscale();
      break;
    case 'invert':
      app.applyInvert();
      break;
    case 'palettes-manage':
      document.getElementById('sidebar').scrollIntoView({ behavior: 'smooth', block: 'start' });
      break;
    case 'palettes-save':
      app.exportPaletteSet();
      break;
    case 'palettes-load':
      app.importPaletteSetFromDisk();
      break;
    default:
      console.warn('menu.js: no handler wired for action', action);
  }
}

function refreshMenuState(app) {
  const undoItem = document.querySelector('[data-action="undo"]');
  const redoItem = document.querySelector('[data-action="redo"]');
  if (undoItem) undoItem.disabled = !app.history.canUndo();
  if (redoItem) redoItem.disabled = !app.history.canRedo();
}

window.PAE = window.PAE || {};
window.PAE.initMenu = initMenu;
