(function () {
  'use strict';

  // Inject `inject.js` into the webpage main world
  function injectScript() {
    try {
      const script = document.createElement('script');
      script.src = chrome.runtime.getURL('inject.js');
      script.onload = function () {
        this.remove();
        syncConfig();
      };
      (document.head || document.documentElement).appendChild(script);
    } catch (e) {
      console.error('[Visibility Guard] Script injection failed:', e);
    }
  }

  // Fetch extension settings and send to main world script
  function syncConfig() {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get({
        spoofVisibility: true,
        spoofFocus: true,
        spoofFullscreen: true,
        blockMouseLeave: true,
        bypassKeyboardBlocks: true,
        spoofPrintScreen: true,
        enableExternalPaste: true,
        unthrottleTimers: true,
        antiFingerprinting: true,
        spoofExtensionDisabler: true,
        spoofStorageEvents: true,
        spoofBroadcastChannel: true,
        spoofSharedWorker: true
      }, (items) => {
        window.postMessage({
          type: '__VISIBILITY_GUARD_CONFIG__',
          config: items
        }, '*');
      });
    }
  }

  // Listen for settings changes from popup
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local') {
        syncConfig();
      }
    });
  }

  injectScript();
})();
