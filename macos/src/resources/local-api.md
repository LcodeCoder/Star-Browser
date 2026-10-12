# Star Browser 本地 API

在设置中启用“本地自动化 API”。服务仅监听 127.0.0.1，默认关闭。端口填写 0 时自动选择可用端口；填写固定端口可供脚本持续使用。密钥保存在本机应用数据目录，文件权限为 0600；每个请求必须发送 Authorization: Bearer <密钥>。

从设置复制地址和密钥。HTTP 请求正文使用 application/json。网页跨来源请求不开放；无需登录远程服务。

返回结构：{ "ok": true, "data": ... }，失败为 { "ok": false, "error": "具体原因" }。

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | /v1/health | 应用和 API 版本 |
| GET | /v1/profiles | 列出环境；支持 search、group、tag、state、offset、limit |
| POST | /v1/profiles | 创建环境配置 |
| GET | /v1/profiles/<id> | 环境配置与运行状态 |
| PATCH | /v1/profiles/<id> | 更改配置，下次启动生效 |
| DELETE | /v1/profiles/<id> | 删除已停止环境的配置；浏览数据目录保留 |
| POST | /v1/profiles/<id>/start | 启动；正文 {"engine":"electron"} 或 {"engine":"chrome"} |
| POST | /v1/profiles/<id>/stop | 停止并等待浏览器实际关闭 |
| POST | /v1/profiles/<id>/clone | 复制配置，生成独立 ID 与指纹种子 |

state 使用 running 或 archived，默认不包含归档。limit 默认 100，最多 500。输入配置与工作台使用相同校验；代理不可连接或环境已归档时阻止启动。支持的常用配置包含 name、group、tags、note、os、country、startUrl、proxy、language/langManual、timezone/timezoneManual、webrtc、fingerprint、permissions、extensions、restoreSession。

读接口不返回代理账号密码；写接口可传入 proxy.user 与 proxy.pass。配置 API 不提供任意脚本执行，也不开放远程调试端口。浏览器操作和隔离仍在本机执行。

curl 示例（替换 PORT 和 TOKEN）：

```sh
curl -H 'Authorization: Bearer TOKEN' 'http://127.0.0.1:PORT/v1/profiles?search=工作'
curl -X POST -H 'Authorization: Bearer TOKEN' -H 'Content-Type: application/json' \
  -d '{"name":"自动化环境","os":"mac","startUrl":"about:home"}' \
  'http://127.0.0.1:PORT/v1/profiles'
```

HTTP 状态：401 密钥无效；403 请求来源不接受；404 资源不存在；409 环境仍在运行；413 请求正文过大；415 正文类型错误；429 同时请求过多；400 配置或操作失败。最多 8 个并发请求、1 MB 正文。重新生成密钥后旧密钥立即失效。
