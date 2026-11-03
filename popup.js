document.addEventListener('DOMContentLoaded', () => {
  const keys = [
    'spoofVisibility',
    'spoofFocus',
    'spoofFullscreen',
    'blockMouseLeave',
    'bypassKeyboardBlocks',
    'spoofPrintScreen',
    'enableExternalPaste',
    'unthrottleTimers',
    'antiFingerprinting',
    'spoofExtensionDisabler',
    'spoofStorageEvents',
    'spoofBroadcastChannel',
    'spoofSharedWorker'
  ];

  // Load current settings
  chrome.storage.local.get(keys, (items) => {
    keys.forEach((key) => {
      const checkbox = document.getElementById(key);
      if (checkbox) {
        checkbox.checked = items[key] !== false; // Default to true if undefined
        checkbox.addEventListener('change', (e) => {
          chrome.storage.local.set({ [key]: e.target.checked });
        });
      }
    });
  });
});
