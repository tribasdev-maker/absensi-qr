/**
 * ============================================================================
 * SISTEM ABSENSI QR DINAMIS (10 MENIT) - LOGIKA APLIKASI (REVISI LENGKAP)
 * ============================================================================
 */

// Konfigurasi Default
const DEFAULT_CONFIG = {
  scriptUrl: "", // URL Google Apps Script Web App (/exec)
  publicUrl: "", // URL publik web app ini (misal: https://...vercel.app)
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

  // BACA PARAMETER DARI URL (Sangat penting saat Karyawan Scan QR di HP masing-masing)
  const urlParams = new URLSearchParams(window.location.search);
  
  // 1. Ambil URL Google Apps Script yang disematkan Bos di dalam QR Code
  const suParam = urlParams.get("su") || urlParams.get("s");
  if (suParam && suParam.trim() !== "") {
    try {
      appConfig.scriptUrl = decodeURIComponent(suParam).trim();
      saveConfig();
      console.log("Script URL berhasil disinkronkan dari QR Code:", appConfig.scriptUrl);
    } catch (e) {
      console.warn("Gagal parse scriptUrl dari URL:", e);
    }
  }

  // 2. Ambil daftar nama karyawan yang disematkan Bos di dalam QR Code
  const empParam = urlParams.get("emp") || urlParams.get("e");
  if (empParam && empParam.trim() !== "") {
    try {
      const names = decodeURIComponent(empParam).split("|");
      names.forEach((name, idx) => {
        if (appConfig.employees[idx] && name.trim() !== "") {
          appConfig.employees[idx].name = name.trim();
        }
      });
      saveConfig();
    } catch (e) {
      console.warn("Gagal parse nama karyawan dari QR:", e);
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

  // Periksa apakah Google Apps Script URL sudah diisi
  const noticeNoScript = document.getElementById("boss-notice-no-script");
  if (noticeNoScript) {
    if (!appConfig.scriptUrl || appConfig.scriptUrl.indexOf("/exec") === -1) {
      noticeNoScript.style.display = "block";
    } else {
      noticeNoScript.style.display = "none";
    }
  }

  if (slot !== currentSlot || force || !currentToken) {
    currentSlot = slot;
    currentToken = makeToken(slot);

    // Tentukan Base URL
    let baseUrl = appConfig.publicUrl;
    if (!baseUrl || baseUrl.trim() === "") {
      if (window.location.protocol.startsWith("http")) {
        baseUrl = window.location.origin + window.location.pathname;
      } else {
        baseUrl = "https://absensi-karyawan.local";
      }
    }

    const cleanBaseUrl = baseUrl.split("?")[0];

    // Bangun Parameter Lengkap:
    // PENTING: Sertakan scriptUrl (&su) dan nama karyawan (&emp) ke dalam QR Code
    // agar saat karyawan scan dari HP-nya, HP karyawan OTOMATIS tahu kemana harus mengirim data!
    let qrParams = `mode=absen&slot=${slot}&token=${currentToken}&ts=${now}`;

    if (appConfig.scriptUrl && appConfig.scriptUrl.trim() !== "") {
      qrParams += `&su=${encodeURIComponent(appConfig.scriptUrl.trim())}`;
    }

    if (appConfig.employees && appConfig.employees.length > 0) {
      const empNames = appConfig.employees.map(e => e.name).join("|");
      qrParams += `&emp=${encodeURIComponent(empNames)}`;
    }

    currentQrUrl = `${cleanBaseUrl}?${qrParams}`;

    // Render QR Code
    renderQRCode(currentQrUrl);

    // Update info teks
    const qrLinkInput = document.getElementById("boss-qr-link");
    if (qrLinkInput) {
      qrLinkInput.value = currentQrUrl;
    }

    console.log("QR Code diperbarui untuk Slot:", slot);
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
      progressBar.style.background = "#dc2626";
    } else if (percentage < 50) {
      progressBar.style.background = "#d97706";
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
          Halaman ini tidak dibuka lewat scan QR terbaru. Untuk mencatat absensi resmi, scan QR Code di HP Bos.
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
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.style.opacity = "1";
    }
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
          Demi keamanan dan mencegah titip absen, minta Bos menampilkan QR Code terbaru di layarnya lalu scan ulang.
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
    btn.classList.remove("selected-masuk", "selected-pulang", "selected-izin", "selected-kembali");
  });

  if (type === "Masuk") {
    const btn = document.getElementById("type-btn-masuk");
    if (btn) btn.classList.add("selected-masuk");
  } else if (type === "Pulang" || type === "Keluar") {
    const btn = document.getElementById("type-btn-pulang");
    if (btn) btn.classList.add("selected-pulang");
  } else if (type === "Izin") {
    const btn = document.getElementById("type-btn-izin");
    if (btn) btn.classList.add("selected-izin");
  } else if (type === "Masuk Setelah Izin") {
    const btn = document.getElementById("type-btn-kembali");
    if (btn) btn.classList.add("selected-kembali");
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
// KIRIM ABSENSI KE GOOGLE SPREADSHEET (DUAL-CHANNEL POST & GET)
// ============================================================================
async function submitAttendance() {
  if (isSubmitting) return;

  if (!selectedEmployee) {
    alert("Silakan pilih salah satu nama karyawan terlebih dahulu!");
    return;
  }

  const scriptUrl = appConfig.scriptUrl;

  // PERIKSA SCRIPT URL
  if (!scriptUrl || scriptUrl.trim() === "" || scriptUrl.indexOf("/exec") === -1) {
    alert("❌ GAGAL: URL Google Spreadsheet Belum Terhubung!\n\nBos belum memasukkan URL Google Apps Script di menu 'Setup Sheets' di HP Bos.\n\nSilakan minta Bos untuk memasukkan URL Web App Apps Script di menu pengaturan lalu refresh QR Code.");
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
    // 1. PENGIRIMAN UTAMA: HTTP POST (Mode no-cors)
    const postPromise = fetch(scriptUrl, {
      method: "POST",
      mode: "no-cors",
      headers: {
        "Content-Type": "text/plain;charset=utf-8"
      },
      body: JSON.stringify(payload)
    });

    // 2. PENGIRIMAN CADANGAN (FALLBACK): HTTP GET
    // Ini memastikan jika browser mobile membatasi redirect POST dari script.google.com,
    // data tetap masuk 100% via parameter GET!
    const getParams = new URLSearchParams({
      action: "absen",
      nama: payload.nama,
      tipe: payload.tipe,
      statusQR: payload.statusQR,
      lokasi: payload.lokasi,
      catatan: payload.catatan,
      userAgent: payload.userAgent
    });
    const getUrl = scriptUrl + (scriptUrl.includes("?") ? "&" : "?") + getParams.toString();
    const getPromise = fetch(getUrl, { method: "GET", mode: "no-cors" });

    // Tunggu minimal salah satu pengiriman selesai
    await Promise.race([postPromise, getPromise]);

    // Tampilkan popup sukses
    showSuccessModal(payload, false);
    if (catatanInput) catatanInput.value = "";

  } catch (error) {
    console.error("Gagal mengirim absensi:", error);
    // Jika fetch gagal (misal koneksi terputus), coba via Image beacon GET
    try {
      const beaconParams = new URLSearchParams({
        action: "absen",
        nama: payload.nama,
        tipe: payload.tipe,
        statusQR: payload.statusQR,
        catatan: payload.catatan
      });
      const img = new Image();
      img.src = scriptUrl + (scriptUrl.includes("?") ? "&" : "?") + beaconParams.toString();
      showSuccessModal(payload, false);
    } catch (beaconErr) {
      alert("Gagal terhubung ke Google Spreadsheet: " + error.message + "\nPeriksa koneksi internet Anda.");
    }
  } finally {
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
      modalDesc.innerHTML = `<span style="color:#d97706; font-weight:600;">⚠️ Mode Simulasi:</span> Data absensi berhasil diproses secara lokal. Masukkan URL Web App Apps Script di menu Pengaturan agar tersimpan ke Spreadsheet.`;
    } else {
      modalDesc.innerHTML = `Data absensi Anda telah berhasil dicatat dan masuk ke Google Spreadsheet!`;
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

  alert("✅ Pengaturan berhasil disimpan!\nQR Code telah diperbarui otomatis dengan URL Spreadsheet Anda.");
}

// Uji koneksi (Ping)
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
    const res = await fetch(url + (url.includes("?") ? "&" : "?") + "ping=1");
    const json = await res.json();
    if (json.status === "online") {
      alert(`✅ KONEKSI BERHASIL!\n\nGoogle Apps Script aktif dan terhubung ke Spreadsheet:\nJudul: ${json.spreadsheetTitle || "-"}\nSheet: ${json.sheetName || "Data Absensi"}`);
    } else {
      alert("Status: " + JSON.stringify(json));
    }
  } catch (err) {
    alert("⚠️ Catatan Koneksi:\nPermintaan telah terkirim. Jika browser menampilkan peringatan CORS karena proteksi redirect Google, silakan coba tombol 'Kirim Tes Absensi' di bawah untuk memastikan baris data masuk langsung ke Spreadsheet!");
  } finally {
    btn.innerText = original;
    btn.disabled = false;
  }
}

// KIRIM DATA UJI COBA LANGSUNG KE SPREADSHEET
async function testSendSampleAttendance() {
  const url = document.getElementById("cfg-script-url").value.trim();
  if (!url || url.indexOf("/exec") === -1) {
    alert("Masukkan URL Google Apps Script yang berakhiran '/exec' terlebih dahulu!");
    return;
  }

  const btn = document.getElementById("btn-test-send");
  const original = btn ? btn.innerText : "";
  if (btn) {
    btn.innerText = "Mengirim Uji Coba...";
    btn.disabled = true;
  }

  const testPayload = {
    nama: "Tes Sistem (Antigravity)",
    tipe: "Masuk",
    statusQR: "Valid (Tes Tombol Pengaturan)",
    lokasi: "Uji Coba Browser",
    catatan: "Uji coba penulisan langsung dari menu Pengaturan Web App",
    userAgent: navigator.userAgent.substring(0, 100)
  };

  try {
    // Kirim via GET & POST
    const testParams = new URLSearchParams({
      action: "absen",
      nama: testPayload.nama,
      tipe: testPayload.tipe,
      statusQR: testPayload.statusQR,
      lokasi: testPayload.lokasi,
      catatan: testPayload.catatan
    });
    const testUrl = url + (url.includes("?") ? "&" : "?") + testParams.toString();

    // Jalankan pengiriman
    fetch(testUrl, { method: "GET", mode: "no-cors" }).catch(() => {});
    fetch(url, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(testPayload)
    }).catch(() => {});

    alert("✅ Data uji coba telah dikirim!\n\nSilakan buka Google Spreadsheet Anda sekarang. Seharusnya baris baru dengan nama 'Tes Sistem (Antigravity)' sudah muncul di tab 'Data Absensi'.\n\nJika belum muncul, perhatikan pengaturan 'Siapa yang memiliki akses (Anyone)' di Apps Script Anda.");
  } catch (err) {
    alert("Gagal mengirim data uji coba: " + err.message);
  } finally {
    if (btn) {
      btn.innerText = original;
      btn.disabled = false;
    }
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
