"use strict";
/**
 * 指纹生成核心
 * 关键点：同一个 seed 永远生成同一套指纹，保证环境「稳定」——
 * 这是指纹浏览器与「每次随机」隐私插件的本质区别。
 */

// ---------- 种子化伪随机数（mulberry32）----------
function xmur3(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return function () {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
}
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function makeRng(seed) {
  const s = xmur3(String(seed))();
  return mulberry32(s);
}
function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}
function randInt(rng, min, max) {
  return Math.floor(rng() * (max - min + 1)) + min;
}

// ---------- 素材池 ----------
const CHROME_VERSIONS = ["124.0.0.0", "125.0.0.0", "126.0.0.0", "127.0.0.0"];
const WIN_UA = (v) =>
  `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${v} Safari/537.36`;
const MAC_UA = (v) =>
  `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${v} Safari/537.36`;
const ANDROID_UA = (v) =>
  `Mozilla/5.0 (Linux; Android 13; SM-S918B Build/TP1A.220624.014) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${v} Mobile Safari/537.36`;

// 安卓常见物理分辨率（px），配合 devicePixelRatio 模拟手机屏
const ANDROID_RESOLUTIONS = [
  [360, 800],
  [393, 851],
  [412, 915],
  [414, 896],
  [360, 760],
  [384, 854],
];
// 安卓 GPU（ARM/Qualcomm 平台，Mobile Safari 渲染器名义上为 ANGLE 封装）
const ANDROID_GPU = [
  {
    vendor: "Google Inc. (Qualcomm)",
    renderer: "ANGLE (Qualcomm, Adreno (TM) 740, DRM 3.0.0, OpenGL ES 3.2)",
  },
  {
    vendor: "Google Inc. (ARM)",
    renderer: "ANGLE (ARM, Mali-G715, DRM 3.0.0, OpenGL ES 3.2)",
  },
];

const GPU_VENDORS = [
  {
    vendor: "Google Inc. (NVIDIA)",
    renderer:
      "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)",
  },
  {
    vendor: "Google Inc. (NVIDIA)",
    renderer:
      "ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 Direct3D11 vs_5_0 ps_5_0, D3D11)",
  },
  {
    vendor: "Google Inc. (Intel)",
    renderer:
      "ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)",
  },
  {
    vendor: "Google Inc. (AMD)",
    renderer: "ANGLE (AMD, AMD Radeon RX 6600 Direct3D11 vs_5_0 ps_5_0, D3D11)",
  },
];

const RESOLUTIONS = [
  [1920, 1080],
  [1920, 1200],
  [1536, 864],
  [1600, 900],
  [2560, 1440],
  [1366, 768],
];

const TIMEZONES = {
  US: "America/New_York",
  UK: "Europe/London",
  CA: "America/Toronto",
  AU: "Australia/Sydney",
  DE: "Europe/Berlin",
  FR: "Europe/Paris",
  NL: "Europe/Amsterdam",
  ES: "Europe/Madrid",
  IT: "Europe/Rome",
  SE: "Europe/Stockholm",
  PL: "Europe/Warsaw",
  RU: "Europe/Moscow",
  JP: "Asia/Tokyo",
  KR: "Asia/Seoul",
  SG: "Asia/Singapore",
  HK: "Asia/Hong_Kong",
  TW: "Asia/Taipei",
  IN: "Asia/Kolkata",
  TH: "Asia/Bangkok",
  VN: "Asia/Ho_Chi_Minh",
  MY: "Asia/Kuala_Lumpur",
  PH: "Asia/Manila",
  ID: "Asia/Jakarta",
  AE: "Asia/Dubai",
  SA: "Asia/Riyadh",
  TR: "Europe/Istanbul",
  BR: "America/Sao_Paulo",
  MX: "America/Mexico_City",
  ZA: "Africa/Johannesburg",
};
const LOCALES = {
  US: "en-US",
  UK: "en-GB",
  CA: "en-CA",
  AU: "en-AU",
  DE: "de-DE",
  FR: "fr-FR",
  NL: "nl-NL",
  ES: "es-ES",
  IT: "it-IT",
  SE: "sv-SE",
  PL: "pl-PL",
  RU: "ru-RU",
  JP: "ja-JP",
  KR: "ko-KR",
  SG: "en-SG",
  HK: "zh-HK",
  TW: "zh-TW",
  IN: "en-IN",
  TH: "th-TH",
  VN: "vi-VN",
  MY: "ms-MY",
  PH: "en-PH",
  ID: "id-ID",
  AE: "ar-AE",
  SA: "ar-SA",
  TR: "tr-TR",
  BR: "pt-BR",
  MX: "es-MX",
  ZA: "en-ZA",
};

// ---------------- 地理映射：让指纹时区/语言「跟随代理出口 IP」 ----------------
// 用途：proxy:check 取得出口 IP 的地理位置后，把指纹时区/语言对齐到该 IP，
// 避免 whoer/yalala 等检测站报「时区/语言与 IP 不一致」。
// 内部国家码以 TIMEZONES/LOCALES 的键为准（如英国用 UK），故需做别名归一。
const CC_ALIAS = { GB: "UK" };
function normalizeCc(code) {
  if (!code) return "";
  code = String(code).toUpperCase();
  return CC_ALIAS[code] || code;
}
// ISO 国家码 -> IANA 时区（ipinfo 未直接给 timezone 时的兜底；ipinfo 通常直接给 timezone 字段）
const CC_TO_TZ = {
  US: "America/New_York",
  UK: "Europe/London",
  CA: "America/Toronto",
  AU: "Australia/Sydney",
  DE: "Europe/Berlin",
  FR: "Europe/Paris",
  NL: "Europe/Amsterdam",
  ES: "Europe/Madrid",
  IT: "Europe/Rome",
  SE: "Europe/Stockholm",
  PL: "Europe/Warsaw",
  RU: "Europe/Moscow",
  JP: "Asia/Tokyo",
  KR: "Asia/Seoul",
  SG: "Asia/Singapore",
  HK: "Asia/Hong_Kong",
  TW: "Asia/Taipei",
  IN: "Asia/Kolkata",
  TH: "Asia/Bangkok",
  VN: "Asia/Ho_Chi_Minh",
  MY: "Asia/Kuala_Lumpur",
  PH: "Asia/Manila",
  ID: "Asia/Jakarta",
  AE: "Asia/Dubai",
  SA: "Asia/Riyadh",
  TR: "Europe/Istanbul",
  BR: "America/Sao_Paulo",
  MX: "America/Mexico_City",
  ZA: "Africa/Johannesburg",
  CN: "Asia/Shanghai",
};
// 非内部码的语言兜底（内部码走 LOCALES）
const CC_TO_LOCALE = { CN: "zh-CN", GB: "en-GB" };
// myip.ipip.net 返回中文国家名 -> ISO 码
const CN_TO_CC = {
  阿联酋: "AE",
  美国: "US",
  新加坡: "SG",
  中国: "CN",
  香港: "HK",
  日本: "JP",
  韩国: "KR",
  德国: "DE",
  英国: "GB",
  法国: "FR",
  荷兰: "NL",
  俄罗斯: "RU",
  印度: "IN",
  泰国: "TH",
  越南: "VN",
  马来西亚: "MY",
  菲律宾: "PH",
  印度尼西亚: "ID",
  巴西: "BR",
  土耳其: "TR",
  沙特: "SA",
  南非: "ZA",
  加拿大: "CA",
  澳大利亚: "AU",
  西班牙: "ES",
  意大利: "IT",
  瑞典: "SE",
  波兰: "PL",
  墨西哥: "MX",
  台湾: "TW",
  中国台湾: "TW",
};
/**
 * 把出口 IP 的地理信息解析为「归一国家码 + IANA 时区 + 语言 + UTC 偏移(分钟)」。
 * 时区优先取源给出的 IANA 名；源只给 UTC 偏移(如 ip.sb/api.ip.sb/ip-api)时，用 offsetToTz 由偏移推导，
 * 避免退化成固定国家默认(纽约)——后者与真实出口(如洛杉矶)不符 → 检测站报系统时差。
 * @param {{country?:string, countryName?:string, timezone?:string|object, offset?:number, __raw?:string}} info
 */
// UTC 偏移(分钟) → IANA 时区。专门修正 US：偏移 -7/-8h(太平洋)→洛杉矶、-6h→丹佛、-5h→芝加哥、
// -4h→纽约、-10h→檀香山，杜绝「全美默认纽约」这种与真实出口不符的时差误报。
const OFFSET_TO_TZ = {
  US: {
    "-480": "America/Los_Angeles",
    "-420": "America/Los_Angeles",
    "-360": "America/Denver",
    "-300": "America/Chicago",
    "-240": "America/New_York",
    "-600": "Pacific/Honolulu",
    "-540": "America/Anchorage",
    "-660": "Pacific/Pago_Pago",
    "-330": "America/New_York",
  },
  BR: { "-180": "America/Sao_Paulo", "-240": "America/Sao_Paulo" },
  RU: {
    180: "Europe/Moscow",
    240: "Asia/Yekaterinburg",
    300: "Asia/Novosibirsk",
    480: "Asia/Vladivostok",
    600: "Asia/Kamchatka",
    720: "Asia/Kamchatka",
  },
  AU: {
    600: "Australia/Sydney",
    570: "Australia/Adelaide",
    540: "Australia/Perth",
  },
  // 通用兜底：覆盖常见偏移，确保任何情况下都能拿到一个与出口偏移一致的时区，而非错误的首都默认
  _gen: {
    "-660": "Pacific/Pago_Pago",
    "-600": "Pacific/Honolulu",
    "-540": "America/Anchorage",
    "-480": "America/Los_Angeles",
    "-420": "America/Los_Angeles",
    "-360": "America/Denver",
    "-300": "America/Chicago",
    "-240": "America/New_York",
    "-180": "America/Sao_Paulo",
    "-120": "America/Nuuk",
    "-60": "Atlantic/Azores",
    0: "Europe/London",
    60: "Europe/Paris",
    120: "Europe/Berlin",
    180: "Europe/Moscow",
    210: "Asia/Tehran",
    240: "Asia/Dubai",
    300: "Asia/Karachi",
    330: "Asia/Kolkata",
    345: "Asia/Kathmandu",
    360: "Asia/Dhaka",
    420: "Asia/Bangkok",
    480: "Asia/Shanghai",
    540: "Asia/Tokyo",
    570: "Australia/Adelaide",
    600: "Australia/Sydney",
    660: "Asia/Magadan",
    720: "Pacific/Auckland",
    780: "Pacific/Chatham",
    840: "Pacific/Kiritimati",
  },
};
function offsetToTz(country, offsetMin) {
  if (offsetMin == null || isNaN(offsetMin)) return "";
  const key = String(Math.round(offsetMin));
  const map = OFFSET_TO_TZ[country];
  if (map && map[key]) return map[key];
  if (OFFSET_TO_TZ._gen[key]) return OFFSET_TO_TZ._gen[key];
  return "";
}
function resolveGeo(info) {
  info = info || {};
  // 优先 ISO 国家码（country_code）；否则 country 字段可能是 2 字母码或全名(如 "United States")，统一归一
  let cc = "";
  if (info.country_code && /^[A-Za-z]{2}$/.test(String(info.country_code)))
    cc = String(info.country_code).toUpperCase();
  else if (info.countryCode && /^[A-Za-z]{2}$/.test(String(info.countryCode)))
    cc = String(info.countryCode).toUpperCase(); // ip-api.com 用 camelCase
  else if (info.country) {
    const c = String(info.country).trim();
    if (/^[A-Za-z]{2}$/.test(c)) cc = c.toUpperCase();
    else cc = CN_TO_CC[c] || ""; // 全名 → 码（如 "美国"→"US"、"United States"→"US"）
  }
  if (!cc && info.countryName) cc = CN_TO_CC[info.countryName] || "";
  if (!cc && info.__raw) {
    const m = (info.__raw || "").match(
      /来自(?:自|于)?\s*[:：]\s*([A-Za-z一-龥]+)/,
    );
    if (m) cc = CN_TO_CC[m[1]] || "";
  }
  const norm = normalizeCc(cc);
  // timezone 可能字符串，也可能对象 {id,abbr,offset}（ipwho.is），取 .id
  let tzRaw = info.timezone;
  if (tzRaw && typeof tzRaw === "object") tzRaw = tzRaw.id || "";
  let tz = typeof tzRaw === "string" && tzRaw ? tzRaw : "";
  // 时区名缺失时，用 UTC 偏移推导（ip.sb/api.ip.sb/ip-api 均回传 offset 字段）
  const offsetMin =
    typeof info.offset === "number" && isFinite(info.offset)
      ? info.offset
      : null;
  if (!tz && offsetMin != null)
    tz = offsetToTz(norm, offsetMin) || offsetToTz("", offsetMin);
  // 极端兜底：连偏移都没有才用国家默认（已极少触发）
  if (!tz) tz = CC_TO_TZ[norm] || TIMEZONES[norm] || "";
  const locale = LOCALES[norm] || CC_TO_LOCALE[cc] || "en-US";
  return {
    country: cc,
    normalized: norm,
    timezone: tz,
    locale,
    utcOffset: offsetMin,
  };
}

// 媒体设备名称池（按平台）
const CAMERAS = {
  win: [
    "Integrated Webcam",
    "HP TrueVision HD Camera",
    "USB2.0 HD UVC WebCam",
    "Logitech HD Webcam C270",
  ],
  mac: ["FaceTime HD Camera", "FaceTime HD Camera (Built-in)"],
  android: ["Front Camera", "Back Camera"],
  default: ["Integrated Camera"],
};
const MICS = {
  win: [
    "Microphone (Realtek Audio)",
    "Microphone Array (Realtek)",
    "USB Microphone",
  ],
  mac: ["MacBook Pro Microphone", "Built-in Microphone"],
  android: ["Microphone (Android)"],
  default: ["Default Microphone"],
};
const SPEAKERS = {
  win: ["Speakers (Realtek Audio)", "Headphones (Realtek)", "Default Speaker"],
  mac: ["MacBook Pro Speakers", "Built-in Output"],
  android: ["Speaker (Android)"],
  default: ["Default Speaker"],
};
// 语音合成音色（按语言）
const VOICES = {
  "en-US": [
    "Microsoft David - English (United States)",
    "Microsoft Zira - English (United States)",
    "Google US English",
  ],
  "en-GB": [
    "Microsoft Hazel - English (United Kingdom)",
    "Google UK English Female",
  ],
  "en-CA": ["Microsoft Linda - English (Canada)"],
  "en-AU": ["Microsoft Catherine - English (Australia)"],
  "en-SG": ["Microsoft Liang - English (Singapore)"],
  "en-IN": ["Microsoft Ravi - English (India)"],
  "en-PH": ["Microsoft Bea - English (Philippines)"],
  "en-ZA": ["Microsoft Thabo - English (South Africa)"],
  "de-DE": ["Microsoft Hedda - German (Germany)", "Google Deutsch"],
  "fr-FR": ["Microsoft Julie - French (France)", "Google français"],
  "nl-NL": ["Microsoft Hanna - Dutch (Netherlands)"],
  "es-ES": ["Microsoft Helena - Spanish (Spain)", "Google español"],
  "es-MX": ["Microsoft Sabina - Spanish (Mexico)"],
  "it-IT": ["Microsoft Cosimo - Italian (Italy)"],
  "sv-SE": ["Microsoft Bengt - Swedish (Sweden)"],
  "pl-PL": ["Microsoft Paulina - Polish (Poland)"],
  "ru-RU": ["Microsoft Irina - Russian (Russia)", "Google русский"],
  "ja-JP": ["Microsoft Haruka - Japanese (Japan)", "Google 日本語"],
  "ko-KR": ["Microsoft Heami - Korean (Korea)"],
  "zh-HK": ["Google 粵語（香港）", "Microsoft Hanhan - Chinese (Traditional)"],
  "zh-TW": ["Microsoft Hanhan - Chinese (Traditional)"],
  "th-TH": ["Google ไทย"],
  "vi-VN": ["Google Tiếng Việt"],
  "ms-MY": ["Google Bahasa Melayu"],
  "id-ID": ["Google Bahasa Indonesia"],
  "ar-AE": ["Microsoft Salma - Arabic (Saudi Arabia)"],
  "ar-SA": ["Microsoft Naayf - Arabic (Saudi Arabia)"],
  "tr-TR": ["Microsoft Tolga - Turkish (Turkey)"],
  "pt-BR": ["Microsoft Maria - Portuguese (Brazil)", "Google português"],
};

/**
 * 生成一套完整指纹
 * @param {string} seed  环境唯一种子（用环境ID即可）
 * @param {object} opts  { os:'win'|'mac', country:'US'|... }
 */
function generateFingerprint(seed, opts = {}) {
  const rng = makeRng(seed);
  const os = opts.os || pick(rng, ["win", "win", "win", "mac"]); // 外贸多用 Windows
  const country = opts.country || pick(rng, Object.keys(TIMEZONES));
  const chromeVer = opts.chromeVersion || process.versions.chrome || pick(rng, CHROME_VERSIONS);
  const locale = opts.language || LOCALES[country] || "en-US";

  let userAgent,
    platform,
    screen,
    maxTouchPoints,
    devicePixelRatio,
    cores,
    memory,
    gpu;
  if (os === "android") {
    userAgent = ANDROID_UA(chromeVer);
    platform = "Linux armv8l";
    const [aw, ah] = pick(rng, ANDROID_RESOLUTIONS);
    screen = {
      width: aw,
      height: ah,
      availWidth: aw,
      availHeight: ah - 80,
      colorDepth: 24,
      pixelDepth: 24,
    };
    maxTouchPoints = pick(rng, [5, 10]); // 手机屏多点触控
    devicePixelRatio = pick(rng, [2, 2.5, 3, 3.5]); // 安卓高分屏
    cores = pick(rng, [4, 8]);
    memory = pick(rng, [4, 8]);
    gpu = pick(rng, ANDROID_GPU);
  } else {
    userAgent = os === "mac" ? MAC_UA(chromeVer) : WIN_UA(chromeVer);
    platform = os === "mac" ? "MacIntel" : "Win32";
    const [w, h] = pick(rng, RESOLUTIONS);
    screen = {
      width: w,
      height: h,
      availWidth: w,
      availHeight: h - 40,
      colorDepth: 24,
      pixelDepth: 24,
    };
    maxTouchPoints = 0;
    devicePixelRatio = pick(rng, [1, 1, 1, 1, 1.25, 1.5]);
    cores = pick(rng, [4, 8, 8, 12, 16]);
    memory = pick(rng, [4, 8, 8, 8]);
    gpu = pick(rng, GPU_VENDORS);
  }

  const result = {
    seed,
    os,
    country,
    userAgent,
    platform,
    chromeVersion: chromeVer,
    // 音频采样率（确定性常见值，避免 AudioContext 暴露宿主声卡真实率）
    audioSampleRate: pick(rng, [44100, 48000, 44100, 48000, 44100]),
    // 屏幕
    screen,
    // 语言 / 时区
    language: locale,
    languages: locale.indexOf("en") === 0 ? [locale] : [locale, "en-US"],
    timezone:
      opts.timezone ||
      (opts.utcOffset != null
        ? offsetToTz(country, opts.utcOffset) ||
          TIMEZONES[country] ||
          "America/New_York"
        : TIMEZONES[country] || "America/New_York"),
    // 硬件
    hardwareConcurrency: cores,
    deviceMemory: memory,
    maxTouchPoints,
    // 设备像素比（桌面常见 1，少量缩放屏 1.25/1.5；安卓高分屏 2~3.5）
    devicePixelRatio,
    // GPU（WebGL）
    webgl: { vendor: gpu.vendor, renderer: gpu.renderer },
    // 噪声种子（canvas / audio / clientRects 用它做确定性微扰）
    canvasNoise: randInt(rng, 1, 1000000),
    audioNoise: 0.0001 + rng() * 0.0002,
    rectNoise: randInt(rng, 1, 1000000),
    // WebRTC 策略
    webrtc: "disable", // disable=完全关闭(默认，杜绝 IPv6/真实 IP 经 STUN 泄漏)  proxy=保留连接但可能漏真实 IP
    // 字体（检测站枚举出来的就是这份清单，保证一致）
    fonts: buildFontList(rng, os),
    // 媒体设备（摄像头/麦克风/扬声器），按平台选名
    mediaDevices: {
      cameras: pickN(rng, CAMERAS[os] || CAMERAS.default, 1, 2),
      mics: pickN(rng, MICS[os] || MICS.default, 1, 2),
      speakers: pickN(rng, SPEAKERS[os] || SPEAKERS.default, 1, 2),
    },
    // 语音合成音色
    speechVoices: VOICES[locale] || VOICES["en-US"],
    // 插件（现代 Chrome 默认空，与真实环境一致）
    plugins: [],
  };
  Object.assign(result, opts.fingerprint || {});
  return result;
}

function buildFontList(rng, os) {
  const common = [
    "Arial",
    "Calibri",
    "Cambria",
    "Georgia",
    "Tahoma",
    "Times New Roman",
    "Trebuchet MS",
    "Verdana",
  ];
  const win = ["Segoe UI", "Consolas", "Microsoft YaHei", "MS Gothic"];
  const mac = ["Helvetica Neue", "Menlo", "PingFang SC", "San Francisco"];
  const base = common.concat(os === "mac" ? mac : win);
  // 随机剔除 0~2 个字体，制造机器差异
  const drop = randInt(rng, 0, 2);
  const list = base.slice();
  for (let i = 0; i < drop; i++)
    list.splice(Math.floor(rng() * list.length), 1);
  return list;
}

function pickN(rng, arr, min, max) {
  const n = randInt(rng, min, max);
  const pool = arr.slice();
  const out = [];
  for (let i = 0; i < n && pool.length; i++) {
    out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
  }
  return out;
}

module.exports = {
  generateFingerprint,
  TIMEZONES,
  LOCALES,
  resolveGeo,
  offsetToTz,
};
