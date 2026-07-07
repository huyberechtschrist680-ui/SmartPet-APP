(() => {
  const SERVICE_UUID = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
  const RX_UUID = "6e400002-b5a3-f393-e0a9-e50e24dcca9e";
  const TX_UUID = "6e400003-b5a3-f393-e0a9-e50e24dcca9e";
  const SMARTPET_NAME = "SmartPet";
  const SMARTPET_NAME_MATCH = SMARTPET_NAME.toLowerCase();
  const NATIVE_SCAN_TIMEOUT_MS = 12000;

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  let webDevice = null;
  let webRxCharacteristic = null;
  let webTxCharacteristic = null;
  let nativeDeviceId = null;
  let nativeNotificationListener = null;
  let nativeDisconnectListener = null;
  let nativeScanListener = null;
  let nativeScanTimeoutId = null;
  let nativeScanResolve = null;
  let nativeScanDevices = new Map();
  let activeTransport = null;
  let initializedNativeBle = false;
  let isConnecting = false;
  let isScanning = false;
  let writeQueue = Promise.resolve();

  const statusEl = document.querySelector("#connectionStatus");
  const connectButton = document.querySelector("#connectButton");
  const disconnectButton = document.querySelector("#disconnectButton");
  const scanPanel = document.querySelector("#scanPanel");
  const scanList = document.querySelector("#scanList");
  const scanCancelButton = document.querySelector("#scanCancelButton");
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

  function isConnected() {
    return activeTransport === "native" || activeTransport === "web";
  }

  function updateConnectionButtons() {
    connectButton.disabled = isConnecting || isScanning || isConnected();
    disconnectButton.disabled = !isConnected();
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

  function deviceNameMatches(name) {
    return (name || "").toLowerCase().includes(SMARTPET_NAME_MATCH);
  }

  function clearConnectionState() {
    webRxCharacteristic = null;
    webTxCharacteristic = null;
    webDevice = null;
    nativeDeviceId = null;
    activeTransport = null;
    setControlsEnabled(false);
    updateConnectionButtons();
  }

  function handleDisconnect() {
    const hadConnection = isConnected() || nativeDeviceId || webDevice;
    clearConnectionState();
    setStatus("已断开", "disconnected");
    if (hadConnection) {
      appendLog("BLE disconnected");
    }
  }

  async function cleanupNativeListeners() {
    await nativeNotificationListener?.remove?.();
    await nativeDisconnectListener?.remove?.();
    nativeNotificationListener = null;
    nativeDisconnectListener = null;
  }

  function showScanPanel() {
    scanPanel.hidden = false;
  }

  function hideScanPanel() {
    scanPanel.hidden = true;
  }

  function renderScanDevices() {
    scanList.textContent = "";

    if (nativeScanDevices.size === 0) {
      const empty = document.createElement("div");
      empty.className = "scan-empty";
      empty.textContent = "正在扫描名称包含 SmartPet 的设备...";
      scanList.append(empty);
      return;
    }

    nativeScanDevices.forEach((device) => {
      const button = document.createElement("button");
      button.className = "scan-device";
      button.type = "button";

      const name = document.createElement("span");
      name.textContent = device.name || SMARTPET_NAME;

      const meta = document.createElement("span");
      meta.className = "scan-device-meta";
      meta.textContent = typeof device.rssi === "number" ? `${device.rssi} dBm` : "选择";

      button.append(name, meta);
      button.addEventListener("click", () => {
        finishNativeScan(device);
      });
      scanList.append(button);
    });
  }

  function normalizeScanResult(result) {
    const scanDevice = result?.device || result || {};
    const deviceId = scanDevice.deviceId || result?.deviceId || scanDevice.id || result?.id;
    const name = scanDevice.name || result?.name || result?.localName || scanDevice.localName || "";

    if (!deviceId || !deviceNameMatches(name)) {
      return null;
    }

    return {
      deviceId,
      name,
      rssi: typeof result?.rssi === "number" ? result.rssi : scanDevice.rssi,
    };
  }

  async function stopNativeScan() {
    const ble = getNativeBle();

    if (nativeScanTimeoutId) {
      clearTimeout(nativeScanTimeoutId);
      nativeScanTimeoutId = null;
    }

    await nativeScanListener?.remove?.();
    nativeScanListener = null;

    if (ble && typeof ble.stopLEScan === "function") {
      await ble.stopLEScan().catch(() => {});
    }

    isScanning = false;
    hideScanPanel();
    updateConnectionButtons();
  }

  async function finishNativeScan(device) {
    const resolve = nativeScanResolve;
    nativeScanResolve = null;
    await stopNativeScan();
    resolve?.(device || null);
  }

  async function chooseNativeSmartPetDevice(ble) {
    if (typeof ble.requestLEScan !== "function" || typeof ble.addListener !== "function") {
      return ble.requestDevice({
        namePrefix: SMARTPET_NAME,
        optionalServices: [SERVICE_UUID],
      });
    }

    nativeScanDevices = new Map();
    isScanning = true;
    showScanPanel();
    renderScanDevices();
    updateConnectionButtons();

    return new Promise(async (resolve, reject) => {
      nativeScanResolve = resolve;

      try {
        nativeScanListener = await ble.addListener("onScanResult", (result) => {
          const device = normalizeScanResult(result);
          if (!device) {
            return;
          }
          nativeScanDevices.set(device.deviceId, device);
          renderScanDevices();
        });

        await ble.requestLEScan({ allowDuplicates: false });
        nativeScanTimeoutId = setTimeout(() => {
          appendLog("Scan finished: no more SmartPet devices found");
          finishNativeScan(null);
        }, NATIVE_SCAN_TIMEOUT_MS);
      } catch (error) {
        nativeScanResolve = null;
        await stopNativeScan();
        reject(error);
      }
    });
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

  async function connectNativeDevice(ble, device) {
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
    updateConnectionButtons();
    appendLog(`Native BLE connected${device.name ? `: ${device.name}` : ""}`);
    await sendCommand("state");
  }

  async function connectNativeSmartPet() {
    const ble = getNativeBle();
    if (!ble) {
      showNotice("当前 App 未检测到原生 BLE 插件。请在 web 目录运行 npm install 和 npm run android:sync 后重新安装 APK。");
      return;
    }

    try {
      hideNotice();
      setStatus("正在扫描", "connecting");
      setControlsEnabled(false);
      updateConnectionButtons();
      await ensureNativeBleReady(ble);

      const device = await chooseNativeSmartPetDevice(ble);
      if (!device) {
        setStatus("未连接", "");
        appendLog("No SmartPet device selected");
        return;
      }

      setStatus("正在连接", "connecting");
      await connectNativeDevice(ble, device);
    } catch (error) {
      const failedDeviceId = nativeDeviceId;
      await cleanupNativeListeners();
      if (failedDeviceId && typeof ble.disconnect === "function") {
        await ble.disconnect({ deviceId: failedDeviceId }).catch(() => {});
      }
      clearConnectionState();
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
      updateConnectionButtons();
      webDevice = await navigator.bluetooth.requestDevice({
        filters: [{ namePrefix: SMARTPET_NAME }],
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
      updateConnectionButtons();
      appendLog(`Web Bluetooth connected${webDevice.name ? `: ${webDevice.name}` : ""}`);
      await sendCommand("state");
    } catch (error) {
      webTxCharacteristic?.removeEventListener("characteristicvaluechanged", handleWebNotification);
      webDevice?.removeEventListener("gattserverdisconnected", handleDisconnect);
      if (webDevice?.gatt?.connected) {
        webDevice.gatt.disconnect();
      }
      clearConnectionState();
      setStatus("未连接", "");
      appendLog(`ERR: ${error.message || error}`);
    }
  }

  async function connectSmartPet() {
    if (isConnecting || isScanning) {
      return;
    }
    if (isConnected()) {
      appendLog("Already connected. Disconnect before selecting another device.");
      updateConnectionButtons();
      return;
    }

    isConnecting = true;
    updateConnectionButtons();
    try {
      if (isNativeCapacitor()) {
        await connectNativeSmartPet();
      } else {
        await connectWebSmartPet();
      }
    } finally {
      isConnecting = false;
      updateConnectionButtons();
    }
  }

  async function disconnectSmartPet() {
    if (!isConnected()) {
      return;
    }

    connectButton.disabled = true;
    disconnectButton.disabled = true;
    setControlsEnabled(false);
    setStatus("正在断开", "connecting");

    const transport = activeTransport;
    const deviceId = nativeDeviceId;
    const ble = getNativeBle();

    try {
      if (transport === "native" && ble && deviceId) {
        if (typeof ble.stopNotifications === "function") {
          await ble.stopNotifications({
            deviceId,
            service: SERVICE_UUID,
            characteristic: TX_UUID,
          }).catch(() => {});
        }
        await cleanupNativeListeners();
        if (typeof ble.disconnect === "function") {
          await ble.disconnect({ deviceId }).catch(() => {});
        }
      }

      if (transport === "web" && webDevice) {
        webTxCharacteristic?.removeEventListener("characteristicvaluechanged", handleWebNotification);
        webDevice.removeEventListener("gattserverdisconnected", handleDisconnect);
        if (webDevice.gatt?.connected) {
          webDevice.gatt.disconnect();
        }
      }
    } finally {
      clearConnectionState();
      setStatus("已断开", "disconnected");
      appendLog("BLE disconnected");
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
  disconnectButton.addEventListener("click", disconnectSmartPet);
  scanCancelButton.addEventListener("click", () => {
    appendLog("Scan canceled");
    finishNativeScan(null);
  });

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
  updateConnectionButtons();
})();
