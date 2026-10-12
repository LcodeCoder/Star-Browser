"use strict";
/**
 * 本地代理网关：解决 Chromium 不支持「带账号密码的 SOCKS5 代理」这一硬限制。
 *
 * 原理：Chromium/Electron 会**静默丢弃** socks5://user:pass@host:port 里的凭据，
 * 且 login 事件对 SOCKS5 不触发 → 带鉴权的 SOCKS5 一律握手失败（ERR_SOCKS_CONNECTION_FAILED）。
 *
 *  workaround（与 electron-session-proxy 同思路）：
 *   1) 本进程在 127.0.0.1:随机端口 起一个**无鉴权的 HTTP 代理**；
 *   2) 让 Chromium 走 http://127.0.0.1:<port>（Chromium 支持 HTTP 代理鉴权）；
 *   3) 网关收到 CONNECT 后，用「账号密码」向上游 SOCKS5 代理发起连接并双向转发。
 *   域名由上游 SOCKS5 解析（type=0x03），可避免本地 DNS 泄漏。
 */
const net = require("net");
const http = require("http");

/**
 * 与上游 SOCKS5 代理完成「带账号密码」握手 + 目标 CONNECT，返回已建立的 socket。
 * @param {{host:string,port:string|number,user?:string,pass?:string}} up
 * @param {string} targetHost
 * @param {number} targetPort
 * @returns {Promise<net.Socket>}
 */
function connectSocks5(up, targetHost, targetPort) {
  return new Promise((resolve, reject) => {
    const user = Buffer.from(up.user || "", "utf8");
    const pass = Buffer.from(up.pass || "", "utf8");
    const host = Buffer.from(targetHost, "utf8");
    if (user.length > 255 || pass.length > 255 || !host.length || host.length > 255 ||
        !Number.isInteger(targetPort) || targetPort < 1 || targetPort > 65535) {
      reject(new Error("SOCKS5 账号、密码、目标地址或端口无效"));
      return;
    }
    let state = "greet", buf = Buffer.alloc(0), done = false;
    const socket = net.connect(Number(up.port), up.host, () => {
      socket.write(Buffer.from([5, 1, 2]));
    });
    const fail = message => {
      if (done) return;
      done = true;
      socket.destroy();
      reject(new Error(message));
    };
    socket.on("error", error => fail("SOCKS5 连接错误：" + error.message));
    socket.on("end", () => fail("SOCKS5 握手期间连接关闭"));
    socket.setTimeout(20000, () => fail("SOCKS5 连接超时（20s）"));
    const sendConnect = () => {
      state = "connect";
      const port = Buffer.alloc(2);
      port.writeUInt16BE(targetPort);
      socket.write(Buffer.concat([Buffer.from([5, 1, 0, 3, host.length]), host, port]));
    };
    const onData = chunk => {
      if (done) return;
      buf = Buffer.concat([buf, chunk]);
      while (!done) {
        if (state === "greet") {
          if (buf.length < 2) return;
          if (buf[0] !== 5) return fail("SOCKS5 握手版本无效");
          const method = buf[1];
          buf = buf.subarray(2);
          if (method === 2) {
            state = "auth";
            socket.write(Buffer.concat([Buffer.from([1, user.length]), user, Buffer.from([pass.length]), pass]));
          } else if (method === 0) sendConnect();
          else return fail("SOCKS5 不支持的鉴权方式(0x" + method.toString(16) + ")");
        } else if (state === "auth") {
          if (buf.length < 2) return;
          if (buf[0] !== 1 || buf[1] !== 0) return fail("SOCKS5 账号密码鉴权失败");
          buf = buf.subarray(2);
          sendConnect();
        } else {
          if (buf.length < 4) return;
          if (buf[0] !== 5 || buf[2] !== 0) return fail("SOCKS5 CONNECT 响应无效");
          if (buf[1] !== 0) return fail("SOCKS5 连接上游失败(REP=0x" + buf[1].toString(16) + ")");
          let length;
          if (buf[3] === 1) length = 10;
          else if (buf[3] === 4) length = 22;
          else if (buf[3] === 3) {
            if (buf.length < 5) return;
            length = 7 + buf[4];
          } else return fail("SOCKS5 CONNECT 地址类型无效");
          if (buf.length < length) return;
          done = true;
          socket.pause();
          socket.removeListener("data", onData);
          socket.setTimeout(0);
          if (buf.length > length) socket.unshift(buf.subarray(length));
          resolve(socket);
          queueMicrotask(() => socket.resume());
        }
      }
    };
    socket.on("data", onData);
  });
}

function pipeSockets(a, b) {
  const onErr = () => {
    try {
      a.destroy();
    } catch (_) {}
    try {
      b.destroy();
    } catch (_) {}
  };
  a.pipe(b);
  b.pipe(a);
  a.on("error", onErr);
  b.on("error", onErr);
  a.on("close", () => {
    try {
      b.destroy();
    } catch (_) {}
  });
  b.on("close", () => {
    try {
      a.destroy();
    } catch (_) {}
  });
}

/** 创建本地 HTTP 代理网关（按上游 socks5 配置转发） */
function createGateway(up) {
  const server = http.createServer();

  // HTTPS 隧道：CONNECT host:port
  server.on("connect", (req, clientSocket) => {
    const idx = req.url.lastIndexOf(":");
    const host = idx > 0 ? req.url.slice(0, idx) : req.url;
    const port = idx > 0 ? parseInt(req.url.slice(idx + 1), 10) || 443 : 443;
    connectSocks5(up, host, port)
      .then((upSock) => {
        clientSocket.write(
          "HTTP/1.1 200 Connection Established\r\nProxy-Agent: changyi\r\n\r\n",
        );
        pipeSockets(clientSocket, upSock);
      })
      .catch((e) => {
        try {
          clientSocket.write("HTTP/1.1 502 Bad Gateway\r\n\r\n");
          clientSocket.end();
        } catch (_) {}
        dbgLog(
          "GATEWAY connect fail " + host + ":" + port + " -> " + e.message,
        );
      });
  });

  // 明文 HTTP 代理（浏览器多为 HTTPS，此分支兜底）
  server.on("request", (req, res) => {
    let target;
    try {
      target = new URL(req.url);
    } catch (_) {
      res.writeHead(400);
      res.end("Bad Request");
      return;
    }
    const th = target.hostname;
    const tp = target.port ? Number(target.port) : 80;
    if (target.protocol !== "http:") {
      res.writeHead(400);
      res.end("HTTPS requests must use CONNECT");
      return;
    }
    connectSocks5(up, th, tp)
      .then(upSock => {
        const headers = { ...req.headers, host: target.host };
        delete headers["proxy-connection"];
        delete headers["proxy-authorization"];
        headers.connection = "close";
        const agent = new http.Agent({ keepAlive: false });
        agent.createConnection = () => upSock;
        const request = http.request({
          hostname: th, port: tp,
          path: target.pathname + target.search,
          method: req.method, headers, agent,
        }, response => {
          res.writeHead(response.statusCode, response.statusMessage, response.headers);
          response.pipe(res);
          response.on("error", () => res.destroy());
        });
        request.on("error", error => {
          if (res.headersSent) res.destroy(error);
          else { res.writeHead(502); res.end("Bad Gateway: " + error.message); }
        });
        res.on("close", () => { request.destroy(); agent.destroy(); });
        req.pipe(request);
      })
      .catch(error => {
        res.writeHead(502);
        res.end("Bad Gateway: " + error.message);
      });
  });

  return server;
}

function dbgLog(m) {
  try {
    const fs = require("fs");
    const path = require("path");
    const p = path.join(
      require("electron").app.getPath("userData"),
      "tfb-debug.log",
    );
    fs.appendFileSync(
      p,
      "[" + new Date().toISOString() + "] " + m + "\n",
      "utf-8",
    );
  } catch (_) {}
}

// 网关缓存：相同上游只起一个，避免端口膨胀
const gateways = new Map();
function getGateway(up) {
  const key = [up.host, up.port, up.user || "", up.pass || ""].join("|");
  if (gateways.has(key)) return Promise.resolve(gateways.get(key).port);
  const server = createGateway(up);
  return new Promise((resolve, reject) => {
    server.on("error", (e) =>
      reject(new Error("网关启动失败：" + (e.message || e))),
    );
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      gateways.set(key, { server, port });
      dbgLog(
        "GATEWAY started for " +
          up.host +
          ":" +
          up.port +
          " on 127.0.0.1:" +
          port,
      );
      resolve(port);
    });
  });
}

/** 判断是否需要走网关（带账号密码的 SOCKS5） */
function needsGateway(proxy) {
  return (
    !!proxy &&
    proxy.type === "socks5" &&
    !!(proxy.user || proxy.pass) &&
    !!proxy.host
  );
}

module.exports = { getGateway, needsGateway, connectSocks5 };
