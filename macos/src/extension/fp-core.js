"use strict";
/**
 * 指纹伪装核心（UMD 形态）
 * - 浏览器/扩展内容脚本环境：挂到全局 window.installFingerprint
 * - Electron preload（CommonJS）环境：module.exports.installFingerprint
 *
 * 覆盖维度：
 *   navigator: webdriver / hardwareConcurrency / deviceMemory / platform / language /
 *              languages / userAgent / vendor / userAgentData(Client Hints) /
 *              maxTouchPoints / doNotTrack
 *   screen / WebGL / Canvas / Audio / WebRTC / 可选 ClientRects
 *   日期、时区与像素比使用 CDP；插件、媒体设备、字体与语音保留原生对象。
 *
 * 设计原则：同一环境 config 固定 -> 所有随机都基于 config 的确定值 -> 指纹稳定不漂移。
 */
(function (root, factory) {
  if(root && root.__FP_ACTIVE__)return;
  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.installFingerprint = api.installFingerprint;
})(typeof window !== "undefined" ? window : null, function () {
  // ---------------- 反检测：toString 原生伪装 ----------------
  // 检测方常用 Fn.toString() 判断函数是否被改写。被 patch 的函数必须回显 [native code]，
  // 否则「伪装」本身就是最强的指纹。
  var _patched = new WeakMap();
  var _fnToString = Function.prototype.toString;
  function markNative(fn, name) {
    try {
      if (typeof fn === "function") _patched.set(fn, name || fn.name || "");
    } catch (e) {}
    return fn;
  }
  try {
    var fakeToString = function toString() {
      if (_patched.has(this)) {
        return (
          "function " + (_patched.get(this) || "") + "() { [native code] }"
        );
      }
      return _fnToString.apply(this, arguments);
    };
    Function.prototype.toString = fakeToString;
    markNative(fakeToString, "toString");
  } catch (e) {}

  function def(obj, prop, getter) {
    try {
      Object.defineProperty(obj, prop, {
        get: getter,
        configurable: true,
        enumerable: true,
      });
      markNative(getter, "get " + prop);
    } catch (e) {}
  }

  function installFingerprint(CFG) {
    if (!CFG || (typeof window!=="undefined"&&window.__FP_ACTIVE__)) return;
    CFG.noise = Object.assign({canvas:false,audio:false,webgl:false,clientRects:false},CFG.noise||{});

    // ---------------- navigator 基础 ----------------
    try {
      def(Navigator.prototype, "webdriver", function () {
        return false;
      });
      def(Navigator.prototype, "hardwareConcurrency", function () {
        return CFG.hardwareConcurrency;
      });
      def(Navigator.prototype, "deviceMemory", function () {
        return CFG.deviceMemory;
      });
      // CDP owns UA, language and Client Hints, including native API validation.
      if (!CFG.protocolManaged) {
      def(Navigator.prototype, "platform", function () {
        return CFG.platform;
      });
      def(Navigator.prototype, "language", function () {
        return CFG.language;
      });
      def(Navigator.prototype, "languages", function () {
        return Object.freeze(CFG.languages.slice());
      });
      def(Navigator.prototype, "userAgent", function () {
        return CFG.userAgent;
      });
      }
      def(Navigator.prototype, "vendor", function () {
        return "Google Inc.";
      });
      def(Navigator.prototype, "maxTouchPoints", function () {
        return CFG.maxTouchPoints || 0;
      });
      def(Navigator.prototype, "doNotTrack", function () {
        return null;
      });
      // 旧版检测脚本仍读 userLanguage/browserLanguage/systemLanguage（IE 遗留属性），
      // 不覆盖则仍暴露宿主语言 -> whoer 等报「语言不一致」。对齐到伪装语言。
      def(Navigator.prototype, "userLanguage", function () {
        return CFG.language;
      });
      def(Navigator.prototype, "browserLanguage", function () {
        return CFG.language;
      });
      def(Navigator.prototype, "systemLanguage", function () {
        return CFG.language;
      });
    } catch (e) {}

    // userAgentData（Client Hints）
    try {
      if (!CFG.protocolManaged && navigator.userAgentData) {
        var uaDataPrototype = Object.getPrototypeOf(navigator.userAgentData);
        var brands = [
          { brand: "Chromium", version: CFG.chromeVersion.split(".")[0] },
          { brand: "Google Chrome", version: CFG.chromeVersion.split(".")[0] },
          { brand: "Not-A.Brand", version: "99" },
        ];
        def(uaDataPrototype, "brands", function () {
          return brands;
        });
        def(uaDataPrototype, "platform", function () {
          return CFG.os === "android"
            ? "Android"
            : CFG.os === "mac"
              ? "macOS"
              : "Windows";
        });
        def(uaDataPrototype, "mobile", function () {
          return CFG.os === "android";
        });
        // getHighEntropyValues 也要吐一致数据
        if (navigator.userAgentData.getHighEntropyValues) {
          var _hev = navigator.userAgentData.getHighEntropyValues;
          uaDataPrototype.getHighEntropyValues = markNative(function (
            hints,
          ) {
            var out = {brands:brands.concat(),mobile:CFG.os === "android",platform:CFG.os === "android"?"Android":CFG.os === "mac"?"macOS":"Windows"};
            var want = hints || [];
            if (want.indexOf("architecture") >= 0) out.architecture = CFG.os === "android"?"arm":"x86";
            if (want.indexOf("bitness") >= 0) out.bitness = "64";
            if (want.indexOf("model") >= 0) out.model = CFG.os === "android"?"SM-S918B":"";
            if (want.indexOf("platformVersion") >= 0)
              out.platformVersion =
                CFG.os === "android"
                  ? "13.0.0"
                  : CFG.os === "mac"
                    ? "14.0.0"
                    : "10.0.0";
            if (want.indexOf("fullVersionList") >= 0)
              out.fullVersionList = brands.map(function(b){return {brand:b.brand,version:b.brand==="Not-A.Brand"?"99.0.0.0":CFG.chromeVersion};});
            if (want.indexOf("uaFullVersion") >= 0) out.uaFullVersion=CFG.chromeVersion;
            if (want.indexOf("wow64") >= 0) out.wow64 = false;
            return Promise.resolve(out);
          }, "getHighEntropyValues");
        }
      }
    } catch (e) {}

    // PDF 插件、媒体设备与语音音色保留真实内核/系统对象；访问能力由网站权限控制。

    // ---------------- screen ----------------
    try {
      def(Screen.prototype, "width", function () {
        return CFG.screen.width;
      });
      def(Screen.prototype, "height", function () {
        return CFG.screen.height;
      });
      def(Screen.prototype, "availWidth", function () {
        return CFG.screen.availWidth;
      });
      def(Screen.prototype, "availHeight", function () {
        return CFG.screen.availHeight;
      });
      def(Screen.prototype, "colorDepth", function () {
        return CFG.screen.colorDepth;
      });
      def(Screen.prototype, "pixelDepth", function () {
        return CFG.screen.pixelDepth;
      });
    } catch (e) {}

    // 日期、Intl 与 Temporal 使用 CDP 设置的原生时区，保留显式时区和标准 API 语义。

    // ---------------- WebGL vendor / renderer ----------------
    try {
      if (CFG.noise.webgl) {
      var patchGL = function (proto) {
        if (!proto) return;
        var _getParameter = proto.getParameter;
        proto.getParameter = markNative(function getParameter(p) {
          if (p === 37445) return CFG.webgl.vendor;
          if (p === 37446) return CFG.webgl.renderer;
          return _getParameter.apply(this, arguments);
        }, "getParameter");
      };
      patchGL(window.WebGLRenderingContext && WebGLRenderingContext.prototype);
      patchGL(
        window.WebGL2RenderingContext && WebGL2RenderingContext.prototype,
      );
      }
    } catch (e) {}

    // ---------------- Canvas 加噪（确定性微扰）----------------
    try {
      if (CFG.noise.canvas) {
      var noiseSeed = (CFG.canvasNoise || 12345) >>> 0;
      var pixelNoise = function (idx) {
        var x = (noiseSeed ^ Math.imul(idx, 2654435761)) >>> 0;
        x ^= x >>> 15;
        x = Math.imul(x, 2246822507);
        x ^= x >>> 13;
        x = Math.imul(x, 3266489909);
        x ^= x >>> 16;
        return (x >>> 0) / 4294967296;
      };
      var perturb = function (d) {
        for (var i = 0; i < d.length; i += 4) {
          if (pixelNoise(i) < 0.02) {
            var delta = pixelNoise(i + 1) < 0.5 ? -1 : 1;
            d[i] = Math.max(0, Math.min(255, d[i] + delta));
            d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + delta));
            d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + delta));
          }
        }
      };
      var _toDataURL = HTMLCanvasElement.prototype.toDataURL;
      var _toBlob = HTMLCanvasElement.prototype.toBlob;
      var _getImageData = CanvasRenderingContext2D.prototype.getImageData;
      var shadowOf = function (canvas) {
        var w = canvas.width,
          h = canvas.height;
        if (!w || !h) return null;
        var off = document.createElement("canvas");
        off.width = w;
        off.height = h;
        var octx = off.getContext("2d");
        if (!octx) return null;
        octx.drawImage(canvas, 0, 0);
        var img = _getImageData.call(octx, 0, 0, w, h);
        perturb(img.data);
        octx.putImageData(img, 0, 0);
        return off;
      };
      HTMLCanvasElement.prototype.toDataURL = markNative(function toDataURL() {
        try {
          var off = shadowOf(this);
          if (off) return _toDataURL.apply(off, arguments);
        } catch (e) {}
        return _toDataURL.apply(this, arguments);
      }, "toDataURL");
      HTMLCanvasElement.prototype.toBlob = markNative(function toBlob() {
        try {
          var off = shadowOf(this);
          if (off) return _toBlob.apply(off, arguments);
        } catch (e) {}
        return _toBlob.apply(this, arguments);
      }, "toBlob");
      CanvasRenderingContext2D.prototype.getImageData = markNative(
        function getImageData() {
          var res = _getImageData.apply(this, arguments);
          try {
            perturb(res.data);
          } catch (e) {}
          return res;
        },
        "getImageData",
      );
      }
    } catch (e) {}

    // 字体与 TextMetrics 保留原生结果，不伪造存在的字体或度量对象。

    // ---------------- ClientRects 确定性亚像素偏移（默认关闭）----------------
    try {
      if (CFG.noise.clientRects) {
      var rn = (CFG.rectNoise || 1) >>> 0;
      var dx = ((rn % 7) - 3) / 10; // -0.3 ~ +0.3 px
      var dy = (((rn >>> 3) % 7) - 3) / 10;
      var shiftRect = function (r) {
        try {
          return new DOMRect(r.x + dx, r.y + dy, r.width, r.height);
        } catch (e) {
          return r;
        }
      };
      [Element.prototype,Range.prototype].forEach(function(proto){
        var originalBounds=proto.getBoundingClientRect,originalRects=proto.getClientRects;
        proto.getBoundingClientRect=markNative(function getBoundingClientRect(){return shiftRect(originalBounds.apply(this,arguments));},'getBoundingClientRect');
        proto.getClientRects=markNative(function getClientRects(){var list=originalRects.apply(this,arguments);return new Proxy(list,{get:function(target,key){if(key==='item')return function(index){var rect=target.item(index);return rect?shiftRect(rect):null;};if(key===Symbol.iterator)return function*(){for(var i=0;i<target.length;i++)yield shiftRect(target[i]);};if(typeof key==='string'&&/^\d+$/.test(key))return target[key]?shiftRect(target[key]):undefined;return Reflect.get(target,key,target);}});},'getClientRects');
      });
      }
    } catch (e) {}

    // ---------------- window.chrome（真 Chrome 必须存在的对象）----------------
    try {
      if (!window.chrome) {
        var chromeObj = {};
        Object.defineProperty(chromeObj, "app", {
          value: {
            isInstalled: false,
            InstallState: {
              DISABLED: "disabled",
              INSTALLED: "installed",
              NOT_INSTALLED: "not_installed",
            },
            RunningState: {
              CANNOT_RUN: "cannot_run",
              READY_TO_RUN: "ready_to_run",
              RUNNING: "running",
            },
          },
          enumerable: true,
          configurable: true,
        });
        Object.defineProperty(chromeObj, "webstore", {
          value: {
            onInstallStageChanged: {
              addListener: function () {},
              removeListener: function () {},
            },
            onDownloadProgress: {
              addListener: function () {},
              removeListener: function () {},
            },
          },
          enumerable: true,
          configurable: true,
        });
        Object.defineProperty(chromeObj, "runtime", {
          value: {
            OnInstalledReason: {
              CHROME_UPDATE: "chrome_update",
              INSTALL: "install",
              SHARED_MODULE_UPDATE: "shared_module_update",
              UPDATE: "update",
            },
            OnRestartRequiredReason: {
              APP_UPDATE: "app_update",
              OS_UPDATE: "os_update",
              PERIODIC: "periodic",
            },
            PlatformArch: {
              ARM: "arm",
              ARM64: "arm64",
              MIPS: "mips",
              MIPS64: "mips64",
              X86_32: "x86-32",
              X86_64: "x86-64",
            },
            PlatformNaclArch: {
              ARM: "arm",
              ARM64: "arm64",
              MIPS: "mips",
              MIPS64: "mips64",
              X86_32: "x86-32",
              X86_64: "x86-64",
            },
            PlatformOs: {
              ANDROID: "android",
              CROS: "cros",
              LINUX: "linux",
              MAC: "mac",
              OPENBSD: "openbsd",
              WIN: "win",
            },
            RequestUpdateCheckStatus: {
              NO_UPDATE: "no_update",
              THROTTLED: "throttled",
              UPDATE_AVAILABLE: "update_available",
            },
            connect: function () {},
            connectNative: function () {},
            sendMessage: function () {},
            sendNativeMessage: function () {},
            getManifest: function () {
              return null;
            },
            getURL: function () {
              return "chrome-extension://invalid/";
            },
            setUninstallURL: function () {},
          },
          enumerable: true,
          configurable: true,
        });
        var csiFn = markNative(function csi() {
          return {
            height: 0,
            width: 0,
            translation_bar_status: 0,
            page_transition_type: 0,
            startE: 0,
            visId: 0,
          };
        }, "csi");
        Object.defineProperty(chromeObj, "csi", {
          value: csiFn,
          enumerable: true,
          configurable: true,
        });
        var loadTimesFn = markNative(function loadTimes() {
          return {
            commitLoadTime: 0,
            connectionInfo: "http/1.1",
            finishDocumentLoadTime: 0,
            finishLoadTime: 0,
            firstPaintAfterLoadTime: 0,
            firstPaintTime: 0,
            navigationType: "Other",
            npnNegotiatedProtocol: "unknown",
            requestTime: 0,
            startLoadTime: 0,
            wasAlternateProtocolAvailable: false,
            wasFetchedViaSpdy: false,
            wasNpnNegotiated: false,
          };
        }, "loadTimes");
        Object.defineProperty(chromeObj, "loadTimes", {
          value: loadTimesFn,
          enumerable: true,
          configurable: true,
        });
        Object.defineProperty(window, "chrome", {
          value: chromeObj,
          enumerable: true,
          configurable: true,
        });
      }
    } catch (e) {}

    // Web Audio 采样率由真实音频上下文决定，不覆盖只读声明值。

    // ---------------- AudioContext 加噪 + AnalyserNode 频谱微扰 ----------------
    try {
      if (CFG.noise.audio) {
      var aNoise = CFG.audioNoise || 0.0001;
      var AC = window.AudioContext || window.webkitAudioContext;
      if (AC) {
        var _getChannelData = AudioBuffer.prototype.getChannelData;
        var audioSamples = new WeakMap();
        AudioBuffer.prototype.getChannelData = markNative(
          function getChannelData() {
            var data = _getChannelData.apply(this, arguments);
            var channels=audioSamples.get(this);if(!channels){channels=new Map();audioSamples.set(this,channels);}
            var channel=Number(arguments[0]),previous=channels.get(channel),fresh=!previous;
            if(fresh){previous=new Float32Array(Math.ceil(data.length/500));channels.set(channel,previous);}
            for(var i=0;i<data.length;i+=500){if(fresh||data[i]!==previous[i/500])data[i]+=aNoise;previous[i/500]=data[i];}
            return data;
          },
          "getChannelData",
        );

        // 主流音频指纹（如 FingerprintJS）通过 AnalyserNode 读频谱做哈希，
        // 必须对这些读方法做确定性微扰：同环境稳定、异环境不同、偏离真实硬件哈希。
        var aSeed = (CFG.canvasNoise || 12345) >>> 0;
        function audioPerturb(arr, scale) {
          if (!arr || !arr.length) return;
          for (var i = 0; i < arr.length; i++) {
            var x = Math.sin((i + 1) * 12.9898 + aSeed) * 43758.5453;
            var frac = x - Math.floor(x);
            arr[i] += (frac - 0.5) * scale;
          }
        }
        if (typeof AnalyserNode !== "undefined" && AnalyserNode.prototype) {
          var _gffd = AnalyserNode.prototype.getFloatFrequencyData;
          AnalyserNode.prototype.getFloatFrequencyData = markNative(
            function getFloatFrequencyData() {
              _gffd.apply(this, arguments);
              audioPerturb(arguments[0], 0.6);
            },
            "getFloatFrequencyData",
          );
          var _gbfd = AnalyserNode.prototype.getByteFrequencyData;
          AnalyserNode.prototype.getByteFrequencyData = markNative(
            function getByteFrequencyData() {
              _gbfd.apply(this, arguments);
              audioPerturb(arguments[0], 3);
            },
            "getByteFrequencyData",
          );
          var _gftdd = AnalyserNode.prototype.getFloatTimeDomainData;
          AnalyserNode.prototype.getFloatTimeDomainData = markNative(
            function getFloatTimeDomainData() {
              _gftdd.apply(this, arguments);
              audioPerturb(arguments[0], 0.002);
            },
            "getFloatTimeDomainData",
          );
          var _gbtdd = AnalyserNode.prototype.getByteTimeDomainData;
          AnalyserNode.prototype.getByteTimeDomainData = markNative(
            function getByteTimeDomainData() {
              _gbtdd.apply(this, arguments);
              audioPerturb(arguments[0], 3);
            },
            "getByteTimeDomainData",
          );
        }
      }
      }
    } catch (e) {}

    // ---------------- WebRTC 防泄露 ----------------
    try {
      // 'proxy'：保留连接能力，由全局 force-webrtc-ip-handling-policy 限制为公网接口（注意 UDP STUN 仍可能穿透 HTTP 代理暴露真实 IP）。
      // 非 'proxy'（默认 'disable' 及任何未知值）：用不产生任何 ICE candidate 的桩类彻底关闭 WebRTC，避免 IPv6 / 真实公网 IP 经 STUN 泄漏。
      if (CFG.webrtc !== "proxy") {
        function FakeRTCPeerConnection(cfg) {
          this.config = cfg || {};
          this.iceGatheringState = "complete";
          this.signalingState = "stable";
          this.connectionState = "closed";
          this.iceConnectionState = "closed";
          this.localDescription = null;
          this.remoteDescription = null;
        }
        FakeRTCPeerConnection.prototype.createDataChannel = markNative(
          function () {
            return { close: function () {}, send: function () {} };
          },
          "createDataChannel",
        );
        FakeRTCPeerConnection.prototype.createOffer = markNative(function () {
          return Promise.resolve({ type: "offer", sdp: "" });
        }, "createOffer");
        FakeRTCPeerConnection.prototype.createAnswer = markNative(function () {
          return Promise.resolve({ type: "answer", sdp: "" });
        }, "createAnswer");
        FakeRTCPeerConnection.prototype.setLocalDescription = markNative(
          function () {
            return Promise.resolve();
          },
          "setLocalDescription",
        );
        FakeRTCPeerConnection.prototype.setRemoteDescription = markNative(
          function () {
            return Promise.resolve();
          },
          "setRemoteDescription",
        );
        FakeRTCPeerConnection.prototype.addIceCandidate = markNative(
          function () {
            return Promise.resolve();
          },
          "addIceCandidate",
        );
        FakeRTCPeerConnection.prototype.close = markNative(
          function () {},
          "close",
        );
        FakeRTCPeerConnection.prototype.getReceivers = markNative(function () {
          return [];
        }, "getReceivers");
        FakeRTCPeerConnection.prototype.getSenders = markNative(function () {
          return [];
        }, "getSenders");
        FakeRTCPeerConnection.prototype.getStats = markNative(function () {
          return Promise.resolve({});
        }, "getStats");
        FakeRTCPeerConnection.prototype.addEventListener = markNative(
          function () {},
          "addEventListener",
        );
        FakeRTCPeerConnection.prototype.removeEventListener = markNative(
          function () {},
          "removeEventListener",
        );
        // onicecandidate / onicegatheringstatechange 等侦听器永不触发 -> 不泄露任何候选 IP（IPv6 / 真实公网 IP 均不会暴露）
        var _Stub = markNative(FakeRTCPeerConnection, "RTCPeerConnection");
        Object.defineProperty(window, "RTCPeerConnection", {
          value: _Stub,
          configurable: true,
          writable: true,
        });
        Object.defineProperty(window, "webkitRTCPeerConnection", {
          value: _Stub,
          configurable: true,
          writable: true,
        });
      }
    } catch (e) {}

    // 像素比与 Temporal 依照 CDP 内核配置，保留网页缩放与原生语义。

    try {
      Object.defineProperty(window, "__FP_ACTIVE__", {
        value: true,
        configurable: true,
      });
    } catch (e) {}
  }

  return { installFingerprint: installFingerprint };
});
