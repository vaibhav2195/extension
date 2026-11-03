// Background service worker for Page Visibility & Focus Guard
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({
    enabled: true,
    spoofVisibility: true,
    spoofFocus: true,
    spoofFullscreen: true,
    blockMouseLeave: true,
    bypassKeyboardBlocks: true,
    spoofPrintScreen: true,
    enableExternalPaste: true,
    unthrottleTimers: true,
    antiFingerprinting: true,
    spoofExtensionDisabler: true
  });
  console.log('[Visibility Guard] Extension installed and hardened default settings initialized.');
});
