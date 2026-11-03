(function () {
  'use strict';

  // Configurable state toggles
  const config = {
    spoofVisibility: true,
    spoofFocus: true,
    spoofFullscreen: true,
    blockMouseLeave: true,
    bypassKeyboardBlocks: true,
    spoofPrintScreen: true,
    enableExternalPaste: true,
    antiFingerprinting: true,
    unthrottleTimers: true,
    spoofExtensionDisabler: true,
    spoofStorageEvents: true,
    spoofBroadcastChannel: true,
    spoofSharedWorker: true
  };

  // Listen for config updates from content script
  window.addEventListener('message', (event) => {
    if (event.data && event.data.type === '__VISIBILITY_GUARD_CONFIG__') {
      Object.assign(config, event.data.config);
    }
  });

  // Save original native references
  const origAddEventListener = EventTarget.prototype.addEventListener;
  const origRemoveEventListener = EventTarget.prototype.removeEventListener;
  const origGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
  const origToString = Function.prototype.toString;
  const realHiddenGetter = origGetOwnPropertyDescriptor(Document.prototype, 'hidden')?.get;
  const realVisibilityStateGetter = origGetOwnPropertyDescriptor(Document.prototype, 'visibilityState')?.get;
  const origPortPostMessage = typeof MessagePort !== 'undefined' ? MessagePort.prototype.postMessage : null;
  const origPortStart = typeof MessagePort !== 'undefined' ? MessagePort.prototype.start : null;
  const origPortClose = typeof MessagePort !== 'undefined' ? MessagePort.prototype.close : null;

  // Track custom spoofed functions to pass toString() detection
  const spoofedFunctions = new WeakSet();

  function markNative(fn, name) {
    if (typeof fn === 'function') {
      if (name) {
        try {
          Object.defineProperty(fn, 'name', { value: name, configurable: true });
        } catch (e) {}
      }
      spoofedFunctions.add(fn);
    }
    return fn;
  }

  // --------------------------------------------------------------------------
  // ANTI-FINGERPRINTING: Function.prototype.toString Masking
  // --------------------------------------------------------------------------
  try {
    const maskedToString = function toString() {
      if (spoofedFunctions.has(this)) {
        return `function ${this.name || ''}() { [native code] }`;
      }
      return origToString.apply(this, arguments);
    };
    markNative(maskedToString, 'toString');
    Function.prototype.toString = maskedToString;
  } catch (e) {}

  // --------------------------------------------------------------------------
  // 1. PAGE VISIBILITY & LIFECYCLE API SPOOFING
  // --------------------------------------------------------------------------
  const hiddenGetter = markNative(function hidden() {
    if (config.spoofVisibility) return false;
    return realHiddenGetter ? realHiddenGetter.call(this) : false;
  }, 'get hidden');

  const visibilityStateGetter = markNative(function visibilityState() {
    if (config.spoofVisibility) return 'visible';
    return realVisibilityStateGetter ? realVisibilityStateGetter.call(this) : 'visible';
  }, 'get visibilityState');

  const webkitHiddenGetter = markNative(function webkitHidden() {
    if (config.spoofVisibility) return false;
    return origGetOwnPropertyDescriptor(Document.prototype, 'webkitHidden')?.get?.call(this) ?? false;
  }, 'get webkitHidden');

  const webkitVisibilityStateGetter = markNative(function webkitVisibilityState() {
    if (config.spoofVisibility) return 'visible';
    return origGetOwnPropertyDescriptor(Document.prototype, 'webkitVisibilityState')?.get?.call(this) ?? 'visible';
  }, 'get webkitVisibilityState');

  try {
    Object.defineProperty(Document.prototype, 'hidden', {
      get: hiddenGetter,
      configurable: true,
      enumerable: true
    });

    Object.defineProperty(Document.prototype, 'visibilityState', {
      get: visibilityStateGetter,
      configurable: true,
      enumerable: true
    });

    Object.defineProperty(Document.prototype, 'webkitHidden', {
      get: webkitHiddenGetter,
      configurable: true,
      enumerable: true
    });

    Object.defineProperty(Document.prototype, 'webkitVisibilityState', {
      get: webkitVisibilityStateGetter,
      configurable: true,
      enumerable: true
    });
  } catch (e) {
    console.warn('[Visibility Guard] Failed to override visibility getters:', e);
  }

  // --------------------------------------------------------------------------
  // 2. WINDOW FOCUS / BLUR SPOOFING
  // --------------------------------------------------------------------------
  let spoofedHasFocus = null;
  try {
    const origHasFocus = Document.prototype.hasFocus;
    spoofedHasFocus = markNative(function hasFocus() {
      if (config.spoofFocus) return true;
      return origHasFocus ? origHasFocus.call(this) : true;
    }, 'hasFocus');

    Document.prototype.hasFocus = spoofedHasFocus;
    window.hasFocus = spoofedHasFocus;
  } catch (e) {}

  // --------------------------------------------------------------------------
  // HARDEN Object.getOwnPropertyDescriptor DETECTION
  // --------------------------------------------------------------------------
  try {
    Object.getOwnPropertyDescriptor = markNative(function getOwnPropertyDescriptor(target, property) {
      const desc = origGetOwnPropertyDescriptor(target, property);
      if (config.antiFingerprinting && target === Document.prototype) {
        if (property === 'hidden') return { get: hiddenGetter, set: undefined, enumerable: true, configurable: true };
        if (property === 'visibilityState') return { get: visibilityStateGetter, set: undefined, enumerable: true, configurable: true };
        if (property === 'webkitHidden') return { get: webkitHiddenGetter, set: undefined, enumerable: true, configurable: true };
        if (property === 'webkitVisibilityState') return { get: webkitVisibilityStateGetter, set: undefined, enumerable: true, configurable: true };
        if (property === 'hasFocus') return { value: spoofedHasFocus, writable: true, enumerable: true, configurable: true };
      }
      return desc;
    }, 'getOwnPropertyDescriptor');
  } catch (e) {}

  // Inline event handlers trap (e.g., window.onblur = fn, document.onvisibilitychange = fn, window.onstorage = fn, window.onmouseleave = fn)
  ['onblur', 'onfocus', 'onvisibilitychange', 'onpagehide', 'onunload', 'onstorage', 'onmouseleave', 'onmouseout', 'onpointerleave'].forEach((prop) => {
    [window, Document.prototype, HTMLElement.prototype].forEach((target) => {
      try {
        let realHandler = null;
        Object.defineProperty(target, prop, {
          get: markNative(() => realHandler, `get ${prop}`),
          set: markNative((fn) => {
            realHandler = function (e) {
              if (config.spoofFocus && (prop === 'onblur' || prop === 'onfocus')) return;
              if (config.spoofVisibility && ['onvisibilitychange', 'onpagehide', 'onunload'].includes(prop)) return;
              if (config.spoofStorageEvents && prop === 'onstorage') return;
              if (config.blockMouseLeave && ['onmouseleave', 'onmouseout', 'onpointerleave'].includes(prop)) return;
              if (typeof fn === 'function') fn.call(this, e);
            };
          }, `set ${prop}`),
          configurable: true
        });
      } catch (e) {}
    });
  });

  // --------------------------------------------------------------------------
  // 3. FULLSCREEN API SPOOFING
  // --------------------------------------------------------------------------
  let mockedFullscreenElement = null;

  try {
    const origRequestFullscreen = Element.prototype.requestFullscreen;
    Element.prototype.requestFullscreen = markNative(function requestFullscreen(...args) {
      if (config.spoofFullscreen) {
        mockedFullscreenElement = this;
        document.dispatchEvent(new Event('fullscreenchange', { bubbles: true }));
        return Promise.resolve();
      }
      return origRequestFullscreen.apply(this, args);
    }, 'requestFullscreen');

    Document.prototype.exitFullscreen = markNative(function exitFullscreen() {
      if (config.spoofFullscreen) {
        mockedFullscreenElement = null;
        document.dispatchEvent(new Event('fullscreenchange', { bubbles: true }));
        return Promise.resolve();
      }
      return Document.prototype.exitFullscreen.apply(this, arguments);
    }, 'exitFullscreen');

    Object.defineProperty(Document.prototype, 'fullscreenElement', {
      get: markNative(function fullscreenElement() {
        if (config.spoofFullscreen) {
          return mockedFullscreenElement || document.documentElement;
        }
        return origGetOwnPropertyDescriptor(Document.prototype, 'fullscreenElement')?.get?.call(this) ?? null;
      }, 'get fullscreenElement'),
      configurable: true
    });

    Object.defineProperty(Document.prototype, 'fullscreenEnabled', {
      get: markNative(() => true, 'get fullscreenEnabled'),
      configurable: true
    });
  } catch (e) {}

  // --------------------------------------------------------------------------
  // 4. TIMING SIDE CHANNEL MITIGATION: Unthrottling requestAnimationFrame
  // --------------------------------------------------------------------------
  const origRAF = window.requestAnimationFrame;
  const origCAF = window.cancelAnimationFrame;
  const rafMap = new Map();
  let rafIdCounter = 0;

  window.requestAnimationFrame = markNative(function requestAnimationFrame(callback) {
    if (!config.unthrottleTimers || !config.spoofVisibility) {
      return origRAF.call(window, callback);
    }
    // If tab is actually hidden by OS/browser, run callback on synthetic ~60fps timer
    const isRealHidden = realHiddenGetter ? realHiddenGetter.call(document) : false;
    if (isRealHidden) {
      const id = ++rafIdCounter;
      const handle = setTimeout(() => {
        rafMap.delete(id);
        if (typeof callback === 'function') {
          callback(performance.now());
        }
      }, 1000 / 60);
      rafMap.set(id, handle);
      return id;
    }
    return origRAF.call(window, callback);
  }, 'requestAnimationFrame');

  window.cancelAnimationFrame = markNative(function cancelAnimationFrame(id) {
    if (rafMap.has(id)) {
      clearTimeout(rafMap.get(id));
      rafMap.delete(id);
    } else {
      origCAF.call(window, id);
    }
  }, 'cancelAnimationFrame');

  // Helper to identify PrintScreen keydown / keyup / screenshot key events
  function isPrintScreenEvent(e) {
    if (!e) return false;
    const key = String(e.key || '').toLowerCase();
    const code = String(e.code || '').toLowerCase();
    const keyCode = e.keyCode || e.which || 0;

    if (
      key === 'printscreen' ||
      key === 'prtscn' ||
      key === 'snapshot' ||
      code === 'printscreen' ||
      keyCode === 44
    ) {
      return true;
    }
    // Screenshot shortcut combinations (e.g. Win+Shift+S, Meta+Shift+S, Meta+Shift+3, Meta+Shift+4)
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && (key === 's' || key === '3' || key === '4' || code === 'keys' || code === 'key3' || code === 'key4')) {
      return true;
    }
    return false;
  }

  // --------------------------------------------------------------------------
  // 5. EVENT LISTENER INTERCEPTION (Visibility, Blur, Mouse, Keys, PrintScreen)
  // --------------------------------------------------------------------------
  const listenerMap = new WeakMap();

  EventTarget.prototype.addEventListener = markNative(function addEventListener(type, listener, options) {
    if (!listener) return origAddEventListener.apply(this, arguments);

    let wrappedListener = listener;

    if (typeof listener === 'function' || (typeof listener === 'object' && listener !== null && typeof listener.handleEvent === 'function')) {
      if (listenerMap.has(listener)) {
        wrappedListener = listenerMap.get(listener);
      } else {
        wrappedListener = function (event) {
          if (!event) {
            return typeof listener === 'function' ? listener.apply(this, arguments) : listener.handleEvent(event);
          }

          // Visibility & Page Lifecycle events (visibilitychange, freeze, pagehide, unload)
          if (config.spoofVisibility) {
            if (['visibilitychange', 'webkitvisibilitychange', 'freeze', 'pagehide', 'unload'].includes(event.type)) {
              event.stopImmediatePropagation();
              return;
            }
          }

          // Storage events (localStorage write events in other tabs)
          if (config.spoofStorageEvents) {
            if (event.type === 'storage') {
              event.stopImmediatePropagation();
              return;
            }
          }

          // Focus events (blur, focusout, focus, focusin)
          if (config.spoofFocus) {
            if (['blur', 'focusout', 'focus', 'focusin'].includes(event.type)) {
              event.stopImmediatePropagation();
              return;
            }
          }

          // Mouse-leave / Boundary tracking (block whenever leaving document/window)
          if (config.blockMouseLeave) {
            if (['mouseleave', 'mouseout', 'pointerleave', 'dragleave'].includes(event.type)) {
              event.stopImmediatePropagation();
              event.stopPropagation();
              if (typeof event.preventDefault === 'function') {
                event.preventDefault();
              }
              return;
            }
          }

          // PrintScreen Keydown / Screenshot Protection & Spoofing
          if (config.spoofPrintScreen || config.bypassKeyboardBlocks) {
            if (['keydown', 'keyup', 'keypress'].includes(event.type)) {
              if (isPrintScreenEvent(event)) {
                event.stopImmediatePropagation();
                event.stopPropagation();
                if (typeof event.preventDefault === 'function') {
                  event.preventDefault();
                }
                return;
              }
            }
          }

          // Keyboard Shortcut Protection
          if (config.bypassKeyboardBlocks) {
            if (['keydown', 'keyup', 'keypress'].includes(event.type)) {
              if (event.ctrlKey || event.altKey || event.metaKey || event.key === 'F11' || event.key === 'Escape' || ['Control', 'Alt', 'Meta', 'Shift', 'F11', 'Escape'].includes(event.key)) {
                event.stopImmediatePropagation();
                event.stopPropagation();
                return;
              }
            }
          }

          return typeof listener === 'function' ? listener.apply(this, arguments) : listener.handleEvent(event);
        };

        markNative(wrappedListener, typeof listener === 'function' ? (listener.name || '') : '');
        listenerMap.set(listener, wrappedListener);
      }
    }

    const effectiveType = type === 'unload' ? 'pagehide' : type;
    return origAddEventListener.call(this, effectiveType, wrappedListener, options);
  }, 'addEventListener');

  EventTarget.prototype.removeEventListener = markNative(function removeEventListener(type, listener, options) {
    if (!listener) return origRemoveEventListener.apply(this, arguments);
    const effectiveType = type === 'unload' ? 'pagehide' : type;
    const wrappedListener = listenerMap.get(listener) || listener;
    return origRemoveEventListener.call(this, effectiveType, wrappedListener, options);
  }, 'removeEventListener');

  // Comprehensive capture phase blockers for global window, document, and body listeners
  const blockFocusLoss = (e) => {
    if (config.spoofFocus) {
      e.stopImmediatePropagation();
      e.stopPropagation();
      e.preventDefault();
    }
  };

  const blockMouseExit = (e) => {
    if (config.blockMouseLeave) {
      e.stopImmediatePropagation();
      e.stopPropagation();
      if (typeof e.preventDefault === 'function') {
        e.preventDefault();
      }
    }
  };

  ['blur', 'focusout', 'focus', 'focusin'].forEach((evt) => {
    origAddEventListener.call(window, evt, blockFocusLoss, true);
    origAddEventListener.call(document, evt, blockFocusLoss, true);
  });

  ['mouseleave', 'mouseout', 'pointerleave', 'dragleave'].forEach((evt) => {
    origAddEventListener.call(window, evt, blockMouseExit, true);
    origAddEventListener.call(document, evt, blockMouseExit, true);
  });

  ['visibilitychange', 'pagehide', 'freeze'].forEach((evt) => {
    origAddEventListener.call(window, evt, (e) => {
      if (config.spoofVisibility) {
        e.stopImmediatePropagation();
        e.stopPropagation();
        if (typeof e.preventDefault === 'function') e.preventDefault();
      }
    }, true);
    origAddEventListener.call(document, evt, (e) => {
      if (config.spoofVisibility) {
        e.stopImmediatePropagation();
        e.stopPropagation();
        if (typeof e.preventDefault === 'function') e.preventDefault();
      }
    }, true);
  });

  origAddEventListener.call(window, 'storage', (e) => {
    if (config.spoofStorageEvents) {
      e.stopImmediatePropagation();
      e.stopPropagation();
      if (typeof e.preventDefault === 'function') {
        e.preventDefault();
      }
    }
  }, true);

  const blockKeyShortcuts = (e) => {
    if (config.spoofPrintScreen || config.bypassKeyboardBlocks) {
      if (isPrintScreenEvent(e)) {
        e.stopImmediatePropagation();
        e.stopPropagation();
        if (typeof e.preventDefault === 'function') {
          e.preventDefault();
        }
        return;
      }
    }

    if (config.bypassKeyboardBlocks) {
      if (e.ctrlKey || e.altKey || e.metaKey || e.key === 'F11' || e.key === 'Escape' || ['Control', 'Alt', 'Meta', 'Shift', 'F11', 'Escape'].includes(e.key)) {
        e.stopImmediatePropagation();
        e.stopPropagation();
      }
    }
  };

  ['keydown', 'keyup', 'keypress'].forEach((evt) => {
    origAddEventListener.call(window, evt, blockKeyShortcuts, true);
    origAddEventListener.call(document, evt, blockKeyShortcuts, true);
  });

  // Trap inline keyboard handlers (e.g. window.onkeydown, document.onkeydown)
  ['onkeydown', 'onkeyup', 'onkeypress'].forEach((prop) => {
    [window, Document.prototype, HTMLElement.prototype].forEach((target) => {
      try {
        let realKeyHandler = null;
        Object.defineProperty(target, prop, {
          get: markNative(() => realKeyHandler, `get ${prop}`),
          set: markNative((fn) => {
            realKeyHandler = function (e) {
              if ((config.spoofPrintScreen || config.bypassKeyboardBlocks) && isPrintScreenEvent(e)) return;
              if (typeof fn === 'function') fn.call(this, e);
            };
          }, `set ${prop}`),
          configurable: true
        });
      } catch (e) {}
    });
  });

  // --------------------------------------------------------------------------
  // 6. PASTE ENABLER (Bypass website paste restrictions)
  // --------------------------------------------------------------------------
  const allowPasteHandler = (e) => {
    if (config.enableExternalPaste) {
      // Prevent web scripts from blocking native paste actions
      e.stopImmediatePropagation();
    }
  };

  window.addEventListener('paste', allowPasteHandler, true);
  document.addEventListener('paste', allowPasteHandler, true);

  // Trap inline onpaste handlers
  [window, Document.prototype, HTMLElement.prototype].forEach((target) => {
    try {
      let realPasteHandler = null;
      Object.defineProperty(target, 'onpaste', {
        get: markNative(() => realPasteHandler, 'get onpaste'),
        set: markNative((fn) => {
          realPasteHandler = function (e) {
            if (config.enableExternalPaste) return;
            if (typeof fn === 'function') fn.call(this, e);
          };
        }, 'set onpaste'),
        configurable: true
      });
    } catch (e) {}
  });

  // --------------------------------------------------------------------------
  // 7. EXTENSION DISABLER & SCANNER SPOOFING (Universal Pattern Interceptor)
  // Handles getEnabledCount / disable / enable across sendMessage, connect, and management APIs
  // --------------------------------------------------------------------------
  try {
    if (typeof window !== 'undefined') {
      window.chrome = window.chrome || {};
      window.chrome.runtime = window.chrome.runtime || {};

      const origSendMessage = window.chrome.runtime.sendMessage;

      const spoofedSendMessage = markNative(function sendMessage(...args) {
        if (!config.spoofExtensionDisabler) {
          return origSendMessage ? origSendMessage.apply(this, args) : undefined;
        }

        let request = null;
        let responseCallback = null;

        // Parse arguments: (extensionId?, message, options?, responseCallback?)
        if (typeof args[0] === 'string' && typeof args[1] === 'object') {
          request = args[1];
          if (typeof args[2] === 'function') responseCallback = args[2];
          else if (typeof args[3] === 'function') responseCallback = args[3];
        } else if (typeof args[0] === 'object') {
          request = args[0];
          if (typeof args[1] === 'function') responseCallback = args[1];
          else if (typeof args[2] === 'function') responseCallback = args[2];
        }

        if (request && typeof request === 'object') {
          const msgVal = String(request.message || request.type || request.action || request.cmd || request.command || '').trim();

          // 1. Universal "getEnabledCount" / extension count scanner
          if (msgVal === 'getEnabledCount' || msgVal === 'getExtensionsCount' || msgVal === 'getExtensions') {
            const fakeResponse = {
              response: 'extensions count',
              extensionsCount: 0,
              enabledExtensionNames: []
            };
            if (typeof responseCallback === 'function') {
              setTimeout(() => responseCallback(fakeResponse), 0);
            }
            return Promise.resolve(fakeResponse);
          }

          // 2. Universal "disable" (Fake disabling all extensions without doing anything)
          if (msgVal === 'disable' || msgVal === 'disableExtensions') {
            const fakeResponse = {
              response: 'disabled extensions',
              disableExtensionsList: [],
              disabledExtensions: [],
              extensionsFailedToDisable: []
            };
            if (typeof responseCallback === 'function') {
              setTimeout(() => responseCallback(fakeResponse), 0);
            }
            return Promise.resolve(fakeResponse);
          }

          // 3. Universal "enable"
          if (msgVal === 'enable' || msgVal === 'enableExtensions') {
            const fakeResponse = {
              response: 'enabled extensions',
              disableExtensionsList: request.data || []
            };
            if (typeof responseCallback === 'function') {
              setTimeout(() => responseCallback(fakeResponse), 0);
            }
            return Promise.resolve(fakeResponse);
          }
        }

        if (origSendMessage) {
          return origSendMessage.apply(this, args);
        }
      }, 'sendMessage');

      window.chrome.runtime.sendMessage = spoofedSendMessage;

      // Intercept chrome.runtime.connect (Port connections)
      const origConnect = window.chrome.runtime.connect;
      if (origConnect) {
        window.chrome.runtime.connect = markNative(function connect(...args) {
          if (!config.spoofExtensionDisabler) {
            return origConnect.apply(this, args);
          }
          const port = origConnect.apply(this, args);
          if (port && port.postMessage) {
            const origPortPostMessage = port.postMessage;
            port.postMessage = markNative(function postMessage(msg) {
              if (msg && typeof msg === 'object') {
                const msgVal = String(msg.message || msg.type || msg.action || '').trim();
                if (['getEnabledCount', 'disable', 'enable'].includes(msgVal)) {
                  return;
                }
              }
              return origPortPostMessage.apply(this, arguments);
            }, 'postMessage');
          }
          return port;
        }, 'connect');
      }

      // Intercept chrome.management API if exposed
      window.chrome.management = window.chrome.management || {};
      const origGetAll = window.chrome.management.getAll;
      const origSetEnabled = window.chrome.management.setEnabled;

      window.chrome.management.getAll = markNative(function getAll(callback) {
        if (config.spoofExtensionDisabler) {
          const fakeExtensions = [];
          if (typeof callback === 'function') {
            setTimeout(() => callback(fakeExtensions), 0);
          }
          return Promise.resolve(fakeExtensions);
        }
        return origGetAll ? origGetAll.apply(this, arguments) : Promise.resolve([]);
      }, 'getAll');

      window.chrome.management.setEnabled = markNative(function setEnabled(id, enabled, callback) {
        if (config.spoofExtensionDisabler) {
          if (typeof callback === 'function') {
            setTimeout(() => callback(), 0);
          }
          return Promise.resolve();
        }
        return origSetEnabled ? origSetEnabled.apply(this, arguments) : Promise.resolve();
      }, 'setEnabled');
    }
  } catch (e) {
    console.warn('[Visibility Guard] Extension disabler spoofing error:', e);
  }

  // --------------------------------------------------------------------------
  // 8. BROADCASTCHANNEL API SPOOFING & MULTI-TAB ISOLATION
  // --------------------------------------------------------------------------
  try {
    const origBroadcastChannel = typeof window !== 'undefined' ? window.BroadcastChannel : undefined;
    const tabLocalChannels = new Map();

    function SpoofedBroadcastChannel(name) {
      if (!(this instanceof SpoofedBroadcastChannel)) {
        throw new TypeError("Failed to construct 'BroadcastChannel': Please use the 'new' operator");
      }

      const channelName = String(name);
      this._name = channelName;
      this._closed = false;
      this._onmessage = null;
      this._onmessageerror = null;
      this._eventTarget = new EventTarget();

      let realChannel = null;
      if (origBroadcastChannel) {
        try {
          realChannel = new origBroadcastChannel(channelName);
        } catch (e) {}
      }
      this._realChannel = realChannel;

      if (!tabLocalChannels.has(channelName)) {
        tabLocalChannels.set(channelName, new Set());
      }
      tabLocalChannels.get(channelName).add(this);

      if (realChannel) {
        realChannel.onmessage = (event) => {
          if (config.spoofBroadcastChannel) return;
          this._dispatchMessageEvent('message', event.data, event.origin);
        };

        realChannel.onmessageerror = (event) => {
          if (config.spoofBroadcastChannel) return;
          this._dispatchMessageEvent('messageerror', event.data, event.origin);
        };
      }
    }

    SpoofedBroadcastChannel.prototype = Object.create(EventTarget.prototype);
    SpoofedBroadcastChannel.prototype.constructor = SpoofedBroadcastChannel;

    Object.defineProperty(SpoofedBroadcastChannel.prototype, 'name', {
      get: markNative(function name() {
        return this._name;
      }, 'get name'),
      configurable: true,
      enumerable: true
    });

    Object.defineProperty(SpoofedBroadcastChannel.prototype, 'onmessage', {
      get: markNative(function onmessage() {
        return this._onmessage;
      }, 'get onmessage'),
      set: markNative(function onmessage(fn) {
        this._onmessage = typeof fn === 'function' ? fn : null;
      }, 'set onmessage'),
      configurable: true,
      enumerable: true
    });

    Object.defineProperty(SpoofedBroadcastChannel.prototype, 'onmessageerror', {
      get: markNative(function onmessageerror() {
        return this._onmessageerror;
      }, 'get onmessageerror'),
      set: markNative(function onmessageerror(fn) {
        this._onmessageerror = typeof fn === 'function' ? fn : null;
      }, 'set onmessageerror'),
      configurable: true,
      enumerable: true
    });

    SpoofedBroadcastChannel.prototype._dispatchMessageEvent = function (type, data, origin) {
      if (this._closed) return;
      const evt = new MessageEvent(type, {
        data: data,
        origin: origin || window.location.origin
      });

      if (type === 'message' && typeof this._onmessage === 'function') {
        try { this._onmessage.call(this, evt); } catch (e) {}
      } else if (type === 'messageerror' && typeof this._onmessageerror === 'function') {
        try { this._onmessageerror.call(this, evt); } catch (e) {}
      }

      try {
        this._eventTarget.dispatchEvent(evt);
      } catch (e) {}
    };

    SpoofedBroadcastChannel.prototype.postMessage = markNative(function postMessage(message) {
      if (this._closed) {
        throw new DOMException("Failed to execute 'postMessage' on 'BroadcastChannel': Channel is closed.", "InvalidStateError");
      }

      let clonedData = message;
      try {
        clonedData = JSON.parse(JSON.stringify(message));
      } catch (e) {}

      if (config.spoofBroadcastChannel) {
        const localSet = tabLocalChannels.get(this._name);
        if (localSet) {
          localSet.forEach((otherInstance) => {
            if (otherInstance !== this && !otherInstance._closed) {
              setTimeout(() => {
                otherInstance._dispatchMessageEvent('message', clonedData, window.location.origin);
              }, 0);
            }
          });
        }
      } else {
        if (this._realChannel) {
          this._realChannel.postMessage(message);
        }
      }
    }, 'postMessage');

    SpoofedBroadcastChannel.prototype.close = markNative(function close() {
      if (this._closed) return;
      this._closed = true;

      const localSet = tabLocalChannels.get(this._name);
      if (localSet) {
        localSet.delete(this);
        if (localSet.size === 0) {
          tabLocalChannels.delete(this._name);
        }
      }

      if (this._realChannel) {
        try { this._realChannel.close(); } catch (e) {}
      }
    }, 'close');

    SpoofedBroadcastChannel.prototype.addEventListener = markNative(function addEventListener(type, listener, options) {
      this._eventTarget.addEventListener(type, listener, options);
    }, 'addEventListener');

    SpoofedBroadcastChannel.prototype.removeEventListener = markNative(function removeEventListener(type, listener, options) {
      this._eventTarget.removeEventListener(type, listener, options);
    }, 'removeEventListener');

    markNative(SpoofedBroadcastChannel, 'BroadcastChannel');

    window.BroadcastChannel = SpoofedBroadcastChannel;
  } catch (e) {
    console.warn('[Visibility Guard] BroadcastChannel spoofing error:', e);
  }

  // --------------------------------------------------------------------------
  // 9. SHAREDWORKER API SPOOFING & MULTI-TAB ISOLATION
  // --------------------------------------------------------------------------
  try {
    const origSharedWorker = typeof window !== 'undefined' ? window.SharedWorker : undefined;

    function sanitizeSharedWorkerPayload(data) {
      if (!data || typeof data !== 'object') return data;

      try {
        const sanitized = JSON.parse(JSON.stringify(data));

        const countKeys = ['tabCount', 'count', 'tabsCount', 'tabs', 'activeTabs', 'connectedTabs', 'totalTabs', 'connections', 'clientsCount'];
        countKeys.forEach((key) => {
          if (typeof sanitized[key] === 'number') {
            sanitized[key] = 1;
          }
        });

        const boolKeys = ['isMultiTab', 'hasMultipleTabs', 'duplicateTab', 'tabConflict', 'isDuplicate', 'multipleTabs', 'conflict'];
        boolKeys.forEach((key) => {
          if (typeof sanitized[key] === 'boolean') {
            sanitized[key] = false;
          }
        });

        const listKeys = ['activeTabIds', 'connectedTabIds', 'tabList', 'clients', 'tabIds'];
        listKeys.forEach((key) => {
          if (Array.isArray(sanitized[key])) {
            sanitized[key] = sanitized[key].slice(0, 1);
          }
        });

        return sanitized;
      } catch (e) {
        return data;
      }
    }

    function SpoofedSharedWorker(scriptURL, options) {
      if (!(this instanceof SpoofedSharedWorker)) {
        throw new TypeError("Failed to construct 'SharedWorker': Please use the 'new' operator");
      }

      let realWorker = null;
      if (origSharedWorker) {
        try {
          if (typeof options !== 'undefined') {
            realWorker = new origSharedWorker(scriptURL, options);
          } else {
            realWorker = new origSharedWorker(scriptURL);
          }
        } catch (e) {}
      }

      const channel = new MessageChannel();
      const localPort = channel.port1;
      const remotePort = channel.port2;

      let targetPort = localPort;
      if (realWorker) {
        try {
          targetPort = realWorker.port || localPort;
        } catch (e) {
          targetPort = localPort;
        }
      }

      const portProxy = {
        _onmessage: null,
        _onmessageerror: null,
        _listeners: new Map()
      };

      const selfWorker = this;
      this._realWorker = realWorker;

      const handleIncomingMessage = (e) => {
        let messageData = e.data;
        if (config.spoofSharedWorker) {
          messageData = sanitizeSharedWorkerPayload(messageData);
        }

        const spoofedEvt = new MessageEvent('message', {
          data: messageData,
          origin: e.origin || window.location.origin,
          ports: e.ports
        });

        if (typeof portProxy._onmessage === 'function') {
          try { portProxy._onmessage.call(proxiedPort, spoofedEvt); } catch (err) {}
        }

        if (portProxy._listeners.has('message')) {
          portProxy._listeners.get('message').forEach((fn) => {
            try { fn.call(proxiedPort, spoofedEvt); } catch (err) {}
          });
        }
      };

      if (origPortStart) {
        try { origPortStart.call(targetPort); } catch (e) {}
      } else if (targetPort && typeof targetPort.start === 'function') {
        try { targetPort.start(); } catch (e) {}
      }

      try {
        targetPort.onmessage = handleIncomingMessage;
      } catch (e) {}

      const proxiedPort = Object.create(MessagePort.prototype);

      proxiedPort.postMessage = markNative(function postMessage(msg, transfer) {
        if (realWorker && targetPort) {
          try {
            if (origPortPostMessage) {
              origPortPostMessage.call(targetPort, msg, transfer);
            } else {
              targetPort.postMessage(msg, transfer);
            }
          } catch (e) {
            try {
              if (origPortPostMessage) {
                origPortPostMessage.call(targetPort, msg);
              } else {
                targetPort.postMessage(msg);
              }
            } catch (err) {}
          }
        } else {
          if (config.spoofSharedWorker && msg && typeof msg === 'object') {
            const msgType = String(msg.type || msg.action || msg.cmd || '').toLowerCase();
            if (msgType.includes('count') || msgType.includes('tab') || msgType.includes('ping') || msgType.includes('get')) {
              setTimeout(() => {
                const reply = sanitizeSharedWorkerPayload({
                  type: msg.type || 'response',
                  tabCount: 1,
                  activeTabs: 1,
                  isMultiTab: false,
                  status: 'ok'
                });
                if (origPortPostMessage) {
                  origPortPostMessage.call(remotePort, reply);
                } else {
                  remotePort.postMessage(reply);
                }
              }, 0);
            }
          }
        }
      }, 'postMessage');

      proxiedPort.start = markNative(function start() {
        if (origPortStart) {
          try { origPortStart.call(targetPort); } catch (e) {}
        } else if (targetPort && typeof targetPort.start === 'function') {
          try { targetPort.start(); } catch (e) {}
        }
      }, 'start');

      proxiedPort.close = markNative(function close() {
        if (origPortClose) {
          try { origPortClose.call(targetPort); } catch (e) {}
        } else if (targetPort && typeof targetPort.close === 'function') {
          try { targetPort.close(); } catch (e) {}
        }
      }, 'close');

      proxiedPort.addEventListener = markNative(function addEventListener(type, listener, options) {
        if (typeof listener === 'function') {
          if (!portProxy._listeners.has(type)) {
            portProxy._listeners.set(type, new Set());
          }
          portProxy._listeners.get(type).add(listener);
        }
      }, 'addEventListener');

      proxiedPort.removeEventListener = markNative(function removeEventListener(type, listener, options) {
        if (portProxy._listeners.has(type)) {
          portProxy._listeners.get(type).delete(listener);
        }
      }, 'removeEventListener');

      Object.defineProperty(proxiedPort, 'onmessage', {
        get: markNative(() => portProxy._onmessage, 'get onmessage'),
        set: markNative((fn) => {
          portProxy._onmessage = typeof fn === 'function' ? fn : null;
        }, 'set onmessage'),
        configurable: true,
        enumerable: true
      });

      Object.defineProperty(proxiedPort, 'onmessageerror', {
        get: markNative(() => portProxy._onmessageerror, 'get onmessageerror'),
        set: markNative((fn) => {
          portProxy._onmessageerror = typeof fn === 'function' ? fn : null;
        }, 'set onmessageerror'),
        configurable: true,
        enumerable: true
      });

      Object.defineProperty(this, 'port', {
        value: proxiedPort,
        writable: false,
        configurable: true,
        enumerable: true
      });

      if (realWorker) {
        realWorker.onerror = (err) => {
          if (typeof selfWorker.onerror === 'function') selfWorker.onerror(err);
        };
      }
    }

    SpoofedSharedWorker.prototype = Object.create(origSharedWorker ? origSharedWorker.prototype : Object.prototype);
    SpoofedSharedWorker.prototype.constructor = SpoofedSharedWorker;

    Object.defineProperty(SpoofedSharedWorker.prototype, 'port', {
      get: markNative(function getPort() {
        return this._port;
      }, 'get port'),
      configurable: true,
      enumerable: true
    });

    markNative(SpoofedSharedWorker, 'SharedWorker');

    window.SharedWorker = SpoofedSharedWorker;
  } catch (e) {
    console.warn('[Visibility Guard] SharedWorker spoofing error:', e);
  }

  console.log('[Visibility Guard] Anti-detection & main-world spoofing active.');
})();
