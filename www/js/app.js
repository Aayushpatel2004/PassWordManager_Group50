// --- EMAILJS CONFIG (REPLACE THESE) ---
const EMAIL_SERVICE_ID = "service_ofj9x4n"; 
const EMAIL_TEMPLATE_ID = "template_qh753tv"; 
const EMAIL_PUBLIC_KEY = "N_C8UlV-Cu2NP1_Ob"; 

// --- STATE ---
let masterKey = null;
let vaultData = [];
let is2FAEnabled = false;
let userEmail = "";
let currentOTP = "";

// --- CRYPTO ---
const deriveKey = (p, s) => CryptoJS.PBKDF2(p, s, { keySize: 256/32, iterations: 100000 }).toString(CryptoJS.enc.Hex);
const encrypt = (d, k) => CryptoJS.AES.encrypt(d, k).toString();
const decrypt = (c, k) => CryptoJS.AES.decrypt(c, k).toString(CryptoJS.enc.Utf8);
const generateRandom = (len=16) => {
    const c = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*";
    let p = ""; for(let i=0; i<len; i++) p += c[Math.floor(Math.random()*c.length)];
    return p;
};

function init() {
    // Init EmailJS
    if(EMAIL_PUBLIC_KEY !== "xxxx_public_key") emailjs.init(EMAIL_PUBLIC_KEY);

    // Check if vault exists (User has onboarded)
    if(localStorage.getItem('vaultSalt')) {
        showAuthCard('card-login');
        
        // Load User Email
        if(localStorage.getItem('userEmail')) {
            userEmail = localStorage.getItem('userEmail');
            // Pre-fill settings email if element exists
            const settingsEmailInput = document.getElementById('settings-email');
            if(settingsEmailInput) settingsEmailInput.value = userEmail;
        }

        // Load 2FA State
        // CRITICAL FIX: Ensure this is only true if explicitly set to 'true'
        if(localStorage.getItem('is2FA') === 'true') {
            is2FAEnabled = true;
            const toggle = document.getElementById('setting-2fa-toggle');
            if(toggle) toggle.checked = true;
        } else {
            is2FAEnabled = false; // Default to false
            const toggle = document.getElementById('setting-2fa-toggle');
            if(toggle) toggle.checked = false;
        }
    } else {
        // User has NOT onboarded yet
        showAuthCard('card-setup');
    }
}

// --- AUTH FLOW ---
document.getElementById('btn-start-setup').onclick = () => {
    const p1 = document.getElementById('setup-pass').value;
    const p2 = document.getElementById('setup-pass-confirm').value;
    const email = document.getElementById('setup-email').value;
    
    if(p1.length < 8) return alert("Password too short (min 8 chars).");
    if(p1 !== p2) return alert("Passwords do not match.");
    if(!email.includes('@')) return alert("Invalid email.");

    const salt = CryptoJS.lib.WordArray.random(128/8).toString();
    const key = deriveKey(p1, salt);
    const recKey = generateRandom(32);
    const bundle = encrypt(key, recKey);

    // Save Setup Data
    localStorage.setItem('vaultSalt', salt);
    localStorage.setItem('recoveryBundle', bundle);
    localStorage.setItem('userEmail', email);
    localStorage.setItem('encryptedVault', encrypt(JSON.stringify([]), key));
    
    // Set 2FA to FALSE by default on setup
    localStorage.setItem('is2FA', 'false');
    is2FAEnabled = false;

    document.getElementById('recovery-key-text').innerText = recKey;
    document.getElementById('setup-recovery-display').classList.remove('hidden');
    document.getElementById('btn-start-setup').classList.add('hidden');
    
    document.getElementById('btn-finish-setup').onclick = () => location.reload();
};

document.getElementById('btn-unlock').onclick = () => {
    const pass = document.getElementById('login-pass').value;
    const salt = localStorage.getItem('vaultSalt');
    if(!salt) return;

    const key = deriveKey(pass, salt);
    try {
        const raw = decrypt(localStorage.getItem('encryptedVault'), key);
        if(!raw) throw new Error();
        
        masterKey = key;
        vaultData = JSON.parse(raw);

        // ONLY ask for OTP if 2FA is Enabled AND we have an email
        if(is2FAEnabled && userEmail) {
            sendOTP();
        } else {
            launchDashboard();
        }
    } catch(e) { 
        console.error(e);
        alert("Incorrect Password."); 
    }
};

// --- OTP LOGIC ---
function sendOTP() {
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    currentOTP = code;
    
    document.getElementById('otp-email-display').innerText = userEmail;
    showAuthCard('card-otp');

    if(EMAIL_PUBLIC_KEY === "xxxx_public_key") {
        alert(`[DEMO MODE] EmailJS keys missing in code.\nOTP: ${code}`);
        console.log("OTP:", code);
        return;
    }
    
    emailjs.send(EMAIL_SERVICE_ID, EMAIL_TEMPLATE_ID, {
        to_email: userEmail,
        otp_code: code
    }).then(() => {
        alert(`Code sent to ${userEmail}`);
    }, (err) => {
        console.error(err);
        alert(`Failed to send email (Check console).\nDemo Fallback OTP: ${code}`);
    });
}

document.getElementById('btn-verify-otp').onclick = () => {
    if(document.getElementById('otp-input').value === currentOTP) launchDashboard();
    else alert("Invalid Code");
};

window.resendOTP = () => sendOTP();

// --- RECOVERY ---
document.getElementById('btn-use-recovery').onclick = () => showAuthCard('card-recovery');

document.getElementById('btn-do-recover').onclick = () => {
    const rKey = document.getElementById('recovery-key-input').value.trim();
    try {
        const bundle = localStorage.getItem('recoveryBundle');
        const key = decrypt(bundle, rKey);
        if(!key) throw new Error();
        masterKey = key;
        vaultData = JSON.parse(decrypt(localStorage.getItem('encryptedVault'), masterKey));
        alert("Recovery Successful!");
        launchDashboard();
    } catch(e) { alert("Invalid Recovery Key."); }
};

// --- CHANGE PASSWORD (DANGER ZONE) ---
window.changeMasterPassword = () => {
    const oldP = document.getElementById('cp-old').value;
    const newP = document.getElementById('cp-new').value;
    const confP = document.getElementById('cp-confirm').value;
    const salt = localStorage.getItem('vaultSalt');

    // 1. Verify Old
    const oldKey = deriveKey(oldP, salt);
    try {
        const test = decrypt(localStorage.getItem('encryptedVault'), oldKey);
        if(!test) throw new Error();
    } catch(e) { return alert("Current password incorrect."); }

    // 2. Validate New
    if(newP.length < 8) return alert("New password too short.");
    if(newP !== confP) return alert("New passwords do not match.");

    // 3. Re-Encrypt
    const newSalt = CryptoJS.lib.WordArray.random(128/8).toString();
    const newKey = deriveKey(newP, newSalt);
    
    // 4. New Recovery Key
    const newRecKey = generateRandom(32);
    const newBundle = encrypt(newKey, newRecKey);
    const newVault = encrypt(JSON.stringify(vaultData), newKey);

    // 5. Save
    localStorage.setItem('vaultSalt', newSalt);
    localStorage.setItem('recoveryBundle', newBundle);
    localStorage.setItem('encryptedVault', newVault);

    // 6. UI
    closeModal('modal-change-pass');
    document.getElementById('new-rec-key-display').innerText = newRecKey;
    document.getElementById('modal-new-rec').classList.remove('hidden');
    
    // Update masterKey in memory
    masterKey = newKey;
};

// --- EMAIL SETTINGS LOGIC (NEW) ---
window.saveSettingsEmail = () => {
    const newEmail = document.getElementById('settings-email').value;
    if(!newEmail.includes('@')) return alert("Please enter a valid email address.");
    
    userEmail = newEmail;
    localStorage.setItem('userEmail', userEmail);
    alert("Recovery Email Updated!");
};

// --- DASHBOARD ---
function launchDashboard() {
    document.getElementById('auth-wrapper').classList.remove('active', 'flex');
    document.getElementById('auth-wrapper').classList.add('hidden');
    document.getElementById('dashboard-wrapper').classList.remove('hidden');
    document.getElementById('dashboard-wrapper').classList.add('flex');
    renderVault();
}

function renderVault() {
    const grid = document.getElementById('vault-grid');
    grid.innerHTML = "";
    const term = document.getElementById('search-bar').value.toLowerCase();
    const filtered = vaultData.filter(i => i.site.toLowerCase().includes(term));
    
    if(filtered.length === 0) {
        grid.innerHTML = `<div class="text-center text-slate-400 py-10 text-xs">No passwords found.</div>`;
        return;
    }

    filtered.forEach(item => {
        const el = document.createElement('div');
        el.className = "bg-white p-4 rounded-2xl shadow-sm border border-slate-100 flex justify-between items-center";
        el.innerHTML = `
            <div class="flex items-center gap-3">
                <div class="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 font-bold text-lg uppercase">${item.site[0]}</div>
                <div><h3 class="font-bold text-slate-700 text-sm">${item.site}</h3><p class="text-xs text-slate-400">${item.user}</p></div>
            </div>
            <button onclick="copyText('${item.pass}')" class="text-primary bg-blue-50 px-3 py-1 rounded-lg text-[10px] font-bold">COPY</button>
        `;
        grid.appendChild(el);
    });
}

// --- UTILS ---
document.getElementById('btn-save').onclick = () => {
    const item = { id: Date.now().toString(), site: document.getElementById('modal-site').value, user: document.getElementById('modal-user').value, pass: document.getElementById('modal-pass').value };
    if(!item.site || !item.pass) return alert("Missing fields");
    vaultData.push(item);
    localStorage.setItem('encryptedVault', encrypt(JSON.stringify(vaultData), masterKey));
    renderVault();
    closeModal('modal-item');
    document.getElementById('modal-site').value = ""; document.getElementById('modal-pass').value = "";
};

window.switchTab = (id, btn) => {
    document.querySelectorAll('.subview').forEach(el => el.classList.remove('active'));
    document.getElementById(id).classList.add('active');
    document.querySelectorAll('.nav-btn').forEach(b => { b.classList.remove('text-primary', 'active'); b.classList.add('text-slate-400'); });
    btn.classList.remove('text-slate-400'); btn.classList.add('text-primary', 'active');
    
    // Update email display if switching to settings
    if(id === 'subview-settings') {
        const settingsEmailInput = document.getElementById('settings-email');
        if(settingsEmailInput) settingsEmailInput.value = userEmail || "";
    }
};

document.getElementById('setting-2fa-toggle').onchange = (e) => { is2FAEnabled = e.target.checked; localStorage.setItem('is2FA', is2FAEnabled); };

function showAuthCard(id) { ['card-setup', 'card-login', 'card-otp', 'card-recovery'].forEach(c => document.getElementById(c).classList.add('hidden')); document.getElementById(id).classList.remove('hidden'); }
function togglePass(id) { const el = document.getElementById(id); el.type = el.type === 'password' ? 'text' : 'password'; }
function updateGenUI(val) { const len = val || document.getElementById('len-val').innerText; document.getElementById('len-val').innerText = len; document.getElementById('gen-display').innerText = generateRandom(len); }
function copyText(t) { navigator.clipboard.writeText(t); alert("Copied!"); }
function openModal(id) { document.getElementById(id).classList.remove('hidden'); }
function closeModal(id) { document.getElementById(id).classList.add('hidden'); }
document.getElementById('search-bar').oninput = renderVault;

init();
updateGenUI(16);