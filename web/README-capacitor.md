# Android App 打包路线：Capacitor + 原生 BLE

这个 `web/` 目录现在可以作为独立 Capacitor 项目使用，安卓工程也会生成在 `web/android/` 内，不需要改动 ESP32 固件项目其他目录。

## 需要先安装

1. Node.js LTS
2. Android Studio 和 Android SDK
3. 一台支持 BLE 的安卓手机，打开蓝牙

## 首次生成安卓工程

```powershell
cd D:\ESP32\web
npm install
npm run android:add
```

`android:add` 会做这些事：

- 把 `index.html`、`app.js` 和根目录图片复制到 `dist/`
- 在 `web/android/` 生成 Capacitor Android 工程
- 给 AndroidManifest 补 BLE 权限
- 用 `web/resources/icon.png` 和 `web/resources/splash.png` 生成图标与启动图

## 后续同步修改

每次改完 `index.html` 或 `app.js` 后运行：

```powershell
cd D:\ESP32\web
npm run android:sync
```

然后打开 Android Studio：

```powershell
npm run android:open
```

也可以直接尝试安装到已连接手机：

```powershell
npm run android:run
```

## BLE 运行方式

- 在 Capacitor 安卓 App 中，页面优先调用 `@capacitor-community/bluetooth-le` 原生 BLE 插件。
- 在普通浏览器中，页面继续保留 Web Bluetooth 兜底，适合用安卓 Chrome 快速测试。
- BLE UUID 仍然沿用当前 ESP32 Nordic UART Service：
  - Service: `6e400001-b5a3-f393-e0a9-e50e24dcca9e`
  - RX/write: `6e400002-b5a3-f393-e0a9-e50e24dcca9e`
  - TX/notify: `6e400003-b5a3-f393-e0a9-e50e24dcca9e`

## 打 APK

用 Android Studio 打开 `web/android/` 后：

- 调试安装：点 Run
- 生成 APK：Build > Build Bundle(s) / APK(s) > Build APK(s)

如果手机连接时看不到设备，先确认 ESP32 正在广播 BLE 服务，并且手机已经授予附近设备/蓝牙权限。