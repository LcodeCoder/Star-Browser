"use strict";
/**
 * 指纹伪装核心（UMD 形态）
 * - 浏览器/扩展内容脚本环境：挂到全局 window.installFingerprint
 * - Electron preload（CommonJS）环境：module.exports.installFingerprint
 *
 * 覆盖维度：
 *   navigator: webdriver / hardwareConcurrency / deviceMemory / platform / language /
 *              languages / userAgent / vendor / userAgentData(Client Hints) /
 *              plugins / mimeTypes / maxTouchPoints / doNotTrack / mediaDevices / speechSynthesis
 *   screen / 时区 / WebGL / Canvas / Audio / WebRTC / ClientRects / 字体枚举
 *
 * 设计原则：同一环境 config 固定 -> 所有随机都基于 config 的确定值 -> 指纹稳定不漂移。
 */
(function (root, factory) {
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
    if (!CFG) return;

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
      if (navigator.userAgentData) {
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

    // ---------------- navigator.plugins / mimeTypes ----------------
    // 现代 Chrome 这两项基本为空，我们按配置渲染（默认空 -> length 0），与真实 Chrome 一致。
    try {
      var pluginList = (CFG.plugins || []).map(function (p) {
        var mt = (p.mimeTypes || []).map(function (m) {
          return {
            type: m.type,
            description: m.description || "",
            suffixes: m.suffixes || "",
          };
        });
        return {
          name: p.name,
          description: p.description || "",
          filename: p.filename || "",
          mimeTypes: mt,
          length: mt.length,
        };
      });
      function makeArrayLike(arr, itemFn, namedFn) {
        return new Proxy(arr, {
          get: function (t, p) {
            if (p === "length") return t.length;
            if (p === "item") return itemFn;
            if (p === "namedItem") return namedFn;
            if (p === "refresh") return function () {};
            if (typeof p === "string" && /^\d+$/.test(p)) return t[Number(p)];
            return t[p];
          },
        });
      }
      var pluginProxy = makeArrayLike(
        pluginList,
        function (i) {
          return pluginList[i];
        },
        function (n) {
          return pluginList.filter(function (x) {
            return x.name === n;
          })[0];
        },
      );
      var mimeList = [];
      pluginList.forEach(function (p) {
        p.mimeTypes.forEach(function (m) {
          mimeList.push(m);
        });
      });
      var mimeProxy = makeArrayLike(
        mimeList,
        function (i) {
          return mimeList[i];
        },
        function (n) {
          return mimeList.filter(function (x) {
            return x.type === n;
          })[0];
        },
      );
      def(Navigator.prototype, "plugins", function () {
        return pluginProxy;
      });
      def(Navigator.prototype, "mimeTypes", function () {
        return mimeProxy;
      });
    } catch (e) {}

    // ---------------- 媒体设备（摄像头/麦克风/扬声器）----------------
    try {
      if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
        var md = CFG.mediaDevices || { cameras: [], mics: [], speakers: [] };
        var devices = [];
        (md.cameras || []).forEach(function (n, i) {
          devices.push({
            deviceId: "cam-" + (CFG.seed || "x") + "-" + i,
            kind: "videoinput",
            label: n,
            groupId: "g1",
          });
        });
        (md.mics || []).forEach(function (n, i) {
          devices.push({
            deviceId: "mic-" + (CFG.seed || "x") + "-" + i,
            kind: "audioinput",
            label: n,
            groupId: "g2",
          });
        });
        (md.speakers || []).forEach(function (n, i) {
          devices.push({
            deviceId: "spk-" + (CFG.seed || "x") + "-" + i,
            kind: "audiooutput",
            label: n,
            groupId: "g3",
          });
        });
        var _enum = navigator.mediaDevices.enumerateDevices;
        navigator.mediaDevices.enumerateDevices = markNative(
          function enumerateDevices() {
            return Promise.resolve(devices);
          },
          "enumerateDevices",
        );
      }
    } catch (e) {}

    // ---------------- 语音合成 voices ----------------
    try {
      if (window.speechSynthesis) {
        var vs = (CFG.speechVoices || []).map(function (v, i) {
          return {
            voiceURI: v,
            name: v,
            lang: CFG.language,
            localService: true,
            default: i === 0,
            voiceURI: v,
          };
        });
        var _getVoices = window.speechSynthesis.getVoices;
        window.speechSynthesis.getVoices = markNative(function getVoices() {
          return vs.slice();
        }, "getVoices");
        // onvoiceschanged 触发一次，保持一致性
        try {
          var _ovc = window.speechSynthesis.onvoiceschanged;
          Object.defineProperty(window.speechSynthesis, "onvoiceschanged", {
            set: function (fn) {
              _ovc = fn;
            },
            get: function () {
              return _ovc;
            },
            configurable: true,
          });
        } catch (e) {}
      }
    } catch (e) {}

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

    // ---------------- 时区（通用偏移 + Date 全量本地方法 patch）----------------
    try {
      var TZ = CFG.timezone || "America/New_York";

      // 用 Intl 计算任意 IANA 时区相对 UTC 的偏移（分钟，含夏令时）
      function tzOffsetMinutes(date) {
        try {
          var dtf = new Intl.DateTimeFormat("en-US", {
            timeZone: TZ,
            hour12: false,
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          });
          var parts = {};
          dtf.formatToParts(date).forEach(function (p) {
            parts[p.type] = p.value;
          });
          var hh = +parts.hour === 24 ? 0 : +parts.hour;
          var asUTC = Date.UTC(
            +parts.year,
            +parts.month - 1,
            +parts.day,
            hh,
            +parts.minute,
            +parts.second,
          );
          // 该时区墙上时间(当UTC) - 真实UTC = 时区领先分钟数
          return Math.round((asUTC - date.getTime()) / 60000);
        } catch (e) {
          return 0;
        }
      }
      // Date.prototype.getTimezoneOffset() 定义： (UTC - 本地)/60000，东半球为负
      Date.prototype.getTimezoneOffset = markNative(
        function getTimezoneOffset() {
          return -tzOffsetMinutes(this);
        },
        "getTimezoneOffset",
      );

      var _resolved = Intl.DateTimeFormat.prototype.resolvedOptions;
      Intl.DateTimeFormat.prototype.resolvedOptions = markNative(
        function resolvedOptions() {
          var r = _resolved.apply(this, arguments);
          r.timeZone = TZ;
          r.locale = CFG.language;
          return r;
        },
        "resolvedOptions",
      );

      // 抽取目标时区的各时间字段，统一驱动本地时间方法（避免宿主时区泄漏）
      function getTzParts(date) {
        var dtf = new Intl.DateTimeFormat("en-US", {
          timeZone: TZ,
          weekday: "short",
          month: "short",
          day: "2-digit",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: false,
          timeZoneName: "long",
        });
        var parts = {};
        dtf.formatToParts(date).forEach(function (p) {
          parts[p.type] = p.value;
        });
        return parts;
      }
      var WD = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
      function normHour(h) {
        return +h === 24 ? 0 : +h;
      }
      function patchDateGetter(name, fn) {
        if (Date.prototype[name]) Date.prototype[name] = markNative(fn, name);
      }
      patchDateGetter("getFullYear", function () {
        return +getTzParts(this).year;
      });
      patchDateGetter("getMonth", function () {
        return +getTzParts(this).month - 1;
      });
      patchDateGetter("getDate", function () {
        return +getTzParts(this).day;
      });
      patchDateGetter("getDay", function () {
        return WD[getTzParts(this).weekday] != null
          ? WD[getTzParts(this).weekday]
          : 0;
      });
      patchDateGetter("getHours", function () {
        return normHour(getTzParts(this).hour);
      });
      patchDateGetter("getMinutes", function () {
        return +getTzParts(this).minute;
      });
      patchDateGetter("getSeconds", function () {
        return +getTzParts(this).second;
      });
      patchDateGetter("getMilliseconds", function () {
        return this.getUTCMilliseconds();
      });

      // Date 格式化字符串也要落在目标时区（含 GMT±HHMM），否则 toString 暴露宿主时区
      function tzGmt(offsetMin) {
        // offsetMin 为时区相对 UTC 的领先分钟数（东半球为正），toString 的 GMT±HHMM 用同样符号
        var sign = offsetMin >= 0 ? "+" : "-";
        var abs = Math.abs(offsetMin);
        var h = String(Math.floor(abs / 60)).padStart(2, "0");
        var m = String(abs % 60).padStart(2, "0");
        return "GMT" + sign + h + m;
      }
      Date.prototype.toString = markNative(function toString() {
        var p = getTzParts(this);
        var off = tzOffsetMinutes(this);
        return (
          p.weekday +
          " " +
          p.month +
          " " +
          p.day +
          " " +
          p.year +
          " " +
          String(normHour(p.hour)).padStart(2, "0") +
          ":" +
          p.minute +
          ":" +
          p.second +
          " " +
          tzGmt(off) +
          (p.timeZoneName ? " (" + p.timeZoneName + ")" : "")
        );
      }, "toString");
      Date.prototype.toTimeString = markNative(function toTimeString() {
        var p = getTzParts(this);
        var off = tzOffsetMinutes(this);
        return (
          String(normHour(p.hour)).padStart(2, "0") +
          ":" +
          p.minute +
          ":" +
          p.second +
          " " +
          tzGmt(off) +
          (p.timeZoneName ? " (" + p.timeZoneName + ")" : "")
        );
      }, "toTimeString");
      Date.prototype.toDateString = markNative(function toDateString() {
        var p = getTzParts(this);
        return p.weekday + " " + p.month + " " + p.day + " " + p.year;
      }, "toDateString");

      // 关键补丁：Intl.DateTimeFormat 构造函数本身也要注入伪装时区。
      // 否则 new Intl.DateTimeFormat().format(date) 仍用真实宿主时区，与上面伪装的
      // getTimezoneOffset / toString 冲突 -> 检测方报「时区不一致」。
      try {
        var _RealDateTimeFormat = Intl.DateTimeFormat;
        Intl.DateTimeFormat = markNative(function DateTimeFormat(
          locales,
          options,
        ) {
          var opts = options;
          if (!opts || !opts.timeZone) {
            opts = Object.assign({}, options || {});
            opts.timeZone = TZ;
          }
          return new _RealDateTimeFormat(locales, opts);
        }, "DateTimeFormat");
        Intl.DateTimeFormat.prototype = _RealDateTimeFormat.prototype;
        if (_RealDateTimeFormat.supportedLocalesOf)
          Intl.DateTimeFormat.supportedLocalesOf =
            _RealDateTimeFormat.supportedLocalesOf;
      } catch (e) {}

      // 同样补丁：Intl.NumberFormat / Intl.Collator 的 locale 也要落到伪装语言，
      // 否则 resolvedOptions().locale 仍泄漏宿主语言（检测方据此判地理不一致）。
      try {
        var _localeCtorPatch = function (RealCtor, cname) {
          try {
            var _Real = RealCtor;
            var Wrapped = markNative(function (locales, options) {
              var locs = locales;
              if (typeof locs !== "string" && !(locs instanceof Array))
                locs = CFG.language;
              return new _Real(locs, options);
            }, cname);
            Wrapped.prototype = _Real.prototype;
            if (_Real.supportedLocalesOf)
              Wrapped.supportedLocalesOf = _Real.supportedLocalesOf;
            return Wrapped;
          } catch (e) {
            return RealCtor;
          }
        };
        Intl.NumberFormat = _localeCtorPatch(Intl.NumberFormat, "NumberFormat");
        Intl.Collator = _localeCtorPatch(Intl.Collator, "Collator");
      } catch (e) {}

      // Date.toLocaleString / toLocaleTimeString / toLocaleDateString 内部用宿主时区，
      // 必须显式注入伪装时区，否则同样泄漏真实时区（与 getTimezoneOffset 冲突）。
      try {
        var _localeFns = [
          "toLocaleString",
          "toLocaleTimeString",
          "toLocaleDateString",
        ];
        _localeFns.forEach(function (m) {
          if (!Date.prototype[m]) return;
          var orig = Date.prototype[m];
          Date.prototype[m] = markNative(function () {
            var args = Array.prototype.slice.call(arguments);
            var opts = args[1];
            if (typeof opts !== "object" || opts === null || !opts.timeZone) {
              opts = Object.assign({}, opts || {});
              opts.timeZone = TZ;
              args[1] = opts;
            }
            return orig.apply(this, args);
          }, m);
        });
      } catch (e) {}

      // ---------------- Temporal（现代检测站如 whoer 用 Temporal.Now.timeZone() 读真实 IANA 时区）----------------
      // 若不伪装，Temporal.Now.timeZone().id 仍返回宿主时区(如 Asia/Shanghai)，
      // 而 Intl/Date 已被伪装成 LA -> 检测方读到的两个时区不一致 -> 报「时区差异」。
      // ⚠️ 必须「先捕获原始函数引用」再包一层：若只捕获 Temporal.Now 命名空间对象再重写其方法，
      // 则内部调用会指向被改写的自己 -> 无限递归（Maximum call stack size exceeded）。
      try {
        if (typeof Temporal !== "undefined" && Temporal.Now) {
          var _TZ = Temporal.Now.timeZone;
          var _Zdt = Temporal.Now.zonedDateTimeISO;
          var _Pdt = Temporal.Now.plainDateTimeISO;
          var _Pd = Temporal.Now.plainDateISO;
          var _Pt = Temporal.Now.plainTimeISO;
          Temporal.Now.timeZone = markNative(function timeZone() {
            return new Temporal.TimeZone(TZ);
          }, "timeZone");
          Temporal.Now.zonedDateTimeISO = markNative(function zonedDateTimeISO(
            tz,
          ) {
            return _Zdt.call(Temporal.Now, tz || TZ);
          }, "zonedDateTimeISO");
          Temporal.Now.plainDateTimeISO = markNative(function plainDateTimeISO(
            tz,
          ) {
            return _Pdt.call(Temporal.Now, tz || TZ);
          }, "plainDateTimeISO");
          Temporal.Now.plainDateISO = markNative(function plainDateISO(tz) {
            return _Pd.call(Temporal.Now, tz || TZ);
          }, "plainDateISO");
          Temporal.Now.plainTimeISO = markNative(function plainTimeISO(tz) {
            return _Pt.call(Temporal.Now, tz || TZ);
          }, "plainTimeISO");
        }
      } catch (e) {}
    } catch (e) {}

    // ---------------- WebGL vendor / renderer ----------------
    try {
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
    } catch (e) {}

    // ---------------- Canvas 加噪（确定性微扰）----------------
    try {
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
    } catch (e) {}

    // ---------------- 字体枚举一致性（measureText / fonts.check）----------------
    try {
      var fontSet = CFG.fonts || [];
      var _measureText = CanvasRenderingContext2D.prototype.measureText;
      CanvasRenderingContext2D.prototype.measureText = markNative(
        function measureText(text) {
          var font = this.font || "";
          var m = /"([^"]+)"|'([^']+)'/.exec(font);
          var fam = m ? m[1] || m[2] : null;
          var base = _measureText.call(this, text);
          if (fam && fontSet.indexOf(fam) === -1) {
            // 不在白名单 -> 与基线同宽，检测方判定为「不存在」
            return base;
          }
          if (fam) {
            // 白名单内 -> 给一个确定的「已渲染」宽度差，使检测方判定为「存在」
            var h = 0;
            for (var i = 0; i < fam.length; i++)
              h = (Math.imul(h, 31) + fam.charCodeAt(i)) >>> 0;
            var factor = 1 + (h % 1000) / 100000; // 约 +0.000~0.01
            return {
              width: base.width * factor,
              actualBoundingBoxLeft: base.actualBoundingBoxLeft,
              actualBoundingBoxRight:
                base.width * factor - (base.actualBoundingBoxLeft || 0),
              actualBoundingBoxAscent: base.actualBoundingBoxAscent,
              actualBoundingBoxDescent: base.actualBoundingBoxDescent,
              emHeightAscent: base.emHeightAscent,
              emHeightDescent: base.emHeightDescent,
              fontBoundingBoxAscent: base.fontBoundingBoxAscent,
              fontBoundingBoxDescent: base.fontBoundingBoxDescent,
              alphabetic: base.alphabetic,
              hanging: base.hanging,
              ideographic: base.ideographic,
            };
          }
          return base;
        },
        "measureText",
      );

      if (document.fonts && document.fonts.check) {
        var _check = document.fonts.check.bind(document.fonts);
        document.fonts.check = markNative(function check(s) {
          var m = /"([^"]+)"|'([^']+)'/.exec(s);
          if (m) return fontSet.indexOf(m[1] || m[2]) !== -1;
          return _check(s);
        }, "check");
      }
    } catch (e) {}

    // ---------------- ClientRects 确定性亚像素偏移 ----------------
    try {
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
      var _gBCR = Element.prototype.getBoundingClientRect;
      Element.prototype.getBoundingClientRect = markNative(
        function getBoundingClientRect() {
          return shiftRect(_gBCR.apply(this, arguments));
        },
        "getBoundingClientRect",
      );
      var _gCR = Element.prototype.getClientRects;
      Element.prototype.getClientRects = markNative(function getClientRects() {
        var list = _gCR.apply(this, arguments);
        var out = [];
        for (var i = 0; i < list.length; i++) out.push(shiftRect(list[i]));
        return out;
      }, "getClientRects");
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

    // ---------------- AudioContext.sampleRate 确定性伪装 ----------------
    try {
      if (CFG.audioSampleRate) {
        var _AC = window.AudioContext || window.webkitAudioContext;
        if (_AC) {
          Object.defineProperty(_AC.prototype, "sampleRate", {
            get: function () {
              return CFG.audioSampleRate;
            },
            configurable: true,
          });
        }
      }
    } catch (e) {}

    // ---------------- AudioContext 加噪 + AnalyserNode 频谱微扰 ----------------
    try {
      var aNoise = CFG.audioNoise || 0.0001;
      var AC = window.AudioContext || window.webkitAudioContext;
      if (AC) {
        var _getChannelData = AudioBuffer.prototype.getChannelData;
        AudioBuffer.prototype.getChannelData = markNative(
          function getChannelData() {
            var data = _getChannelData.apply(this, arguments);
            for (var i = 0; i < data.length; i += 500) {
              data[i] = data[i] + aNoise;
            }
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

    // ---------------- devicePixelRatio 伪装 ----------------
    try {
      Object.defineProperty(window, "devicePixelRatio", {
        get: function () {
          return CFG.devicePixelRatio || 1;
        },
        configurable: true,
      });
    } catch (e) {}

    // ---------------- Temporal API 时区泄漏封堵 ----------------
    // 现代检测站（browserscan.net / 新版 whoer）用 Temporal.Now.timeZone() 读取真实 IANA 时区，
    // 原生 Intl/Date 的 patch 无法覆盖该 API -> 必须单独 patch，否则报「时区不一致」。
    try {
      if (
        typeof Temporal !== "undefined" &&
        Temporal.Now &&
        typeof Temporal.TimeZone === "function"
      ) {
        var _realTZ = Temporal.Now.timeZone;
        Temporal.Now.timeZone = markNative(function timeZone() {
          try {
            return new Temporal.TimeZone(TZ);
          } catch (e) {
            try {
              return _realTZ.call(Temporal.Now);
            } catch (e2) {}
          }
        }, "timeZone");
      }
    } catch (e) {}

    try {
      Object.defineProperty(window, "__FP_ACTIVE__", {
        value: true,
        configurable: true,
      });
    } catch (e) {}
  }

  return { installFingerprint: installFingerprint };
});
