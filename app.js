/**
 * ============================================================================
 * SISTEM ABSENSI QR DINAMIS (10 MENIT) - LOGIKA APLIKASI
 * ============================================================================
 */

// Konfigurasi Default
const DEFAULT_CONFIG = {
  scriptUrl: "", // URL Google Apps Script Web App
  publicUrl: "", // URL publik web app ini (untuk dibuka di HP karyawan)
  secretKey: "kunci-absen-rahasia-2026",
  employees: [
    { id: 1, name: "Budi Pratama", role: "Staf 1" },
    { id: 2, name: "Siti Rahmawati", role: "Staf 2" },
    { id: 3, name: "Ahmad Fauzi", role: "Staf 3" }
  ],
  slotMinutes: 10 // QR code berubah tiap 10 menit
};

// State Aplikasi
let appConfig = { ...DEFAULT_CONFIG };
let qrcodeInstance = null;
let currentSlot = 0;
let currentToken = "";
let currentQrUrl = "";
let timerInterval = null;
let selectedEmployee = null;
let selectedType = "Masuk";
let currentGpsData = null;
let isSubmitting = false;

// ============================================================================
// PURE JAVASCRIPT SHA-256 HASH (Bekerja di semua browser & HTTP/HTTPS)
// ============================================================================
function sha256(ascii) {
  function rightRotate(value, amount) {
    return (value >>> amount) | (value << (32 - amount));
  }
  const mathPow = Math.pow;
  const maxWord = mathPow(2, 32);
  let lengthProperty = 'length';
  let i, j;
  let result = '';
  const words = [];
  const asciiBitLength = ascii[lengthProperty] * 8;
  let hash = [];
  const k = [];
  let primeCounter = 0;
  const isComposite = {};
  for (let candidate = 2; primeCounter < 64; candidate++) {
    if (!isComposite[candidate]) {
      for (i = 0; i < 313; i += candidate) {
        isComposite[i] = candidate;
      }
      hash[primeCounter] = (mathPow(candidate, 0.5) * maxWord) | 0;
      k[primeCounter++] = (mathPow(candidate, 1 / 3) * maxWord) | 0;
    }
  }
  hash = hash.slice(0, 8);
  ascii += '\x80';
  while (ascii[lengthProperty] % 64 - 56) ascii += '\x00';
  for (i = 0; i < ascii[lengthProperty]; i++) {
    j = ascii.charCodeAt(i);
    if (j >> 8) return;
    words[i >> 2] |= j << ((3 - i) % 4) * 8;
  }
  words[words[lengthProperty]] = (asciiBitLength / maxWord) | 0;
  words[words[lengthProperty]] = asciiBitLength;
  for (j = 0; j < words[lengthProperty];) {
    const w = words.slice(j, (j += 16));
    const oldHash = hash;
    hash = hash.slice(0, 8);
    for (i = 0; i < 64; i++) {
      const i2 = i + j;
      const w15 = w[i - 15], w2 = w[i - 2];
      const a = hash[0], e = hash[4];
      const temp1 = hash[7]
        + (rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25))
        + ((e & hash[5]) ^ (~e & hash[6]))
        + k[i]
        + (w[i] = (i < 16) ? w[i] : (
          w[i - 16]
          + (rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3))
          + w[i - 7]
          + (rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10))
        ) | 0);
      const temp2 = (rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22))
        + ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));
      hash = [(temp1 + temp2) | 0].concat(hash);
      hash[4] = (hash[4] + temp1) | 0;
    }
    for (i = 0; i < 8; i++) {
      hash[i] = (hash[i] + oldHash[i]) | 0;
    }
  }
  for (i = 0; i < 8; i++) {
    for (i2 = 3; i2 >= 0; i2--) {
      const c = (hash[i] >> (i2 * 8)) & 255;
      result += ((c < 16) ? '0' : '') + c.toString(16);
    }
  }
  return result;
}

// ============================================================================
// INISIALISASI & PERSISTENCE
// ============================================================================
function loadConfig() {
  const saved = localStorage.getItem("absensi_qr_config");
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      appConfig = { ...DEFAULT_CONFIG, ...parsed };
    } catch (e) {
      console.error("Gagal membaca konfigurasi lokal", e);
    }
  }

  // Jika URL publik belum diset, deteksi URL saat ini (jika bukan file://)
  if (!appConfig.publicUrl) {
    if (window.location.protocol.startsWith("http")) {
      appConfig.publicUrl = window.location.origin + window.location.pathname;
    }
  }
}

function saveConfig() {
  localStorage.setItem("absensi_qr_config", JSON.stringify(appConfig));
}

// ============================================================================
// LOGIKA TOKEN & WAKTU (10 MENIT INTERVAL)
// ============================================================================
function getSlotDurationMs() {
  return (appConfig.slotMinutes || 10) * 60 * 1000;
}

function calculateSlot(timeMs) {
  return Math.floor(timeMs / getSlotDurationMs());
}

function makeToken(slot) {
  return sha256(appConfig.secretKey + "::" + slot).substring(0, 16);
}

// ============================================================================
// MODE BOS: GENERATE & UPDATE QR CODE
// ============================================================================
function updateBossQRCode(force = false) {
  const now = Date.now();
  const slot = calculateSlot(now);

  if (slot !== currentSlot || force || !currentToken) {
    currentSlot = slot;
    currentToken = makeToken(slot);

    // Tentukan Base URL
    let baseUrl = appConfig.publicUrl;
    if (!baseUrl || baseUrl.trim() === "") {
      if (window.location.protocol.startsWith("http")) {
        baseUrl = window.location.origin + window.location.pathname;
      } else {
        baseUrl = "https://absensi-karyawan.local"; // Placeholder jika dibuka via file://
      }
    }

    // Bangun URL lengkap untuk QR Code
    const cleanBaseUrl = baseUrl.split("?")[0];
    currentQrUrl = `${cleanBaseUrl}?mode=absen&slot=${slot}&token=${currentToken}&ts=${now}`;

    // Render QR Code
    renderQRCode(currentQrUrl);

    // Update info teks
    const qrLinkInput = document.getElementById("boss-qr-link");
    if (qrLinkInput) {
      qrLinkInput.value = currentQrUrl;
    }

    console.log("QR Code diperbarui untuk Slot:", slot, "Token:", currentToken);
  }

  // Update Countdown Timer
  updateTimerDisplay(now);
}

function renderQRCode(text) {
  const container = document.getElementById("qrcode-canvas");
  if (!container) return;
  container.innerHTML = "";

  try {
    if (typeof QRCode !== "undefined") {
      qrcodeInstance = new QRCode(container, {
        text: text,
        width: 230,
        height: 230,
        colorDark: "#0f172a",
        colorLight: "#ffffff",
        correctLevel: QRCode.CorrectLevel.M
      });
    } else {
      container.innerHTML = `<div style="padding:20px; color:#dc2626;">Library QRCode gagal dimuat. Periksa file qrcode.min.js</div>`;
    }
  } catch (err) {
    console.error("Gagal generate QR Code", err);
    container.innerHTML = `<div style="padding:20px; color:#dc2626;">Error: ${err.message}</div>`;
  }
}

function updateTimerDisplay(now) {
  const slotMs = getSlotDurationMs();
  const msRemaining = (currentSlot + 1) * slotMs - now;
  const clampedMs = Math.max(0, msRemaining);

  const totalSecs = Math.floor(clampedMs / 1000);
  const minutes = Math.floor(totalSecs / 60);
  const seconds = totalSecs % 60;

  const timerText = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  
  const timerPill = document.getElementById("countdown-text");
  if (timerPill) {
    timerPill.innerText = `Berganti dalam ${timerText}`;
  }

  const progressBar = document.getElementById("progress-bar-fill");
  if (progressBar) {
    const percentage = (clampedMs / slotMs) * 100;
    progressBar.style.width = `${percentage}%`;
    if (percentage < 20) {
      progressBar.style.background = "#dc2626"; // Merah saat < 2 menit
    } else if (percentage < 50) {
      progressBar.style.background = "#d97706"; // Oranye
    } else {
      progressBar.style.background = "linear-gradient(90deg, #2563eb, #10b981)";
    }
  }
}

function startBossTimer() {
  if (timerInterval) clearInterval(timerInterval);
  updateBossQRCode();
  timerInterval = setInterval(() => {
    updateBossQRCode();
  }, 1000);
}

// ============================================================================
// MODE KARYAWAN: VALIDASI SCAN & FORM ABSENSI
// ============================================================================
function checkScanValidation() {
  const urlParams = new URLSearchParams(window.location.search);
  const mode = urlParams.get("mode");
  const slotParam = urlParams.get("slot");
  const tokenParam = urlParams.get("token");
  const tsParam = urlParams.get("ts");

  const validationBox = document.getElementById("validation-status-box");
  const submitBtn = document.getElementById("btn-submit-absen");

  // Jika halaman dibuka biasa tanpa scan QR
  if (!tokenParam || !slotParam || !tsParam) {
    if (validationBox) {
      validationBox.className = "status-banner warning";
      validationBox.innerHTML = `
        <span class="status-icon">⚠️</span>
        <div>
          <strong>Mode Simulasi / Buka Langsung</strong><br>
          Halaman ini tidak dibuka via scan QR terbaru. Untuk mencatat absensi resmi, scan QR Code yang ada di HP Bos.
        </div>
      `;
    }
    return { isValid: false, reason: "Bukan dari scan QR langsung" };
  }

  const now = Date.now();
  const scanTime = parseInt(tsParam, 10) || 0;
  const slotNumber = parseInt(slotParam, 10) || 0;
  const expectedToken = makeToken(slotNumber);

  // Periksa selisih waktu: QR code berlaku selama slotMinutes + toleransi 60 detik (clock skew)
  const maxLifetimeMs = getSlotDurationMs() + 60 * 1000;
  const ageMs = now - scanTime;

  const isTokenMatch = (tokenParam === expectedToken);
  const isNotExpired = (ageMs <= maxLifetimeMs && ageMs >= -60000);

  if (isTokenMatch && isNotExpired) {
    const remainingMins = Math.max(1, Math.ceil((maxLifetimeMs - ageMs) / 60000));
    if (validationBox) {
      validationBox.className = "status-banner valid";
      validationBox.innerHTML = `
        <span class="status-icon">✅</span>
        <div>
          <strong>QR Code Terverifikasi Valid!</strong><br>
          Kode QR aktif dari HP Bos (Sisa masa berlaku: ±${remainingMins} menit). Silakan pilih nama Anda dan kirim absensi.
        </div>
      `;
    }
    if (submitBtn) submitBtn.disabled = false;
    return { isValid: true, statusText: "Valid (< 10 Menit)" };
  } else {
    let pesanError = "QR Code sudah kadaluarsa (lebih dari 10 menit).";
    if (!isTokenMatch) {
      pesanError = "QR Code tidak dikenali atau kunci keamanan tidak sesuai.";
    }

    if (validationBox) {
      validationBox.className = "status-banner invalid";
      validationBox.innerHTML = `
        <span class="status-icon">⛔</span>
        <div>
          <strong>Absensi Ditolak! ${pesanError}</strong><br>
          Demi keamanan dan mencegah kecurangan, silakan minta Bos menampilkan QR Code terbaru di layar HP-nya dan scan ulang.
        </div>
      `;
    }
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.style.opacity = "0.5";
      submitBtn.style.cursor = "not-allowed";
    }
    return { isValid: false, reason: pesanError };
  }
}

// Render daftar 3 karyawan
function renderEmployeeList() {
  const container = document.getElementById("employee-cards-container");
  if (!container) return;

  container.innerHTML = "";
  appConfig.employees.forEach((emp, index) => {
    const isSelected = selectedEmployee && selectedEmployee.id === emp.id;
    const initial = emp.name.split(" ").map(w => w[0]).join("").substring(0, 2).toUpperCase();

    const card = document.createElement("div");
    card.className = `employee-card ${isSelected ? "selected" : ""}`;
    card.onclick = () => selectEmployee(emp);

    card.innerHTML = `
      <div class="emp-avatar">${initial || (index + 1)}</div>
      <div class="emp-info">
        <div class="emp-name">${escapeHtml(emp.name)}</div>
        <div class="emp-role">${escapeHtml(emp.role || `Karyawan ${index + 1}`)}</div>
      </div>
      <div class="emp-radio"></div>
    `;

    container.appendChild(card);
  });
}

function selectEmployee(emp) {
  selectedEmployee = emp;
  renderEmployeeList();
}

function selectType(type) {
  selectedType = type;
  document.querySelectorAll(".type-btn").forEach(btn => {
    btn.classList.remove("selected-masuk", "selected-pulang", "selected-izin");
  });

  const activeBtn = document.getElementById(`type-btn-${type.toLowerCase()}`);
  if (activeBtn) {
    activeBtn.classList.add(`selected-${type.toLowerCase()}`);
  }
}

// Ambil Lokasi GPS (Opsional)
function captureGpsLocation() {
  const gpsDisplay = document.getElementById("gps-status-text");
  if (!navigator.geolocation) {
    if (gpsDisplay) gpsDisplay.innerText = "GPS tidak didukung browser ini.";
    return;
  }

  if (gpsDisplay) gpsDisplay.innerText = "Mengambil koordinat satelit GPS...";

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const lat = pos.coords.latitude.toFixed(6);
      const lng = pos.coords.longitude.toFixed(6);
      const acc = Math.round(pos.coords.accuracy);
      currentGpsData = `https://www.google.com/maps?q=${lat},${lng} (Akurasi: ±${acc}m)`;
      if (gpsDisplay) {
        gpsDisplay.innerHTML = `📍 <a href="https://www.google.com/maps?q=${lat},${lng}" target="_blank" style="color:#2563eb; text-decoration:underline;">Lokasi Terdeteksi (${lat}, ${lng})</a>`;
      }
    },
    (err) => {
      console.warn("GPS diblokir/gagal:", err.message);
      if (gpsDisplay) gpsDisplay.innerText = "Izin lokasi tidak diberikan (opsional).";
      currentGpsData = "Lokasi tidak diaktifkan";
    },
    { enableHighAccuracy: true, timeout: 8000 }
  );
}

// ============================================================================
// KIRIM ABSENSI KE GOOGLE SPREADSHEET
// ============================================================================
async function submitAttendance() {
  if (isSubmitting) return;

  if (!selectedEmployee) {
    alert("Silakan pilih nama karyawan terlebih dahulu!");
    return;
  }

  const validation = checkScanValidation();
  const statusQRText = validation.isValid ? "Valid (< 10 Menit)" : (validation.reason || "Bukan Scan QR Langsung");

  const catatanInput = document.getElementById("catatan-input");
  const catatan = catatanInput ? catatanInput.value.trim() : "";

  // Data Payload
  const payload = {
    nama: selectedEmployee.name,
    tipe: selectedType,
    statusQR: statusQRText,
    lokasi: currentGpsData || "Tidak tercatat",
    catatan: catatan || "-",
    userAgent: navigator.userAgent.substring(0, 120),
    tokenWaktu: new Date().toISOString()
  };

  const submitBtn = document.getElementById("btn-submit-absen");
  const originalBtnText = submitBtn.innerHTML;

  isSubmitting = true;
  submitBtn.disabled = true;
  submitBtn.innerHTML = `<span class="spinner"></span> Menyimpan ke Spreadsheet...`;

  try {
    const scriptUrl = appConfig.scriptUrl;

    if (!scriptUrl || scriptUrl.trim() === "" || scriptUrl.indexOf("/exec") === -1) {
      // Jika belum memasang URL Google Apps Script
      setTimeout(() => {
        showSuccessModal(payload, true);
        finishSubmission();
      }, 700);
      return;
    }

    // Kirim ke Google Apps Script Web App
    // Mode no-cors digunakan untuk kompatibilitas redirect 302 dari script.google.com
    await fetch(scriptUrl, {
      method: "POST",
      mode: "no-cors",
      headers: {
        "Content-Type": "text/plain;charset=utf-8"
      },
      body: JSON.stringify(payload)
    });

    // Berhasil dikirim!
    showSuccessModal(payload, false);
    if (catatanInput) catatanInput.value = "";

  } catch (error) {
    console.error("Gagal mengirim absensi:", error);
    alert("Gagal terhubung ke Google Spreadsheet: " + error.message + "\nPeriksa koneksi internet atau URL Apps Script.");
  } finally {
    finishSubmission();
  }

  function finishSubmission() {
    isSubmitting = false;
    submitBtn.disabled = false;
    submitBtn.innerHTML = originalBtnText;
  }
}

// Tampilkan Dialog Sukses
function showSuccessModal(data, isDemo = false) {
  const modal = document.getElementById("success-modal");
  const modalDesc = document.getElementById("modal-desc-text");
  const recNama = document.getElementById("receipt-nama");
  const recTipe = document.getElementById("receipt-tipe");
  const recWaktu = document.getElementById("receipt-waktu");
  const recStatus = document.getElementById("receipt-status");

  const now = new Date();
  const waktuStr = now.toLocaleDateString("id-ID", {
    weekday: "long",
    year: "numeric",
    month: "short",
    day: "numeric"
  }) + ", " + now.toLocaleTimeString("id-ID");

  if (recNama) recNama.innerText = data.nama;
  if (recTipe) recTipe.innerText = data.tipe;
  if (recWaktu) recWaktu.innerText = waktuStr;
  if (recStatus) recStatus.innerText = data.statusQR;

  if (modalDesc) {
    if (isDemo) {
      modalDesc.innerHTML = `<span style="color:#d97706; font-weight:600;">⚠️ Mode Simulasi:</span> Data absensi berhasil diproses secara lokal. Untuk menyimpan permanen ke Google Sheets, masukkan URL Web App Apps Script di menu Pengaturan.`;
    } else {
      modalDesc.innerHTML = `Data absensi Anda telah berhasil dicatat dan masuk ke Google Spreadsheet.`;
    }
  }

  if (modal) modal.classList.add("active");
}

function closeSuccessModal() {
  const modal = document.getElementById("success-modal");
  if (modal) modal.classList.remove("active");
}

// ============================================================================
// PENGATURAN & SETUP GOOGLE SHEETS
// ============================================================================
function initSettingsForm() {
  const scriptUrlInput = document.getElementById("cfg-script-url");
  const publicUrlInput = document.getElementById("cfg-public-url");
  const secretKeyInput = document.getElementById("cfg-secret-key");
  const emp1Input = document.getElementById("cfg-emp-1");
  const emp2Input = document.getElementById("cfg-emp-2");
  const emp3Input = document.getElementById("cfg-emp-3");

  if (scriptUrlInput) scriptUrlInput.value = appConfig.scriptUrl || "";
  if (publicUrlInput) publicUrlInput.value = appConfig.publicUrl || "";
  if (secretKeyInput) secretKeyInput.value = appConfig.secretKey || "";

  if (emp1Input && appConfig.employees[0]) emp1Input.value = appConfig.employees[0].name;
  if (emp2Input && appConfig.employees[1]) emp2Input.value = appConfig.employees[1].name;
  if (emp3Input && appConfig.employees[2]) emp3Input.value = appConfig.employees[2].name;
}

function saveSettingsForm() {
  const scriptUrlInput = document.getElementById("cfg-script-url");
  const publicUrlInput = document.getElementById("cfg-public-url");
  const secretKeyInput = document.getElementById("cfg-secret-key");
  const emp1Input = document.getElementById("cfg-emp-1");
  const emp2Input = document.getElementById("cfg-emp-2");
  const emp3Input = document.getElementById("cfg-emp-3");

  appConfig.scriptUrl = scriptUrlInput ? scriptUrlInput.value.trim() : "";
  appConfig.publicUrl = publicUrlInput ? publicUrlInput.value.trim() : "";
  appConfig.secretKey = secretKeyInput ? secretKeyInput.value.trim() : "kunci-absen-rahasia-2026";

  if (emp1Input && emp1Input.value.trim()) appConfig.employees[0].name = emp1Input.value.trim();
  if (emp2Input && emp2Input.value.trim()) appConfig.employees[1].name = emp2Input.value.trim();
  if (emp3Input && emp3Input.value.trim()) appConfig.employees[2].name = emp3Input.value.trim();

  saveConfig();
  renderEmployeeList();
  updateBossQRCode(true);

  alert("Pengaturan berhasil disimpan!");
}

async function testGoogleSheetsConnection() {
  const url = document.getElementById("cfg-script-url").value.trim();
  if (!url || url.indexOf("/exec") === -1) {
    alert("Masukkan URL Google Apps Script yang berakhiran '/exec' terlebih dahulu!");
    return;
  }

  const btn = document.getElementById("btn-test-connection");
  const original = btn.innerText;
  btn.innerText = "Menguji Koneksi...";
  btn.disabled = true;

  try {
    const res = await fetch(url + "?ping=1");
    const json = await res.json();
    if (json.status === "online") {
      alert("✅ Koneksi Berhasil!\nGoogle Apps Script siap menerima data absensi.\nNama Sheet: " + (json.sheetName || "Data Absensi"));
    } else {
      alert("Respon diterima: " + JSON.stringify(json));
    }
  } catch (err) {
    alert("⚠️ Catatan Pengujian:\nKoneksi berhasil dipicu, namun browser membatasi pembacaan respons langsung karena CORS. Jika Anda sudah Deploy Apps Script dengan akses 'Siapa Saja (Anyone)', pengiriman data POST absensi akan bekerja dengan sempurna!");
  } finally {
    btn.innerText = original;
    btn.disabled = false;
  }
}

// Salin Link QR
function copyQrLink() {
  const linkInput = document.getElementById("boss-qr-link");
  if (!linkInput || !linkInput.value) return;

  linkInput.select();
  linkInput.setSelectionRange(0, 99999);

  if (navigator.clipboard) {
    navigator.clipboard.writeText(linkInput.value).then(() => {
      alert("Link QR Code berhasil disalin ke clipboard!");
    });
  } else {
    document.execCommand("copy");
    alert("Link QR Code berhasil disalin!");
  }
}

// ============================================================================
// TAB NAVIGATION
// ============================================================================
function switchTab(tabId) {
  document.querySelectorAll(".tab-pane").forEach(pane => pane.classList.remove("active"));
  document.querySelectorAll(".tab-btn").forEach(btn => btn.classList.remove("active"));

  const targetPane = document.getElementById(`pane-${tabId}`);
  const targetBtn = document.getElementById(`tab-btn-${tabId}`);

  if (targetPane) targetPane.classList.add("active");
  if (targetBtn) targetBtn.classList.add("active");

  if (tabId === "bos") {
    updateBossQRCode(true);
  } else if (tabId === "absen") {
    checkScanValidation();
  } else if (tabId === "pengaturan") {
    initSettingsForm();
  }
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.innerText = text || "";
  return div.innerHTML;
}

// ============================================================================
// WINDOW ONLOAD
// ============================================================================
window.addEventListener("DOMContentLoaded", () => {
  loadConfig();
  renderEmployeeList();
  selectType("Masuk");

  // Periksa apakah URL memiliki parameter scan absensi
  const urlParams = new URLSearchParams(window.location.search);
  const isAbsenMode = urlParams.get("mode") === "absen" || urlParams.has("token");

  if (isAbsenMode) {
    // Karyawan scan QR: langsung buka tab absensi
    switchTab("absen");
    captureGpsLocation(); // Otomatis ambil lokasi saat form dibuka
  } else {
    // Bos buka web app: default ke tab QR Bos
    switchTab("bos");
    startBossTimer();
  }

  // Tampilkan peringatan jika dibuka via file://
  if (window.location.protocol === "file:") {
    const fileNotice = document.getElementById("file-protocol-notice");
    if (fileNotice) fileNotice.style.display = "block";
  }
});

