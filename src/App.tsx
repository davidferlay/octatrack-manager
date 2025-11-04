import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";

interface OctatrackSet {
  name: string;
  path: string;
  has_audio: boolean;
  has_presets: boolean;
}

interface OctatrackDevice {
  name: string;
  mount_point: string;
  device_type: "CompactFlash" | "Usb";
  sets: OctatrackSet[];
}

function App() {
  const [devices, setDevices] = useState<OctatrackDevice[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [hasScanned, setHasScanned] = useState(false);

  async function scanDevices() {
    setIsScanning(true);
    try {
      const foundDevices = await invoke<OctatrackDevice[]>("scan_devices");
      setDevices(foundDevices);
      setHasScanned(true);
    } catch (error) {
      console.error("Error scanning devices:", error);
    } finally {
      setIsScanning(false);
    }
  }

  return (
    <main className="container">
      <h1>Octatrack Manager</h1>
      <p className="subtitle">Discover and manage your Elektron Octatrack projects</p>

      <div className="scan-section">
        <button
          onClick={scanDevices}
          disabled={isScanning}
          className="scan-button"
        >
          {isScanning ? "Scanning..." : "Scan for Devices"}
        </button>
      </div>

      {hasScanned && devices.length === 0 && (
        <div className="no-devices">
          <p>No Octatrack devices found.</p>
          <p className="hint">
            Make sure your Octatrack CF card is mounted or your device is connected.
          </p>
        </div>
      )}

      {devices.length > 0 && (
        <div className="devices-list">
          <h2>Found {devices.length} device{devices.length > 1 ? 's' : ''}</h2>
          {devices.map((device, idx) => (
            <div key={idx} className="device-card">
              <div className="device-header">
                <h3>{device.name || "Untitled Device"}</h3>
                <span className="device-type">{device.device_type}</span>
              </div>
              <p className="mount-point">
                <strong>Location:</strong> {device.mount_point}
              </p>

              {device.sets.length > 0 && (
                <div className="sets-section">
                  <h4>Sets ({device.sets.length})</h4>
                  <div className="sets-grid">
                    {device.sets.map((set, setIdx) => (
                      <div key={setIdx} className="set-card">
                        <div className="set-name">{set.name}</div>
                        <div className="set-info">
                          <span className={set.has_audio ? "status-yes" : "status-no"}>
                            {set.has_audio ? "✓ Audio" : "✗ Audio"}
                          </span>
                          <span className={set.has_presets ? "status-yes" : "status-no"}>
                            {set.has_presets ? "✓ Presets" : "✗ Presets"}
                          </span>
                        </div>
                        <div className="set-path">{set.path}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </main>
  );
}

export default App;
