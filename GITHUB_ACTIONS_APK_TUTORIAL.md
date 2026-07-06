# 使用 GitHub Actions 打包 SmartPet Android APK

这个仓库当前是一个 `web/` 下的 Capacitor 项目。最快的打包方式是：把网页资源复制到 `web/dist/`，在 GitHub Actions 里临时生成 `web/android/`，然后用 Gradle 构建 debug APK。

我已经添加了 `.github/workflows/build-android-apk.yml`。它会在两种情况下运行：

- 推送到 `main` 分支，并且修改了 `web/**` 或 workflow 文件。
- 在 GitHub 网页上手动点击 `Run workflow`。

## 1. 上传项目到 GitHub

如果这个目录还不是 Git 仓库，在 PowerShell 里进入项目根目录：

```powershell
cd D:\SmartpPet-app
git init
git branch -M main
git add .
git commit -m "Add GitHub Actions APK build"
```

然后在 GitHub 新建一个空仓库，不要勾选自动生成 README。假设仓库地址是：

```text
https://github.com/你的用户名/你的仓库名.git
```

继续执行：

```powershell
git remote add origin https://github.com/你的用户名/你的仓库名.git
git push -u origin main
```

如果你已经有 Git 仓库，只需要提交并推送本次新增文件：

```powershell
git add .github/workflows/build-android-apk.yml .gitignore GITHUB_ACTIONS_APK_TUTORIAL.md
git commit -m "Add APK build workflow"
git push
```

## 2. 手动触发 APK 打包

打开 GitHub 仓库页面：

1. 进入 `Actions`。
2. 左侧选择 `Build Android APK`。
3. 点击 `Run workflow`。
4. 分支选择 `main`。
5. 再次点击绿色的 `Run workflow`。

等待构建完成。首次构建会下载 npm、Capacitor、Android Gradle 依赖，可能需要几分钟。

## 3. 下载 APK

构建成功后：

1. 打开刚刚完成的 workflow run。
2. 在页面底部或右侧找到 `Artifacts`。
3. 下载 `smartpet-ble-debug-apk`。
4. 解压下载得到的 zip。
5. 里面的 `app-debug.apk` 就是可以安装测试的 APK。

## 4. 安装到安卓手机

最简单的方法是把 `app-debug.apk` 传到手机，然后在手机上打开安装。手机可能会提示允许“安装未知来源应用”，按提示给文件管理器或浏览器授权即可。

如果电脑已安装 Android SDK，也可以用 adb：

```powershell
adb install -r app-debug.apk
```

## 5. 当前 workflow 做了什么

workflow 的核心步骤是：

1. 检出仓库代码。
2. 安装 Node.js 24。
3. 安装 Java 21。
4. 在 `web/` 下执行 `npm install`。
5. 执行 `npm run build`，生成 Capacitor 使用的 `dist/`。
6. 如果没有 `web/android/`，执行 `npm run android:add` 临时生成 Android 工程。
7. 如果以后提交了 `web/android/`，则改为 `npx cap sync android` 同步资源。
8. 给 Android Manifest 补 BLE 权限。
9. 执行 `./gradlew assembleDebug`。
10. 上传 debug APK artifact。

## 6. debug APK 与 release APK 的区别

这个教程生成的是 debug APK，适合：

- 快速安装到自己手机测试。
- 发给少量同学或测试者验证功能。
- 验证蓝牙连接、界面和权限流程。

debug APK 不适合上架应用商店。如果后面要正式发布，需要再做 release 签名，把 keystore 信息放到 GitHub Secrets 里，再新增 release 构建步骤。

## 7. 常见问题

### Actions 没有自动运行

确认 workflow 文件已经在仓库的这个路径：

```text
.github/workflows/build-android-apk.yml
```

并且已经推送到 GitHub 的 `main` 分支。

### 找不到 APK artifact

先确认 workflow run 是绿色成功状态。如果失败，点进失败的步骤看日志。APK 只会在 `Build debug APK` 成功后上传。

### npm install 失败

当前 `web/package.json` 使用了 `latest` 版本依赖，优点是配置快，缺点是未来依赖更新后可能出现不兼容。若遇到依赖变化导致失败，建议在本地生成并提交 `web/package-lock.json`，然后把 workflow 里的 `npm install` 改成 `npm ci`。

### App 名称显示乱码

如果手机上安装后应用名称显示异常，优先检查 `web/capacitor.config.json` 里的 `appName`。这不影响 APK 构建本身，但会影响手机桌面显示名称。

### 蓝牙权限无法使用

workflow 会执行 `web/scripts/patch-android-ble-permissions.js` 自动写入 Android BLE 权限。安装后第一次使用蓝牙时，仍然需要在手机上授予蓝牙或附近设备权限。
