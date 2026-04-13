/** Electron preload API, available only when running inside the desktop shell. */
interface ElectronAPI {
  minimize?: () => void;
  maximize?: () => void;
  close?: () => void;
}

interface Window {
  electron?: ElectronAPI;
}
