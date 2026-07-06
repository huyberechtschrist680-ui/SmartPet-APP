(() => {
  const SERVICE_UUID = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
  const RX_UUID = "6e400002-b5a3-f393-e0a9-e50e24dcca9e";
  const TX_UUID = "6e400003-b5a3-f393-e0a9-e50e24dcca9e";

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  let webDevice = null;
  let webRxCharacteristic = null;
  let webTxCharacteristic = null;
  let nativeDeviceId = null;
  let nativeNotificationListener = null;
  let nativeDisconnectListener = null;
  let activeTransport = null;
  let initializedNativeBle = false;
  let writeQueue = Promise.resolve();

  const statusEl = document.querySelector("#connectionStatus");
  const connectButton = document.querySelector("#connectButton");
  const supportNotice = document.querySelector("#supportNotice");
  const logEl = document.querySelector("#log");
  const commandButtons = Array.from(document.querySelectorAll("[data-command]"));
  const emotionSlider = document.querySelector("#emotionSlider");
  const emotionValue = document.querySelector("#emotionValue");
  const emotionButton = document.querySelector("#emotionButton");

  const stateFields = {
    power: document.querySelector("#statePower"),
    emotion: document.querySelector("#stateEmotion"),
    food: document.querySelector("#stateFood"),
    motion: document.querySelector("#stateMotion"),
  };

  function getCapacitor() {
    return window.Capacitor || null;
  }

  function isNativeCapacitor() {
    const capacitor = getCapacitor();
    if (!capacitor) {
      return false;
    }
    if (typeof capacitor.isNativePlatform === "function") {
      return capacitor.isNativePlatform();
    }
    if (typeof capacitor.getPlatform === "function") {
      return capacitor.getPlatform() !== "web";
    }
    return false;
  }

  function getNativeBle() {
    return getCapacitor()?.Plugins?.BluetoothLe || null;
  }

  function showNotice(text) {
    supportNotice.textContent = text;
    supportNotice.classList.add("visible");
  }

  function hideNotice() {
    supportNotice.classList.remove("visible");
  }

  function setStatus(text, state) {
    statusEl.textContent = text;
    statusEl.className = `status ${state || ""}`.trim();
  }

  function setControlsEnabled(enabled) {
    commandButtons.forEach((button) => {
      button.disabled = !enabled;
    });
    emotionButton.disabled = !enabled;
  }

  function appendLog(text) {
    const time = new Date().toLocaleTimeString();
    logEl.textContent += `[${time}] ${text}\n`;
    logEl.scrollTop = logEl.scrollHeight;
  }

  function parseStateLine(line) {
    if (!line.startsWith("S,")) {
      return;
    }

    const parts = line.trim().split(",");
    if (parts.length < 6) {
      return;
    }

    stateFields.power.textContent = parts[1];
    stateFields.emotion.textContent = parts[2];
    stateFields.food.textContent = `${parts[3]} ${parts[4]}s`;
    stateFields.motion.textContent = parts[5];
  }

  function handleIncomingText(text) {
    text.split(/\n/).forEach((line) => {
      if (!line.trim()) {
        return;
      }
      appendLog(`RX: ${line}`);
      parseStateLine(line);
    });
  }

  function hexToDataView(hex) {
    const clean = hex.replace(/[^0-9a-f]/gi, "");
    const bytes = new Uint8Array(clean.length / 2);
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    }
    return new DataView(bytes.buffer);
  }

  function bytesToHex(bytes) {
    return Array.from(bytes)
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  }

  function bytesToDataView(bytes) {
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  function decodeBleValue(value) {
    if (typeof value === "string") {
      return decoder.decode(hexToDataView(value));
    }
    if (value instanceof DataView) {
      return decoder.decode(value);
    }
    if (value instanceof ArrayBuffer) {
      return decoder.decode(new DataView(value));
    }
    if (ArrayBuffer.isView(value)) {
      return decoder.decode(new DataView(value.buffer, value.byteOffset, value.byteLength));
    }
    return "";
  }

  function handleDisconnect() {
    webRxCharacteristic = null;
    webTxCharacteristic = null;
    nativeDeviceId = null;
    activeTransport = null;
    setControlsEnabled(false);
    setStatus("已断开", "disconnected");
    appendLog("BLE disconnected");
  }

  async function cleanupNativeListeners() {
    await nativeNotificationListener?.remove?.();
    await nativeDisconnectListener?.remove?.();
    nativeNotificationListener = null;
    nativeDisconnectListener = null;
  }

  async function ensureNativeBleReady(ble) {
    if (!initializedNativeBle) {
      await ble.initialize({ androidNeverForLocation: true });
      initializedNativeBle = true;
    }

    if (typeof ble.setDisplayStrings === "function") {
      await ble.setDisplayStrings({
        scanning: "正在扫描智能桌宠...",
        cancel: "取消",
        availableDevices: "可用设备",
        noDeviceFound: "未找到 SmartPet",
      }).catch(() => {});
    }

    const enabled = typeof ble.isEnabled === "function"
      ? await ble.isEnabled().catch(() => ({ value: true }))
      : { value: true };
    if (enabled?.value === false && typeof ble.requestEnable === "function") {
      appendLog("Bluetooth is off, requesting enable");
      await ble.requestEnable();
    }
  }

  async function connectNativeSmartPet() {
    const ble = getNativeBle();
    if (!ble) {
      showNotice("当前 App 未检测到原生 BLE 插件。请在 web 目录运行 npm install 和 npm run android:sync 后重新安装 APK。");
      return;
    }

    try {
      hideNotice();
      setStatus("正在连接", "connecting");
      setControlsEnabled(false);
      await ensureNativeBleReady(ble);

      const device = await ble.requestDevice({
        services: [SERVICE_UUID],
        optionalServices: [SERVICE_UUID],
      });
      nativeDeviceId = device.deviceId;
      await cleanupNativeListeners();

      nativeDisconnectListener = await ble.addListener(`disconnected|${nativeDeviceId}`, handleDisconnect);
      await ble.connect({ deviceId: nativeDeviceId, timeout: 10000 });
      if (typeof ble.requestConnectionPriority === "function") {
        await ble.requestConnectionPriority({
          deviceId: nativeDeviceId,
          connectionPriority: 1,
        }).catch(() => {});
      }

      nativeNotificationListener = await ble.addListener(
        `notification|${nativeDeviceId}|${SERVICE_UUID}|${TX_UUID}`,
        (event) => handleIncomingText(decodeBleValue(event?.value)),
      );
      await ble.startNotifications({
        deviceId: nativeDeviceId,
        service: SERVICE_UUID,
        characteristic: TX_UUID,
      });

      activeTransport = "native";
      setControlsEnabled(true);
      setStatus("已连接", "connected");
      appendLog(`Native BLE connected${device.name ? `: ${device.name}` : ""}`);
      await sendCommand("state");
    } catch (error) {
      nativeDeviceId = null;
      activeTransport = null;
      setControlsEnabled(false);
      setStatus("未连接", "");
      appendLog(`ERR: ${error.message || error}`);
    }
  }

  function handleWebNotification(event) {
    handleIncomingText(decodeBleValue(event.target.value));
  }

  async function connectWebSmartPet() {
    if (!navigator.bluetooth) {
      showNotice("当前浏览器不支持 Web Bluetooth。请使用安卓 Chrome，或安装已同步原生 BLE 插件的 Capacitor APK。");
      return;
    }

    try {
      hideNotice();
      setStatus("正在连接", "connecting");
      setControlsEnabled(false);
      webDevice = await navigator.bluetooth.requestDevice({
        filters: [{ services: [SERVICE_UUID] }],
        optionalServices: [SERVICE_UUID],
      });
      webDevice.addEventListener("gattserverdisconnected", handleDisconnect);

      const server = await webDevice.gatt.connect();
      const service = await server.getPrimaryService(SERVICE_UUID);
      webRxCharacteristic = await service.getCharacteristic(RX_UUID);
      webTxCharacteristic = await service.getCharacteristic(TX_UUID);
      await webTxCharacteristic.startNotifications();
      webTxCharacteristic.addEventListener("characteristicvaluechanged", handleWebNotification);

      activeTransport = "web";
      setControlsEnabled(true);
      setStatus("已连接", "connected");
      appendLog("Web Bluetooth connected");
      await sendCommand("state");
    } catch (error) {
      activeTransport = null;
      setControlsEnabled(false);
      setStatus("未连接", "");
      appendLog(`ERR: ${error.message || error}`);
    }
  }

  async function connectSmartPet() {
    if (isNativeCapacitor()) {
      await connectNativeSmartPet();
    } else {
      await connectWebSmartPet();
    }
  }

  async function writeNativeCommand(cmd) {
    const ble = getNativeBle();
    if (!ble || !nativeDeviceId) {
      appendLog("ERR: not connected");
      return;
    }

    const value = bytesToHex(encoder.encode(`${cmd}\n`));
    await ble.writeWithoutResponse({
      deviceId: nativeDeviceId,
      service: SERVICE_UUID,
      characteristic: RX_UUID,
      value,
    });
  }

  async function writeWebCommand(cmd) {
    if (!webRxCharacteristic) {
      appendLog("ERR: not connected");
      return;
    }

    const value = encoder.encode(`${cmd}\n`);
    if (webRxCharacteristic.writeValueWithoutResponse) {
      await webRxCharacteristic.writeValueWithoutResponse(value);
    } else {
      await webRxCharacteristic.writeValue(bytesToDataView(value));
    }
  }

  async function sendCommand(cmd) {
    writeQueue = writeQueue.then(async () => {
      try {
        if (activeTransport === "native") {
          await writeNativeCommand(cmd);
        } else if (activeTransport === "web") {
          await writeWebCommand(cmd);
        } else {
          appendLog("ERR: not connected");
          return;
        }
        appendLog(`TX: ${cmd}`);
      } catch (error) {
        appendLog(`ERR: ${error.message || error}`);
      }
    });
    await writeQueue;
  }

  function updateSupportNotice() {
    if (isNativeCapacitor()) {
      if (!getNativeBle()) {
        showNotice("当前 App 未检测到原生 BLE 插件。请在 web 目录运行 npm install 和 npm run android:sync 后重新安装 APK。");
      }
      return;
    }

    if (!navigator.bluetooth) {
      showNotice("当前浏览器不支持 Web Bluetooth。请使用安卓 Chrome，或安装已同步原生 BLE 插件的 Capacitor APK。");
    }
  }

  connectButton.addEventListener("click", connectSmartPet);

  commandButtons.forEach((button) => {
    button.addEventListener("click", () => {
      sendCommand(button.dataset.command);
    });
  });

  emotionSlider.addEventListener("input", () => {
    emotionValue.textContent = emotionSlider.value;
  });

  emotionButton.addEventListener("click", () => {
    sendCommand(`setemo ${emotionSlider.value}`);
  });

  updateSupportNotice();
  setControlsEnabled(false);
})();