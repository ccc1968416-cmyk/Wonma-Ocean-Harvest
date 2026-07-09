// Constants & State & Resilient Storage Helper
function safeJSONParse(key, fallback) {
    try {
        const item = localStorage.getItem(key);
        if (!item || item === 'undefined' || item === 'null' || item === '') return fallback;
        const parsed = JSON.parse(item);
        return parsed !== null && parsed !== undefined ? parsed : fallback;
    } catch (e) {
        console.warn(`[System Resilient] Recovered corrupted storage key: ${key}`, e);
        return fallback;
    }
}

const STORAGE_KEY = 'wonma_fisheries_data';
const DRAFT_KEY = 'wonma_fisheries_draft';

// --- Self-Healing Data Sanitizer (Removes Corrupted Mojibake / Short Dates from storage) ---
function sanitizeRecordsList(list, key) {
    if (!Array.isArray(list)) return [];
    let modified = false;
    const cleanList = list.filter(r => {
        if (!r) return false;
        const name = String(r.clientName || r.name || r.remarks || '');
        // Detect corrupted Latin-1 mojibake bytes exactly without false positives
        const hasMojibake = name.includes('') || name.includes('\uFFFD') || name.includes('ì') || name.includes('ë') || name.includes('í') || name.includes('£') || name.includes('ï') || name.includes('ã');
        if (hasMojibake) {
            console.warn('[System Resilient] Removing corrupted mojibake record:', name);
            modified = true;
            return false;
        }
        // Fix short dates like 6-27-26 or 06-27-26 -> 2026-06-27
        if (r.date && /^\d{1,2}-\d{1,2}-\d{2}$/.test(r.date)) {
            const parts = r.date.split('-');
            r.date = `20${parts[2]}-${String(parts[0]).padStart(2, '0')}-${String(parts[1]).padStart(2, '0')}`;
            modified = true;
        }
        return true;
    });
    if (modified && key) {
        localStorage.setItem(key, JSON.stringify(cleanList));
    }
    return cleanList;
}

let records = sanitizeRecordsList(safeJSONParse(STORAGE_KEY, []), STORAGE_KEY);


// Settings State
const SETTINGS_KEY = 'wonma_settings';
const DEFAULT_SETTINGS = {
    themeLight: false,
    fontSize: 'normal',
    unpaidDays: 14,
    stockAlert: true,
    vatInclude: false,
    prices: { maesaengi: 0, miyeok: 0, dasima: 0 },
    receipt: {
        companyName: '원마수산',
        bizNumber: '123-45-67890',
        address: '전라남도 완도군 완도읍',
        phone: '061-123-4567',
        stampImg: ''
    }
};
let settings = safeJSONParse(SETTINGS_KEY, DEFAULT_SETTINGS);
// Merge missing keys in case of update
settings = { ...DEFAULT_SETTINGS, ...settings, prices: { ...DEFAULT_SETTINGS.prices, ...settings.prices }, receipt: { ...DEFAULT_SETTINGS.receipt, ...settings.receipt } };

function saveSettings() {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function applyThemeSettings() {
    if (settings.themeLight) {
        document.body.classList.add('theme-light');
    } else {
        document.body.classList.remove('theme-light');
    }
    
    document.body.classList.remove('font-sm', 'font-lg');
    if (settings.fontSize !== 'normal') {
        document.body.classList.add(`font-${settings.fontSize}`);
    }
}
applyThemeSettings();

// DOM Elements
const formModal = document.getElementById('formModal');
const openModalBtn = document.getElementById('openModalBtn');
const closeModalBtn = document.getElementById('closeModalBtn');
const cancelBtn = document.getElementById('cancelBtn');
const recordForm = document.getElementById('recordForm');
const tableBody = document.getElementById('tableBody');
const emptyState = document.getElementById('emptyState');
const modalTitle = document.getElementById('modalTitle');

// Inputs
const quantityInput = document.getElementById('quantity');
const unitPriceInput = document.getElementById('unitPrice');
const amountInput = document.getElementById('amount');
const itemFilter = document.getElementById('itemFilter');
const searchInput = document.getElementById('searchInput');
const filterStartDate = document.getElementById('filterStartDate');
const filterEndDate = document.getElementById('filterEndDate');
const paymentAmountInput = document.getElementById('paymentAmount');
const unpaidAmountInput = document.getElementById('unpaidAmount');

// Stats Elements (KPIs)
const kpiTotalRevenueEl = document.getElementById('kpiTotalRevenue');
const kpiRevenueTrendEl = document.getElementById('kpiRevenueTrend');
const kpiTotalPaidEl = document.getElementById('kpiTotalPaid');
const kpiPaidRatioEl = document.getElementById('kpiPaidRatio');
const kpiTotalUnpaidEl = document.getElementById('kpiTotalUnpaid');
const kpiUnpaidCountEl = document.getElementById('kpiUnpaidCount');
const kpiTopClientEl = document.getElementById('kpiTopClient');
const kpiTopClientAmountEl = document.getElementById('kpiTopClientAmount');

const smartAlertsPanel = document.getElementById('smartAlertsPanel');
const smartAlertText = document.getElementById('smartAlertText');

// ============================================================
// --- WONMA FISHERIES CROSS-DEVICE CLOUD SYNC & AUTO-REFRESH ---
// ============================================================
const WONMA_APP_VERSION = '20260709_20';
let lastCheckTime = 0;
let lastSyncTimestamp = Number(localStorage.getItem('wonma_sync_timestamp') || 0);

async function checkAutoUpdateOnMobileLaunch() {
    try {
        if (Date.now() - lastCheckTime < 8000) return; // Prevent spamming
        lastCheckTime = Date.now();
        const res = await fetch(window.location.pathname + '?t=' + Date.now(), {
            method: 'GET',
            cache: 'no-store',
            headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' }
        });
        if (res.ok) {
            const html = await res.text();
            const match = html.match(/app\.js\?v=([a-zA-Z0-9_]+)/);
            if (match && match[1] && match[1] !== WONMA_APP_VERSION) {
                console.log(`[Auto-Update] New version detected (${match[1]} vs ${WONMA_APP_VERSION}). Auto-refreshing PWA...`);
                window.location.reload(true);
            }
        }
    } catch (e) {
        // Offline or fetch error
    }
}

async function pushCredentialsToCloud(pin, pwd) {
    try {
        const payloadObj = {
            pin: String(pin || '1234'),
            pwd: String(pwd || 'admin'),
            updatedAt: Date.now()
        };
        const payloadStr = JSON.stringify(payloadObj);
        localStorage.setItem('wonma_sync_timestamp', payloadObj.updatedAt);
        
        // Primary Redundant Sync: kvdb.io
        fetch('https://kvdb.io/ADnE39zZ6kS1zP2E68d2M/wonma_creds', {
            method: 'PUT',
            body: payloadStr
        }).catch(() => {});

        // Secondary Redundant Sync: api.keyvalue.xyz
        fetch('https://api.keyvalue.xyz/3e7284f1/wonma_creds', {
            method: 'POST',
            body: payloadStr
        }).catch(() => {});

        console.log('[Cloud Sync] Successfully synchronized PIN & Password to Redundant Cloud Hub.');
    } catch (e) {
        console.warn('[Cloud Sync] Push fallback:', e);
    }
}

async function syncPinAndPasswordFromCloud() {
    try {
        let data = null;
        try {
            const res = await fetch('https://kvdb.io/ADnE39zZ6kS1zP2E68d2M/wonma_creds?t=' + Date.now(), { cache: 'no-store' });
            if (res.ok) data = await res.json();
        } catch (e) {}

        if (!data) {
            try {
                const res2 = await fetch('https://api.keyvalue.xyz/3e7284f1/wonma_creds?t=' + Date.now(), { cache: 'no-store' });
                if (res2.ok) data = await res2.json();
            } catch (e) {}
        }

        if (data && data.pin && data.pwd) {
            const cloudTime = Number(data.updatedAt || 0);
            if (cloudTime > lastSyncTimestamp || data.pin !== ADMIN_PIN || data.pwd !== ADMIN_PASSWORD) {
                ADMIN_PIN = String(data.pin);
                ADMIN_PASSWORD = String(data.pwd);
                localStorage.setItem('wonma_admin_pin', ADMIN_PIN);
                localStorage.setItem('wonma_admin_pwd', ADMIN_PASSWORD);
                localStorage.setItem('wonma_sync_timestamp', cloudTime);
                lastSyncTimestamp = cloudTime;
                console.log('[Cloud Sync] Updated local credentials from Cloud Sync Hub.');
            }
        } else {
            // First time initialization: push PC's current PIN & Password to Cloud so Mobile receives it immediately
            if (localStorage.getItem('wonma_admin_pin') || localStorage.getItem('wonma_admin_pwd')) {
                pushCredentialsToCloud(ADMIN_PIN, ADMIN_PASSWORD);
            }
        }
    } catch (e) {
        // Offline fallback
    }
}

// Automatically sync & check for update when app opens on mobile or PC
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
        checkAutoUpdateOnMobileLaunch();
        syncPinAndPasswordFromCloud();
    }
});
window.addEventListener('focus', () => {
    checkAutoUpdateOnMobileLaunch();
    syncPinAndPasswordFromCloud();
});

// Initialization
document.addEventListener('DOMContentLoaded', () => {
    checkAuth();
    renderTable();
    updateStats();
    checkAutoUpdateOnMobileLaunch();
    syncPinAndPasswordFromCloud();
    // Proactively sync local credentials on startup
    setTimeout(() => {
        if (localStorage.getItem('wonma_admin_pin')) {
            pushCredentialsToCloud(ADMIN_PIN, ADMIN_PASSWORD);
        }
    }, 1000);
});

// Login Management
let ADMIN_PASSWORD = localStorage.getItem('wonma_admin_pwd') || 'admin';
let ADMIN_PIN = localStorage.getItem('wonma_admin_pin') || '1234';
let currentPinInput = '';

const loginOverlay = document.getElementById('loginOverlay');
const loginForm = document.getElementById('loginForm');
const loginError = document.getElementById('loginError');
const togglePasswordBtn = document.getElementById('togglePasswordBtn');
const logoutBtn = document.getElementById('logoutBtn');

let currentLoginName = "최고 관리자";

// Initialize personalized greeting
function initLoginGreeting() {
    const savedProfile = safeJSONParse('wonma_profile', { name: "최고 관리자", pic: null });
    currentLoginName = savedProfile.name || "최고 관리자";
    
    const loginGreetingTitle = document.getElementById('loginGreetingTitle');
    const loginAvatarBadge = document.getElementById('loginAvatarBadge');
    const loginGreetingSubText = document.getElementById('loginGreetingSubText');
    
    if (loginGreetingTitle) {
        loginGreetingTitle.innerHTML = `<span style="color: var(--primary); font-size: 18px; font-weight: 600; display: block; margin-bottom: 6px;">다시 오셨군요,</span> ${currentLoginName} 사장님`;
    }
    if (loginGreetingSubText) {
        loginGreetingSubText.textContent = `${currentLoginName} 접속 중`;
    }
    if (loginAvatarBadge) {
        if (savedProfile.pic) {
            loginAvatarBadge.innerHTML = `<img src="${savedProfile.pic}" style="width: 100%; height: 100%; object-fit: cover;">`;
        } else {
            loginAvatarBadge.innerHTML = `<img src="./logo.png" style="width: 100%; height: 100%; object-fit: cover; padding: 0;">`;
        }
    }
}

function checkAuth() {
    const isAuth = sessionStorage.getItem('wonma_auth');
    if (!isAuth) {
        document.getElementById('loginOverlay').classList.add('active');
        initLoginGreeting();
        return false;
    }
    document.getElementById('loginOverlay').classList.remove('active');
    document.querySelector('.app-container').classList.add('ready');
    return true;
}

function triggerLoginSuccess() {
    sessionStorage.setItem('wonma_auth', 'true');
    if(loginError) loginError.style.display = 'none';
    const pinLoginError = document.getElementById('pinLoginError');
    if(pinLoginError) pinLoginError.style.display = 'none';
    
    document.getElementById('adminPassword').value = '';
    if(window.clearPinInput) window.clearPinInput();
    
    const savedProfile = safeJSONParse('wonma_profile', { name: "최고 관리자", pic: null });
    const welcomeGreeting = document.getElementById('welcomeGreetingText') || document.querySelector('.welcome-greeting');
    const welcomeAvatarImg = document.getElementById('welcomeAvatarImg');
    const welcomeAvatarWrapper = document.getElementById('welcomeAvatarWrapper');
    
    if (welcomeGreeting) {
        welcomeGreeting.textContent = `${savedProfile.name || "최고 관리자"}님,`;
    }
    if (welcomeAvatarImg && welcomeAvatarWrapper) {
        if (savedProfile.pic) {
            welcomeAvatarImg.src = savedProfile.pic;
            welcomeAvatarImg.style.objectFit = "cover";
            welcomeAvatarImg.style.padding = "0";
            welcomeAvatarWrapper.style.border = "3px solid #38bdf8";
        } else {
            welcomeAvatarImg.src = "./logo.png";
            welcomeAvatarImg.style.objectFit = "cover";
            welcomeAvatarImg.style.padding = "0";
            welcomeAvatarWrapper.style.border = "3.5px solid #38bdf8";
        }
    }

    // Show welcome motion screen
    document.getElementById('loginOverlay').classList.remove('active');
    const welcomeOverlay = document.getElementById('welcomeOverlay');
    welcomeOverlay.classList.add('active');
    
    setTimeout(() => {
        welcomeOverlay.classList.add('exiting');
        setTimeout(() => {
            welcomeOverlay.classList.remove('active');
            welcomeOverlay.classList.remove('exiting');
            document.querySelector('.app-container').classList.add('ready');
        }, 1500);
    }, 12000);
}

// Muted PIN sound effect per user request
let audioCtx = null;
function playHapticBeep(freq = 1200, type = 'sine', duration = 0.035, vol = 0.12) {
    return; // Silent mode
}

function updatePinDots() {
    for(let i=1; i<=4; i++) {
        const dot = document.getElementById(`pinDot${i}`);
        if(dot) {
            dot.classList.remove('success');
            if(i <= currentPinInput.length) {
                dot.classList.add('filled');
            } else {
                dot.classList.remove('filled');
                dot.style.transform = '';
            }
        }
    }
}

window.handlePinInput = function(digit) {
    if(currentPinInput.length < 4) {
        currentPinInput += digit;
        
        // 2026 Apple / Swiss Bank Harmonic Marimba Chime!
        const baseFreq = 950 + (parseInt(digit) * 75);
        playHapticBeep(baseFreq, 'triangle', 0.045, 0.16);
        
        // Visual key press animation (works smoothly on both touch & click)
        const keyEl = document.getElementById(`pinKey${digit}`);
        if(keyEl) {
            keyEl.classList.add('pressed');
            setTimeout(() => keyEl.classList.remove('pressed'), 140);
        }
        
        updatePinDots();
        
        if(currentPinInput.length === 4) {
            setTimeout(() => {
                if(currentPinInput === ADMIN_PIN) {
                    // Apple Pay / Toss Success Chord!
                    playHapticBeep(587.33, 'triangle', 0.12, 0.22);
                    setTimeout(() => playHapticBeep(880, 'triangle', 0.3, 0.25), 90);
                    
                    // All dots pulse with Toss cyan wave!
                    for(let i=1; i<=4; i++) {
                        const d = document.getElementById(`pinDot${i}`);
                        if(d) {
                            d.classList.add('success');
                        }
                    }
                    setTimeout(() => {
                        triggerLoginSuccess();
                    }, 320);
                } else {
                    // Error warning buzz!
                    playHapticBeep(220, 'sawtooth', 0.2, 0.22);
                    
                    // Error Shake animation
                    const wrapper = document.querySelector('.pin-display-wrapper');
                    if(wrapper) wrapper.classList.add('shake-dots');
                    
                    const pinLoginError = document.getElementById('pinLoginError');
                    if(pinLoginError) {
                        pinLoginError.textContent = '비밀번호가 일치하지 않습니다. 다시 입력해주세요.';
                        pinLoginError.style.display = 'block';
                    }
                    
                    setTimeout(() => {
                        if(wrapper) wrapper.classList.remove('shake-dots');
                        window.clearPinInput();
                    }, 520);
                }
            }, 140);
        }
    }
};

window.clearPinInput = function() {
    currentPinInput = '';
    playHapticBeep(650, 'sine', 0.04, 0.12);
    const keyEl = document.getElementById('pinKeyReset');
    if(keyEl) {
        keyEl.classList.add('pressed');
        setTimeout(() => keyEl.classList.remove('pressed'), 140);
    }
    const wrapper = document.querySelector('.pin-display-wrapper');
    if(wrapper) wrapper.classList.remove('shake-dots');
    updatePinDots();
    const pinLoginError = document.getElementById('pinLoginError');
    if(pinLoginError) pinLoginError.style.display = 'none';
};

window.deletePinInput = function() {
    if(currentPinInput.length > 0) {
        currentPinInput = currentPinInput.slice(0, -1);
        playHapticBeep(850, 'sine', 0.035, 0.14);
        const keyEl = document.getElementById('pinKeyDel');
        if(keyEl) {
            keyEl.classList.add('pressed');
            setTimeout(() => keyEl.classList.remove('pressed'), 140);
        }
        const wrapper = document.querySelector('.pin-display-wrapper');
        if(wrapper) wrapper.classList.remove('shake-dots');
        updatePinDots();
        const pinLoginError = document.getElementById('pinLoginError');
        if(pinLoginError) pinLoginError.style.display = 'none';
    }
};

// Global keyboard listener for PIN input
document.addEventListener('keydown', (e) => {
    const isLoginActive = loginOverlay && loginOverlay.classList.contains('active');
    const isPinTabVisible = loginPinSection && loginPinSection.style.display !== 'none';
    
    if (isLoginActive && isPinTabVisible) {
        // If a digit 0-9 is pressed
        if (/^[0-9]$/.test(e.key)) {
            e.preventDefault();
            window.handlePinInput(e.key);
        } else if (e.key === 'Backspace' || e.key === 'Delete') {
            e.preventDefault();
            window.deletePinInput();
        } else if (e.key === 'Escape' || e.key === 'c' || e.key === 'C') {
            e.preventDefault();
            window.clearPinInput();
        }
    }
});

const tabPinLogin = document.getElementById('tabPinLogin');
const tabPwdLogin = document.getElementById('tabPwdLogin');
const loginPinSection = document.getElementById('loginPinSection');

if(tabPinLogin && tabPwdLogin) {
    tabPinLogin.addEventListener('click', () => {
        tabPinLogin.classList.add('active');
        tabPwdLogin.classList.remove('active');
        loginPinSection.style.display = 'block';
        loginForm.style.display = 'none';
    });
    tabPwdLogin.addEventListener('click', () => {
        tabPwdLogin.classList.add('active');
        tabPinLogin.classList.remove('active');
        loginForm.style.display = 'block';
        loginPinSection.style.display = 'none';
    });
}

if (loginForm) {
    loginForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const pwd = document.getElementById('adminPassword').value;
        if (pwd === ADMIN_PASSWORD) {
            triggerLoginSuccess();
        } else {
            loginError.style.display = 'block';
        }
    });
}

if (logoutBtn) {
    logoutBtn.addEventListener('click', (e) => {
        e.preventDefault();
        sessionStorage.removeItem('wonma_auth');
        checkAuth();
        switchView('dashboard');
    });
}

if (togglePasswordBtn) {
    togglePasswordBtn.addEventListener('click', () => {
        const passwordInput = document.getElementById('adminPassword');
        const icon = togglePasswordBtn.querySelector('i');
        if (passwordInput.type === 'password') {
            passwordInput.type = 'text';
            icon.classList.remove('fa-eye');
            icon.classList.add('fa-eye-slash');
        } else {
            passwordInput.type = 'password';
            icon.classList.remove('fa-eye-slash');
            icon.classList.add('fa-eye');
        }
    });
}

// ============================================================
// --- Phase 4: Global Multi-Language & Currency Engine ---
// ============================================================
const I18N_DICT = {
    'ko-KRW': {
        'globe_label': '🇰🇷 KRW (₩)',
        'nav_dash': '대시보드', 'nav_stats': '통계 분석', 'nav_crm': '거래처 관리', 'nav_cal': '결제 캘린더', 'nav_inv': '재고 관리', 'nav_settings': '설정',
        'title_main': '원물 지급 관리 시스템', 'title_sub': '매생이, 미역, 다시마 통합 관리',
        'kpi_rev': '이달의 총 거래액', 'kpi_paid': '이달의 지급 완료', 'kpi_unpaid': '현재 총 미지급 잔액', 'kpi_top': '최대 거래처 (이달)',
        'btn_upload': '엑셀 자동 업로드', 'btn_add': '수기 내역 추가', 'btn_template': '양식 다운로드', 'btn_export': '엑셀 내보내기',
        'brief_1': '오늘 정산 만기 도래', 'brief_2': '이번 주 처리 대상', 'brief_3': '오늘의 입출고',
        'sec_table': '원물 지급 내역 (최근 거래)', 'sec_debtors': '집중 관리 대상 (미지급 상위)', 'sec_time': '실시간 활동 타임라인',
        'sec_goal': '월간 목표 달성률', 'sec_share': '이달의 품목 점유율',
        'search_ph': '거래처명 검색...',
        'th': ['거래처명', '거래일자', '품목', '단위', '수량', '단가', '총액', '지급일자', '지급금액', '미지급 잔액', '계산서', '비고', '관리']
    },
    'en-USD': {
        'globe_label': '🇺🇸 USD ($)',
        'nav_dash': 'Dashboard', 'nav_stats': 'Analytics', 'nav_crm': 'Clients CRM', 'nav_cal': 'Calendar', 'nav_inv': 'Inventory', 'nav_settings': 'Settings',
        'title_main': 'Seafood Payment ERP', 'title_sub': 'Integrated Seaweed & Kelp Management',
        'kpi_rev': 'Monthly Revenue', 'kpi_paid': 'Monthly Paid', 'kpi_unpaid': 'Total Unpaid Balance', 'kpi_top': 'Top Client (Month)',
        'btn_upload': 'Excel Auto Upload', 'btn_add': 'Add Record', 'btn_template': 'Download Template', 'btn_export': 'Export Excel',
        'brief_1': 'Due Today (Settlement)', 'brief_2': 'Due This Week', 'brief_3': "Today's Stock In/Out",
        'sec_table': 'Recent Payment Transactions', 'sec_debtors': 'Top Unpaid Clients (Focus)', 'sec_time': 'Live Activity Timeline',
        'sec_goal': 'Monthly Goal Achievement', 'sec_share': 'Monthly Item Share',
        'search_ph': 'Search client name...',
        'th': ['Client Name', 'Date', 'Item', 'Unit', 'Qty', 'Price', 'Total', 'Pay Date', 'Paid', 'Unpaid Balance', 'Invoice', 'Remarks', 'Actions']
    },
    'ja-JPY': {
        'globe_label': '🇯🇵 JPY (¥)',
        'nav_dash': 'ダッシュボード', 'nav_stats': '統計分析', 'nav_crm': '取引先 CRM', 'nav_cal': 'カレンダー', 'nav_inv': '在庫管理', 'nav_settings': '設定',
        'title_main': '水産物支払管理システム', 'title_sub': 'メセンイ・ワカメ・昆布 統合管理 ERP',
        'kpi_rev': '今月の総取引額', 'kpi_paid': '今月の支払完了', 'kpi_unpaid': '現在未払残高', 'kpi_top': '最大取引先 (今月)',
        'btn_upload': 'Excel自動読込', 'btn_add': '手動追加', 'btn_template': '様式ダウンロード', 'btn_export': 'Excel出力',
        'brief_1': '本日決済期日', 'brief_2': '今週の処理対象', 'brief_3': '本日の入出庫',
        'sec_table': '支払取引履歴 (最近の取引)', 'sec_debtors': '重点管理対象 (未払上位)', 'sec_time': 'リアルタイム活動タイムライン',
        'sec_goal': '月間目標達成率', 'sec_share': '今月の品目シェア',
        'search_ph': '取引先名を検索...',
        'th': ['取引先名', '取引日', '品目', '単位', '数量', '単価', '総額', '支払日', '支払額', '未払残高', '請求書', '備考', '管理']
    },
    'zh-CNY': {
        'globe_label': '🇨🇳 CNY (¥)',
        'nav_dash': '仪表盘', 'nav_stats': '统计分析', 'nav_crm': '客户 CRM', 'nav_cal': '月度日历', 'nav_inv': '库存管理', 'nav_settings': '系统设置',
        'title_main': '水产品结算管理系统', 'title_sub': '海藻、海带与裙带菜综合ERP',
        'kpi_rev': '本月总交易额', 'kpi_paid': '本月已支付', 'kpi_unpaid': '当前未付余额', 'kpi_top': '最大客户 (本月)',
        'btn_upload': 'Excel自动上传', 'btn_add': '添加交易记录', 'btn_template': '下载样式', 'btn_export': '导出Excel',
        'brief_1': '今日到期结算', 'brief_2': '本周处理对象', 'brief_3': '今日出入库',
        'sec_table': '支付交易记录 (近期)', 'sec_debtors': '重点管理对象 (未付前列)', 'sec_time': '实时活动时间轴',
        'sec_goal': '月度目标完成率', 'sec_share': '本月产品份额',
        'search_ph': '搜索客户名称...',
        'th': ['客户名称', '交易日期', '产品', '单位', '数量', '单价', '总计', '支付日期', '已支付', '未付余额', '发票', '备注', '操作']
    }
};

const GLOBAL_CURRENCIES = {
    // 1. 동아시아 (East Asia)
    'ko-KRW': { name: '대한민국 (Korea)', lang: '한국어', symbol: '₩', code: 'KRW', rate: 1, decimals: 0, flag: '🇰🇷', region: 'east-asia', dictKey: 'ko-KRW' },
    'ja-JPY': { name: '일본 (Japan)', lang: '日本語', symbol: '¥', code: 'JPY', rate: 9.5, decimals: 0, flag: '🇯🇵', region: 'east-asia', dictKey: 'ja-JPY' },
    'zh-CNY': { name: '중국 (China)', lang: '中文 (简体)', symbol: '¥', code: 'CNY', rate: 195, decimals: 2, flag: '🇨🇳', region: 'east-asia', dictKey: 'zh-CNY' },
    'zh-TWD': { name: '대만 (Taiwan)', lang: '繁體中文', symbol: 'NT$', code: 'TWD', rate: 43, decimals: 0, flag: '🇹🇼', region: 'east-asia', dictKey: 'zh-CNY' },
    'zh-HKD': { name: '홍콩 (Hong Kong)', lang: '繁體中文', symbol: 'HK$', code: 'HKD', rate: 180, decimals: 2, flag: '🇭🇰', region: 'east-asia', dictKey: 'zh-CNY' },

    // 2. 동남아시아 (Southeast Asia)
    'vi-VND': { name: '베트남 (Vietnam)', lang: 'Tiếng Việt', symbol: '₫', code: 'VND', rate: 0.055, decimals: 0, flag: '🇻🇳', region: 'sea', dictKey: 'en-USD' },
    'th-THB': { name: '태국 (Thailand)', lang: 'ไทย', symbol: '฿', code: 'THB', rate: 38, decimals: 2, flag: '🇹🇭', region: 'sea', dictKey: 'en-USD' },
    'en-SGD': { name: '싱가포르 (Singapore)', lang: 'English / 中文', symbol: 'S$', code: 'SGD', rate: 1030, decimals: 2, flag: '🇸🇬', region: 'sea', dictKey: 'en-USD' },
    'id-IDR': { name: '인도네시아 (Indonesia)', lang: 'Bahasa Indonesia', symbol: 'Rp', code: 'IDR', rate: 0.088, decimals: 0, flag: '🇮🇩', region: 'sea', dictKey: 'en-USD' },
    'ms-MYR': { name: '말레이시아 (Malaysia)', lang: 'Bahasa Melayu', symbol: 'RM', code: 'MYR', rate: 300, decimals: 2, flag: '🇲🇾', region: 'sea', dictKey: 'en-USD' },
    'en-PHP': { name: '필리핀 (Philippines)', lang: 'English / Filipino', symbol: '₱', code: 'PHP', rate: 24, decimals: 2, flag: '🇵🇭', region: 'sea', dictKey: 'en-USD' },

    // 3. 북미 & 오세아니아 (North America & Oceania)
    'en-USD': { name: '미국 (USA)', lang: 'English', symbol: '$', code: 'USD', rate: 1400, decimals: 2, flag: '🇺🇸', region: 'na-oc', dictKey: 'en-USD' },
    'en-CAD': { name: '캐나다 (Canada)', lang: 'English / Français', symbol: 'C$', code: 'CAD', rate: 1000, decimals: 2, flag: '🇨🇦', region: 'na-oc', dictKey: 'en-USD' },
    'en-AUD': { name: '호주 (Australia)', lang: 'English', symbol: 'A$', code: 'AUD', rate: 910, decimals: 2, flag: '🇦🇺', region: 'na-oc', dictKey: 'en-USD' },
    'en-NZD': { name: '뉴질랜드 (New Zealand)', lang: 'English', symbol: 'NZ$', code: 'NZD', rate: 830, decimals: 2, flag: '🇳🇿', region: 'na-oc', dictKey: 'en-USD' },

    // 4. 유럽 & 중동 (Europe & Middle East)
    'eu-EUR': { name: '유럽연합 (Eurozone)', lang: 'Deutsch / Français', symbol: '€', code: 'EUR', rate: 1500, decimals: 2, flag: '🇪🇺', region: 'eu-me', dictKey: 'en-USD' },
    'en-GBP': { name: '영국 (UK)', lang: 'English', symbol: '£', code: 'GBP', rate: 1780, decimals: 2, flag: '🇬🇧', region: 'eu-me', dictKey: 'en-USD' },
    'de-CHF': { name: '스위스 (Switzerland)', lang: 'Deutsch / Français', symbol: 'CHF', code: 'CHF', rate: 1550, decimals: 2, flag: '🇨🇭', region: 'eu-me', dictKey: 'en-USD' },
    'ar-AED': { name: '아랍에미리트 (UAE)', lang: 'العربية / English', symbol: 'AED', code: 'AED', rate: 380, decimals: 2, flag: '🇦🇪', region: 'eu-me', dictKey: 'en-USD' },

    // 5. 남미 & 기타 (South America & Others)
    'pt-BRL': { name: '브라질 (Brazil)', lang: 'Português', symbol: 'R$', code: 'BRL', rate: 240, decimals: 2, flag: '🇧🇷', region: 'sa-other', dictKey: 'en-USD' },
    'es-MXN': { name: '멕시코 (Mexico)', lang: 'Español', symbol: '$', code: 'MXN', rate: 75, decimals: 2, flag: '🇲🇽', region: 'sa-other', dictKey: 'en-USD' },
    'es-ARS': { name: '아르헨티나 (Argentina)', lang: 'Español', symbol: '$', code: 'ARS', rate: 1.4, decimals: 2, flag: '🇦🇷', region: 'sa-other', dictKey: 'en-USD' }
};

function getCurrencyCode() {
    return (settings && settings.languageCurrency) || 'ko-KRW';
}

function convertVal(number) {
    let val = parseFloat(number) || 0;
    const mode = getCurrencyCode();
    const useRate = (settings && settings.useExchangeRate !== undefined) ? settings.useExchangeRate : true;
    const curr = GLOBAL_CURRENCIES[mode] || GLOBAL_CURRENCIES['ko-KRW'];
    if (useRate && curr.rate && curr.rate !== 1) {
        val = val / curr.rate;
    }
    return val;
}

function formatCurrency(number) {
    if (number === null || number === undefined || isNaN(number) || number === '') return '';
    const mode = getCurrencyCode();
    const val = convertVal(number);
    const curr = GLOBAL_CURRENCIES[mode] || GLOBAL_CURRENCIES['ko-KRW'];
    
    if (curr.decimals === 0) {
        return curr.symbol + ' ' + new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(Math.round(val));
    } else {
        return curr.symbol + ' ' + new Intl.NumberFormat('en-US', { minimumFractionDigits: curr.decimals, maximumFractionDigits: curr.decimals }).format(val);
    }
}

function openGlobeModal() {
    const modal = document.getElementById('globeModal');
    if (modal) {
        modal.style.display = 'flex';
        modal.classList.add('active');
    }
    
    renderGlobeCards('all');
    
    const tog = document.getElementById('modalExchangeToggle');
    if (tog) {
        tog.checked = (settings && settings.useExchangeRate !== undefined) ? settings.useExchangeRate : true;
    }
}

function closeGlobeModal() {
    const modal = document.getElementById('globeModal');
    if (modal) {
        modal.classList.remove('active');
        setTimeout(() => {
            if (!modal.classList.contains('active')) modal.style.display = 'none';
        }, 300);
    }
}

function renderGlobeCards(regionFilter = 'all') {
    const container = document.getElementById('globeCardsContainer');
    if (!container) return;
    
    const cur = getCurrencyCode();
    let html = '';
    
    Object.entries(GLOBAL_CURRENCIES).forEach(([key, curr]) => {
        if (regionFilter !== 'all' && curr.region !== regionFilter) return;
        
        const isActive = (key === cur);
        const rateDesc = (curr.code === 'KRW') ? '기본 (1:1)' : 
                         (curr.code === 'JPY' || curr.code === 'VND' || curr.code === 'IDR') ? `100${curr.code} = 약 ${new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 1 }).format(curr.rate * 100)}원` :
                         `1${curr.code} = 약 ${new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 1 }).format(curr.rate)}원`;
        
        html += `
            <div class="globe-card ${isActive ? 'active' : ''}" id="card-${key}" onclick="selectGlobeOption('${key}')" style="background: rgba(255,255,255,0.03); border: 2px solid ${isActive ? '#38bdf8' : 'rgba(255,255,255,0.1)'}; border-radius: 14px; padding: 14px; cursor: pointer; transition: all 0.2s; display: flex; flex-direction: column; gap: 6px; position: relative;">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <span style="font-size: 26px;">${curr.flag}</span>
                    <span class="globe-check" style="color: #38bdf8; font-size: 18px; display: ${isActive ? 'inline-block' : 'none'};"><i class="fa-solid fa-circle-check"></i></span>
                </div>
                <div>
                    <strong style="display: block; color: #f8fafc; font-size: 15px; font-weight: 700;">${curr.name}</strong>
                    <div style="font-size: 12px; color: #38bdf8; font-weight: 600; margin-top: 2px;">${curr.lang} (${curr.symbol} ${curr.code})</div>
                    <div style="font-size: 11px; color: #94a3b8; margin-top: 4px;">💱 ${rateDesc}</div>
                </div>
            </div>
        `;
    });
    
    container.innerHTML = html;
}

function filterGlobeRegion(region, btnEl) {
    document.querySelectorAll('.region-tab').forEach(b => {
        b.classList.remove('btn-primary', 'active');
        b.classList.add('btn-secondary');
    });
    if (btnEl) {
        btnEl.classList.remove('btn-secondary');
        btnEl.classList.add('btn-primary', 'active');
    }
    renderGlobeCards(region);
}

function selectGlobeOption(val) {
    changeLanguageCurrency(val);
    const activeTab = document.querySelector('.region-tab.active');
    let reg = 'all';
    if (activeTab) {
        const match = activeTab.getAttribute('onclick')?.match(/'([^']+)'/);
        if (match) reg = match[1];
    }
    renderGlobeCards(reg);
    setTimeout(closeGlobeModal, 350);
}

function changeLanguageCurrency(val) {
    if (!settings) settings = {};
    settings.languageCurrency = val;
    saveSettings();
    
    const selTop = document.getElementById('quickLangSelect');
    const selSet = document.getElementById('setLanguageCurrency');
    if (selTop && selTop.value !== val) selTop.value = val;
    if (selSet && selSet.value !== val) selSet.value = val;
    
    applyLanguageTranslations();
    renderTable();
    updateStats();
    if (window.renderCRM) window.renderCRM();
    if (window.renderCalendar) window.renderCalendar();
}

function toggleExchangeRate(checked) {
    if (!settings) settings = {};
    settings.useExchangeRate = checked;
    saveSettings();
    renderTable();
    updateStats();
    if (window.renderCRM) window.renderCRM();
    if (window.renderCalendar) window.renderCalendar();
}

function applyLanguageTranslations() {
    const mode = getCurrencyCode();
    const curr = GLOBAL_CURRENCIES[mode] || GLOBAL_CURRENCIES['ko-KRW'];
    const dict = I18N_DICT[curr.dictKey] || I18N_DICT['ko-KRW'];
    
    // Populate select options if not already populated with 22 countries
    const selTop = document.getElementById('quickLangSelect');
    const selSet = document.getElementById('setLanguageCurrency');
    if (selSet && selSet.options.length < 10) {
        let opts = '';
        Object.entries(GLOBAL_CURRENCIES).forEach(([key, c]) => {
            opts += `<option value="${key}">${c.flag} ${c.name} (${c.symbol} / ${c.code})</option>`;
        });
        if (selTop) selTop.innerHTML = opts;
        if (selSet) selSet.innerHTML = opts;
        if (selTop) selTop.value = mode;
        if (selSet) selSet.value = mode;
    }
    
    // Update Globe button label
    const globeLbl = document.getElementById('currentLangLabel');
    if (globeLbl) globeLbl.textContent = `${curr.flag} ${curr.code} (${curr.symbol})`;
    
    // Update Header title & subtitle
    const h2El = document.querySelector('.header-title h2');
    if (h2El && dict.title_main) h2El.textContent = dict.title_main;
    const subEl = document.querySelector('.header-title .subtitle');
    if (subEl && dict.title_sub) subEl.textContent = dict.title_sub;
    
    // Update Navigation items (Desktop & Mobile)
    const navDash = document.getElementById('nav-dashboard');
    if (navDash && dict.nav_dash) navDash.innerHTML = `<i class="fa-solid fa-house"></i> ${dict.nav_dash}`;
    const navStats = document.getElementById('nav-statistics');
    if (navStats && dict.nav_stats) navStats.innerHTML = `<i class="fa-solid fa-chart-line"></i> ${dict.nav_stats}`;
    const navCrm = document.getElementById('nav-crm');
    if (navCrm && dict.nav_crm) navCrm.innerHTML = `<i class="fa-solid fa-address-book"></i> ${dict.nav_crm}`;
    const navCal = document.getElementById('nav-calendar');
    if (navCal && dict.nav_cal) navCal.innerHTML = `<i class="fa-solid fa-calendar-days"></i> ${dict.nav_cal}`;
    const navInv = document.getElementById('nav-inventory');
    if (navInv && dict.nav_inv) navInv.innerHTML = `<i class="fa-solid fa-boxes-stacked"></i> ${dict.nav_inv}`;
    const navSet = document.getElementById('nav-settings');
    if (navSet && dict.nav_settings) navSet.innerHTML = `<i class="fa-solid fa-gear"></i> ${dict.nav_settings}`;
    
    // Update KPI card labels
    const elRev = document.querySelector('.stat-card:nth-child(1) .stat-label');
    if (elRev && dict.kpi_rev) elRev.textContent = dict.kpi_rev;
    const elPaid = document.querySelector('.stat-card:nth-child(2) .stat-label');
    if (elPaid && dict.kpi_paid) elPaid.textContent = dict.kpi_paid;
    const elUnpaid = document.querySelector('.stat-card:nth-child(3) .stat-label');
    if (elUnpaid && dict.kpi_unpaid) elUnpaid.textContent = dict.kpi_unpaid;
    const elTop = document.querySelector('.stat-card:nth-child(4) .stat-label');
    if (elTop && dict.kpi_top) elTop.textContent = dict.kpi_top;
    
    // Update Buttons & Inputs
    const btnUpload = document.getElementById('autoUploadBtn');
    if (btnUpload && dict.btn_upload) btnUpload.innerHTML = `<i class="fa-solid fa-file-excel" style="color: #34d399;"></i> ${dict.btn_upload}`;
    const btnAdd = document.getElementById('openModalBtn');
    if (btnAdd && dict.btn_add) btnAdd.innerHTML = `<i class="fa-solid fa-plus"></i> ${dict.btn_add}`;
    const btnTmpl = document.getElementById('downloadTemplateBtn');
    if (btnTmpl && dict.btn_template) btnTmpl.innerHTML = `<i class="fa-solid fa-download"></i> ${dict.btn_template}`;
    const btnExp = document.getElementById('exportCsvBtn');
    if (btnExp && dict.btn_export) btnExp.innerHTML = `<i class="fa-solid fa-file-export"></i> ${dict.btn_export}`;
    const searchInp = document.getElementById('searchInput');
    if (searchInp && dict.search_ph) searchInp.placeholder = dict.search_ph;
    
    // Update Today's Briefing Labels
    const briefItems = document.querySelectorAll('.today-briefing .briefing-label');
    if (briefItems.length >= 3) {
        briefItems[0].textContent = dict.brief_1;
        briefItems[1].textContent = dict.brief_2;
        briefItems[2].textContent = dict.brief_3;
    }
    
    // Update Section Headings
    const dashHeadings = document.querySelectorAll('#view-dashboard .solid-panel h3, #view-dashboard .chart-card h3');
    dashHeadings.forEach(h => {
        const txt = h.textContent || '';
        if (txt.includes('원물 지급 내역') || txt.includes('Payment Transactions') || txt.includes('支払取引') || txt.includes('支付交易')) {
            h.innerHTML = `<i class="fa-solid fa-table-list" style="color: #38bdf8;"></i> ${dict.sec_table}`;
        } else if (txt.includes('집중 관리 대상') || txt.includes('Top Unpaid') || txt.includes('重点管理')) {
            h.innerHTML = `<i class="fa-solid fa-triangle-exclamation" style="color: #f87171;"></i> ${dict.sec_debtors}`;
        } else if (txt.includes('실시간 활동') || txt.includes('Live Activity') || txt.includes('リアルタイム') || txt.includes('实时活动')) {
            h.innerHTML = `<i class="fa-solid fa-clock-rotate-left" style="color: #38bdf8;"></i> ${dict.sec_time}`;
        } else if (txt.includes('월간 목표') || txt.includes('Monthly Goal') || txt.includes('月間目標') || txt.includes('月度目标')) {
            h.innerHTML = `<i class="fa-solid fa-bullseye" style="color: #38bdf8;"></i> ${dict.sec_goal}`;
        } else if (txt.includes('이달의 품목') || txt.includes('Monthly Item') || txt.includes('今月の品目') || txt.includes('本月产品')) {
            h.innerHTML = `<i class="fa-solid fa-chart-pie" style="color: #c084fc;"></i> ${dict.sec_share}`;
        }
    });
    
    // Update Table Columns
    const thEls = document.querySelectorAll('#view-dashboard table thead tr th');
    if (thEls.length && dict.th && dict.th.length <= thEls.length) {
        dict.th.forEach((colName, idx) => {
            if (thEls[idx]) thEls[idx].textContent = colName;
        });
    }
    
    // Sync dropdowns
    if (selTop && selTop.value !== mode) selTop.value = mode;
    if (selSet && selSet.value !== mode) selSet.value = mode;
    
    // Clean up any trailing '원' when currency is not KRW
    if (curr.code !== 'KRW') {
        document.querySelectorAll('.stat-value, .amount-text, td, span, div').forEach(el => {
            if (el.textContent && el.textContent.endsWith('원') && !el.textContent.includes('₩') && !el.textContent.includes('원화')) {
                el.textContent = el.textContent.replace(/원$/, '');
            }
        });
    }
}

window.openGlobeModal = openGlobeModal;
window.closeGlobeModal = closeGlobeModal;
window.selectGlobeOption = selectGlobeOption;
window.changeLanguageCurrency = changeLanguageCurrency;
window.filterGlobeRegion = filterGlobeRegion;
window.renderGlobeCards = renderGlobeCards;
window.toggleExchangeRate = toggleExchangeRate;
window.applyLanguageTranslations = applyLanguageTranslations;

// Save to Local Storage
function saveToStorage() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
}

// Auto-calculate amount
function calculateAmount() {
    const qty = parseFloat(quantityInput.value) || 0;
    const price = parseFloat(unitPriceInput.value) || 0;
    let total = qty * price;
    
    // Apply VAT if setting is enabled
    if (settings && settings.vatInclude) {
        total = Math.round(total * 1.1); // Add 10% VAT
    }
    
    amountInput.value = formatCurrency(total);
    
    const paid = parseFloat(paymentAmountInput.value) || 0;
    const unpaid = total - paid;
    unpaidAmountInput.value = formatCurrency(unpaid);
}

quantityInput.addEventListener('input', calculateAmount);
unitPriceInput.addEventListener('input', calculateAmount);
paymentAmountInput.addEventListener('input', calculateAmount);

// Auto-fill default price on item change
const itemSelect = document.getElementById('item');
itemSelect.addEventListener('change', () => {
    const selectedItem = itemSelect.value;
    let defaultPrice = 0;
    
    if (selectedItem === '매생이') defaultPrice = settings.prices.maesaengi;
    if (selectedItem === '미역') defaultPrice = settings.prices.miyeok;
    if (selectedItem === '다시마') defaultPrice = settings.prices.dasima;
    
    if (defaultPrice > 0 && !document.getElementById('recordId').value) {
        unitPriceInput.value = defaultPrice;
        calculateAmount();
    }
});

// Auto-save form draft
function saveDraft() {
    if (document.getElementById('recordId').value) return; // Do not auto-save when editing existing records
    const draftData = {
        clientName: document.getElementById('clientName').value,
        date: document.getElementById('date').value,
        item: document.getElementById('item').value,
        unit: document.getElementById('unit').value,
        quantity: document.getElementById('quantity').value,
        unitPrice: document.getElementById('unitPrice').value,
        paymentDate: document.getElementById('paymentDate').value,
        paymentAmount: document.getElementById('paymentAmount').value,
        invoiceStatus: document.getElementById('invoiceStatus').value,
        remarks: document.getElementById('remarks').value
    };
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draftData));
}
recordForm.addEventListener('input', saveDraft);

// Modal Management
function openModal(editId = null) {
    recordForm.reset();
    amountInput.value = '';
    document.getElementById('recordId').value = '';
    
    if (editId) {
        modalTitle.textContent = '지급 내역 수정';
        const record = records.find(r => r.id === editId);
        if (record) {
            document.getElementById('recordId').value = record.id;
            document.getElementById('clientName').value = record.clientName;
            document.getElementById('date').value = record.date;
            document.getElementById('item').value = record.item;
            document.getElementById('unit').value = record.unit;
            document.getElementById('quantity').value = record.quantity;
            document.getElementById('unitPrice').value = record.unitPrice;
            document.getElementById('paymentDate').value = record.paymentDate;
            document.getElementById('paymentAmount').value = record.paymentAmount;
            document.getElementById('invoiceStatus').value = record.invoiceStatus;
            document.getElementById('remarks').value = record.remarks;
            calculateAmount();
        }
    } else {
        modalTitle.textContent = '신규 지급 내역 등록';
        const draft = JSON.parse(localStorage.getItem(DRAFT_KEY));
        if (draft) {
            document.getElementById('clientName').value = draft.clientName || '';
            document.getElementById('date').value = draft.date || '';
            if (draft.item) document.getElementById('item').value = draft.item;
            document.getElementById('unit').value = draft.unit || '';
            document.getElementById('quantity').value = draft.quantity || '';
            document.getElementById('unitPrice').value = draft.unitPrice || '';
            document.getElementById('paymentDate').value = draft.paymentDate || '';
            document.getElementById('paymentAmount').value = draft.paymentAmount || '';
            if (draft.invoiceStatus) document.getElementById('invoiceStatus').value = draft.invoiceStatus;
            document.getElementById('remarks').value = draft.remarks || '';
            calculateAmount();
        }
    }
    
    formModal.classList.add('active');
}

function closeModal() {
    formModal.classList.remove('active');
}

openModalBtn.addEventListener('click', () => openModal());
closeModalBtn.addEventListener('click', closeModal);
cancelBtn.addEventListener('click', closeModal);
formModal.addEventListener('click', (e) => {
    if (e.target === formModal) closeModal();
});

// Form Submission
recordForm.addEventListener('submit', (e) => {
    e.preventDefault();
    
    const qty = parseFloat(quantityInput.value) || 0;
    const price = parseFloat(unitPriceInput.value) || 0;
    const calculatedAmount = qty * price;
    
    const formData = {
        id: document.getElementById('recordId').value || Date.now().toString(),
        clientName: document.getElementById('clientName').value,
        date: document.getElementById('date').value,
        item: document.getElementById('item').value,
        unit: document.getElementById('unit').value,
        quantity: qty,
        unitPrice: price,
        amount: calculatedAmount,
        paymentDate: document.getElementById('paymentDate').value,
        paymentAmount: parseFloat(document.getElementById('paymentAmount').value) || 0,
        invoiceStatus: document.getElementById('invoiceStatus').value,
        remarks: document.getElementById('remarks').value
    };

    // --- Phase 2: Credit Limit Check ---
    const targetClient = crmClients.find(c => c.name === formData.clientName);
    if (targetClient) {
        const limit = targetClient.creditLimit || 10000000;
        const otherRecords = records.filter(r => r.clientName === formData.clientName && r.id !== formData.id);
        const currentUnpaid = otherRecords.reduce((s, r) => s + Math.max(0, (r.amount || 0) - (r.paymentAmount || 0)), 0);
        const newUnpaid = currentUnpaid + Math.max(0, formData.amount - (formData.paymentAmount || 0));
        if (newUnpaid > limit) {
            if (!confirm(`🚨 [신용한도 초과 경고]\n'${formData.clientName}'의 미수금 허용 한도(${formatCurrency(limit)}원)를 초과하게 됩니다.\n(예상 누적 미지급금: ${formatCurrency(newUnpaid)}원)\n\n그래도 이 내역을 저장하시겠습니까?`)) {
                return;
            }
        }
    }
    
    const existingIndex = records.findIndex(r => r.id === formData.id);
    if (existingIndex >= 0) {
        records[existingIndex] = formData; // Update
    } else {
        records.push(formData); // Add new
    }
    
    // Sort by date descending
    records.sort((a, b) => new Date(b.date) - new Date(a.date));
    
    saveToStorage();
    if (!document.getElementById('recordId').value) {
        localStorage.removeItem(DRAFT_KEY); // Clear draft on successful new submission
    }
    renderTable();
    updateStats();
    closeModal();
});

// Delete Record
function deleteRecord(id) {
    if (confirm('정말로 이 내역을 삭제하시겠습니까?')) {
        records = records.filter(r => r.id !== id);
        saveToStorage();
        renderTable();
        updateStats();
    }
}

// Render Table
function renderTable() {
    const filterItem = itemFilter.value;
    const filterText = searchInput.value.toLowerCase();
    const startDate = filterStartDate.value;
    const endDate = filterEndDate.value;
    
    const filteredRecords = records.filter(r => {
        const matchItem = filterItem === 'all' || r.item === filterItem;
        const matchSearch = r.clientName.toLowerCase().includes(filterText);
        
        let matchDate = true;
        if (startDate && r.date < startDate) matchDate = false;
        if (endDate && r.date > endDate) matchDate = false;
        
        return matchItem && matchSearch && matchDate;
    });
    
    tableBody.innerHTML = '';
    
    if (filteredRecords.length === 0) {
        emptyState.style.display = 'flex';
    } else {
        emptyState.style.display = 'none';
        
        filteredRecords.forEach(record => {
            let itemBadgeClass = 'badge-maesaengi';
            if (record.item === '미역') itemBadgeClass = 'badge-miyeok';
            if (record.item === '다시마') itemBadgeClass = 'badge-dasima';
            
            const unpaidAmount = record.amount - (record.paymentAmount || 0);
            const unpaidClass = unpaidAmount > 0 ? 'unpaid-text' : '';
            
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><strong>${record.clientName}</strong></td>
                <td>${record.date}</td>
                <td><span class="badge ${itemBadgeClass}">${record.item}</span></td>
                <td>${record.unit || '-'}</td>
                <td class="text-right">${formatCurrency(record.quantity)}</td>
                <td class="text-right">${formatCurrency(record.unitPrice)}원</td>
                <td class="amount-text text-right">${formatCurrency(record.amount)}원</td>
                <td>${record.paymentDate || '-'}</td>
                <td class="amount-text text-right">${record.paymentAmount ? formatCurrency(record.paymentAmount) + '원' : '-'}</td>
                <td class="amount-text text-right ${unpaidClass}">${formatCurrency(unpaidAmount)}원</td>
                <td>${record.invoiceStatus}</td>
                <td>${record.remarks || '-'}</td>
                <td class="text-center">
                    <button class="btn-icon" onclick="copyKakaoBilling('${record.clientName}')" title="카톡/문자 정산 안내문 복사"><i class="fa-solid fa-comment-sms" style="color: #fbbf24;"></i></button>
                    <button class="btn-icon" onclick="printReceipt('${record.id}')" title="명세서 인쇄"><i class="fa-solid fa-print"></i></button>
                    <button class="btn-icon" onclick="openModal('${record.id}')" title="수정"><i class="fa-regular fa-pen-to-square"></i></button>
                    <button class="btn-icon btn-danger" onclick="deleteRecord('${record.id}')" title="삭제"><i class="fa-solid fa-trash"></i></button>
                </td>
            `;
            tableBody.appendChild(tr);
        });
    }
    
    // Also update stats based on filtered data (optional, but good for UX)
    updateStats(filteredRecords);
}

// Update Stats & KPIs
let sparklineRevInstance, sparklinePaidInstance, sparklineUnpaidInstance;

function updateStats(data = records) {
    const today = new Date();
    const currentMonthPrefix = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
    
    // Previous month calculation
    const prevDate = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const prevMonthPrefix = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;

    let thisMonthRev = 0, prevMonthRev = 0;
    let thisMonthPaid = 0;
    let totalUnpaid = 0, unpaidCount = 0;
    const thisMonthClients = {};

    // 7-day sparkline arrays
    const last7Days = [];
    for(let i=6; i>=0; i--) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        last7Days.push(d.toISOString().split('T')[0]);
    }
    const rev7Days = Array(7).fill(0);
    const paid7Days = Array(7).fill(0);
    const unpaid7Days = Array(7).fill(0);

    let overdueUnpaidCount = 0;

    data.forEach(r => {
        const amount = r.amount || 0;
        const paid = r.paymentAmount || 0;
        const unpaid = amount - paid;
        
        // Month stats
        if (r.date && r.date.startsWith(currentMonthPrefix)) {
            thisMonthRev += amount;
            thisMonthPaid += paid;
            thisMonthClients[r.clientName] = (thisMonthClients[r.clientName] || 0) + amount;
        } else if (r.date && r.date.startsWith(prevMonthPrefix)) {
            prevMonthRev += amount;
        }

        // Global Unpaid
        if (unpaid > 0) {
            totalUnpaid += unpaid;
            unpaidCount++;
            
            // Check if overdue based on settings
            if (r.date) {
                const recordDate = new Date(r.date);
                const diffTime = Math.abs(today - recordDate);
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                if (diffDays >= (settings.unpaidDays || 14)) {
                    overdueUnpaidCount++;
                }
            }
        }

        // 7-day sparklines
        const dayIdx = last7Days.indexOf(r.date);
        if (dayIdx !== -1) {
            rev7Days[dayIdx] += amount;
            paid7Days[dayIdx] += paid;
            unpaid7Days[dayIdx] += unpaid;
        }
    });

    // --- 1. Total Revenue ---
    kpiTotalRevenueEl.textContent = formatCurrency(thisMonthRev) + '원';
    if (prevMonthRev > 0) {
        const growth = ((thisMonthRev - prevMonthRev) / prevMonthRev * 100).toFixed(1);
        if (growth > 0) {
            kpiRevenueTrendEl.innerHTML = `<i class="fa-solid fa-arrow-up"></i> ${growth}% (전월대비)`;
            kpiRevenueTrendEl.className = 'stat-trend';
        } else if (growth < 0) {
            kpiRevenueTrendEl.innerHTML = `<i class="fa-solid fa-arrow-down"></i> ${Math.abs(growth)}% (전월대비)`;
            kpiRevenueTrendEl.className = 'stat-trend text-red';
        } else {
            kpiRevenueTrendEl.innerHTML = `- 0% (전월대비)`;
            kpiRevenueTrendEl.className = 'stat-trend neutral-trend';
        }
    } else {
        kpiRevenueTrendEl.innerHTML = `<i class="fa-solid fa-arrow-up"></i> 100% (비교불가)`;
        kpiRevenueTrendEl.className = 'stat-trend';
    }

    // --- 2. Paid Amount ---
    kpiTotalPaidEl.textContent = formatCurrency(thisMonthPaid) + '원';
    const paidRatio = thisMonthRev > 0 ? Math.round((thisMonthPaid / thisMonthRev) * 100) : 0;
    kpiPaidRatioEl.textContent = `${paidRatio}% 지급 완료`;
    kpiPaidRatioEl.className = paidRatio >= 100 ? 'stat-trend' : 'stat-trend neutral-trend';

    // --- 3. Unpaid Balance ---
    kpiTotalUnpaidEl.textContent = formatCurrency(totalUnpaid) + '원';
    kpiUnpaidCountEl.textContent = `${unpaidCount}건의 미지급 내역 존재`;

    // --- 4. Top Client ---
    let topClientName = '-', topClientAmount = 0;
    for (const [client, amt] of Object.entries(thisMonthClients)) {
        if (amt > topClientAmount) {
            topClientAmount = amt;
            topClientName = client;
        }
    }
    kpiTopClientEl.textContent = topClientName;
    kpiTopClientAmountEl.textContent = topClientAmount > 0 ? `${formatCurrency(topClientAmount)}원 매입` : '-';

    // --- 5. Sparklines ---
    if (window.Chart) {
        const sparklineOptions = {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false }, tooltip: { enabled: false } },
            scales: { x: { display: false }, y: { display: false } },
            elements: { point: { radius: 0 }, line: { tension: 0.4, borderWidth: 2 } }
        };

        if (sparklineRevInstance) sparklineRevInstance.destroy();
        const ctxRev = document.getElementById('sparklineRevenue');
        if(ctxRev) sparklineRevInstance = new Chart(ctxRev, { type: 'line', data: { labels: last7Days, datasets: [{ data: rev7Days, borderColor: '#38bdf8', backgroundColor: 'rgba(56, 189, 248, 0.2)', fill: true }] }, options: sparklineOptions });

        if (sparklinePaidInstance) sparklinePaidInstance.destroy();
        const ctxPaid = document.getElementById('sparklinePaid');
        if(ctxPaid) sparklinePaidInstance = new Chart(ctxPaid, { type: 'line', data: { labels: last7Days, datasets: [{ data: paid7Days, borderColor: '#34d399', backgroundColor: 'rgba(52, 211, 153, 0.2)', fill: true }] }, options: sparklineOptions });

        if (sparklineUnpaidInstance) sparklineUnpaidInstance.destroy();
        const ctxUnpaid = document.getElementById('sparklineUnpaid');
        if(ctxUnpaid) sparklineUnpaidInstance = new Chart(ctxUnpaid, { type: 'line', data: { labels: last7Days, datasets: [{ data: unpaid7Days, borderColor: '#f87171', backgroundColor: 'rgba(248, 113, 113, 0.2)', fill: true }] }, options: sparklineOptions });
    }

    // --- 6. Smart Alerts ---
    if (smartAlertsPanel && smartAlertText) {
        if (overdueUnpaidCount > 0) {
            smartAlertsPanel.style.display = 'flex';
            smartAlertsPanel.style.borderLeftColor = '#f87171';
            smartAlertsPanel.querySelector('.alert-icon-wrapper').style.background = 'rgba(248, 113, 113, 0.2)';
            smartAlertsPanel.querySelector('.alert-icon-wrapper').style.color = '#f87171';
            smartAlertText.innerHTML = `현재 설정된 기준일(${settings.unpaidDays}일)을 초과한 <strong>${overdueUnpaidCount}건</strong>의 장기 미지급 내역이 있어 관리가 필요합니다.`;
        } else if (thisMonthRev > prevMonthRev && prevMonthRev > 0) {
            smartAlertsPanel.style.display = 'flex';
            smartAlertsPanel.style.borderLeftColor = '#34d399';
            smartAlertsPanel.querySelector('.alert-icon-wrapper').style.background = 'rgba(52, 211, 153, 0.2)';
            smartAlertsPanel.querySelector('.alert-icon-wrapper').style.color = '#34d399';
            smartAlertText.innerHTML = `훌륭합니다! 이달의 매출이 전월 대비 <strong>${((thisMonthRev - prevMonthRev)/prevMonthRev*100).toFixed(1)}% 상승</strong>했습니다.`;
        } else {
            smartAlertsPanel.style.display = 'none';
        }
    }

    // --- 7. Goal Ring Chart (월간 목표 달성률) ---
    const goalAmount = 100000000; // 1억 목표 (100M)
    const goalPercentage = Math.min(Math.round((thisMonthRev / goalAmount) * 100), 100);
    const goalPercentageText = document.getElementById('goalPercentageText');
    const goalAmountText = document.getElementById('goalAmountText');
    if (goalPercentageText) goalPercentageText.textContent = `${goalPercentage}%`;
    if (goalAmountText) goalAmountText.textContent = `목표: ${formatCurrency(goalAmount)}원`;

    if (window.Chart) {
        const ctxGoal = document.getElementById('goalRingChart');
        if (ctxGoal) {
            if (window.goalRingChartInstance) window.goalRingChartInstance.destroy();
            window.goalRingChartInstance = new Chart(ctxGoal, {
                type: 'doughnut',
                data: {
                    datasets: [{
                        data: [thisMonthRev, Math.max(0, goalAmount - thisMonthRev)],
                        backgroundColor: ['#38bdf8', '#334155'],
                        borderWidth: 0,
                        cutout: '80%',
                        borderRadius: 20
                    }]
                },
                options: { responsive: true, maintainAspectRatio: false, plugins: { tooltip: { enabled: false } }, rotation: -90, circumference: 360 }
            });
        }

        // --- 8. Item Share Doughnut (이달의 품목 점유율) ---
        const itemData = {'매생이': 0, '미역': 0, '다시마': 0};
        data.forEach(r => {
            if (r.date && r.date.startsWith(currentMonthPrefix) && itemData[r.item] !== undefined) {
                itemData[r.item] += (r.amount || 0);
            }
        });
        
        const ctxItemShare = document.getElementById('itemShareChartDashboard');
        if (ctxItemShare) {
            if (window.itemShareChartDashboardInstance) window.itemShareChartDashboardInstance.destroy();
            window.itemShareChartDashboardInstance = new Chart(ctxItemShare, {
                type: 'doughnut',
                data: {
                    labels: ['매생이', '미역', '다시마'],
                    datasets: [{
                        data: [itemData['매생이'], itemData['미역'], itemData['다시마']],
                        backgroundColor: ['#0ea5e9', '#10b981', '#8b5cf6'],
                        borderWidth: 0,
                        cutout: '65%'
                    }]
                },
                options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { color: '#f8fafc', padding: 15, font: { size: 11 } } } } }
            });
        }
    }

    // --- 9. Top Debtors List (집중 관리 대상) ---
    const debtorsMap = {};
    records.forEach(r => {
        const unpaid = (r.amount || 0) - (r.paymentAmount || 0);
        if (unpaid > 0) {
            debtorsMap[r.clientName] = (debtorsMap[r.clientName] || 0) + unpaid;
        }
    });
    const sortedDebtors = Object.entries(debtorsMap).sort((a, b) => b[1] - a[1]).slice(0, 3);
    const topDebtorsList = document.getElementById('topDebtorsList');
    if (topDebtorsList) {
        topDebtorsList.innerHTML = '';
        if (sortedDebtors.length === 0) {
            topDebtorsList.innerHTML = '<div class="debtor-item settled"><div class="debtor-info"><span class="debtor-name">모든 정산이 완료되었습니다!</span></div></div>';
        } else {
            sortedDebtors.forEach(([client, amount]) => {
                topDebtorsList.innerHTML += `
                    <div class="debtor-item">
                        <div class="debtor-info">
                            <span class="debtor-name">${client}</span>
                            <span class="debtor-date">미지급 발생 누적액</span>
                        </div>
                        <span class="debtor-amount text-red">${formatCurrency(amount)}원</span>
                    </div>
                `;
            });
        }
    }

    // --- 10. Activity Timeline (실시간 활동) ---
    const timeline = document.getElementById('activityTimeline');
    if (timeline) {
        timeline.innerHTML = '';
        // Sort all records by date desc to get recent activities
        const recentRecords = [...records].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 5);
        if (recentRecords.length === 0) {
            timeline.innerHTML = '<p style="color: var(--text-muted); font-size: 13px; padding-left: 24px;">최근 활동 내역이 없습니다.</p>';
        } else {
            recentRecords.forEach(r => {
                const unpaid = (r.amount || 0) - (r.paymentAmount || 0);
                const isSettled = unpaid <= 0 && r.amount > 0;
                
                let iconClass = 'type-debt';
                let iconSymbol = '<i class="fa-solid fa-file-invoice-dollar" style="color:#1e293b; font-size: 8px; position:absolute; top:2px; left:2px;"></i>';
                let titleHTML = `<strong>${r.clientName}</strong> 매입 추가`;
                let timeText = `${r.date} · ${r.item} ${r.quantity}${r.unit || 'kg'}`;
                
                if (isSettled) {
                    iconClass = 'type-payment';
                    iconSymbol = '<i class="fa-solid fa-check" style="color:#1e293b; font-size: 8px; position:absolute; top:2px; left:2px;"></i>';
                    titleHTML = `<strong>${r.clientName}</strong> 대금 정산 완료`;
                }

                timeline.innerHTML += `
                    <div class="timeline-item">
                        <div class="timeline-icon ${iconClass}" style="position:relative;">${iconSymbol}</div>
                        <div class="timeline-content">
                            <div class="timeline-title">${titleHTML}</div>
                            <div class="timeline-time">${timeText} (${formatCurrency(r.amount)}원)</div>
                        </div>
                    </div>
                `;
            });
        }
    }

    // --- 11. Today's Briefing ---
    renderTodayBriefing();
}

function renderTodayBriefing() {
    const todayStr = new Date().toISOString().split('T')[0];
    const today = new Date();
    const unpaidDaysLimit = settings.unpaidDays || 14;
    
    let urgentCount = 0, urgentAmount = 0;
    let weekCount = 0, weekAmount = 0;
    
    // Calculate week boundaries (Mon-Sun)
    const dayOfWeek = today.getDay();
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() + mondayOffset);
    weekStart.setHours(0, 0, 0, 0);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    weekEnd.setHours(23, 59, 59, 999);
    
    records.forEach(r => {
        const unpaid = (r.amount || 0) - (r.paymentAmount || 0);
        if (unpaid <= 0 || !r.date) return;
        
        const recordDate = new Date(r.date);
        const dueDate = new Date(recordDate);
        dueDate.setDate(dueDate.getDate() + unpaidDaysLimit);
        
        // Due today
        if (dueDate.toISOString().split('T')[0] === todayStr) {
            urgentCount++;
            urgentAmount += unpaid;
        }
        
        // Due this week
        if (dueDate >= weekStart && dueDate <= weekEnd) {
            weekCount++;
            weekAmount += unpaid;
        }
    });
    
    // Today's inventory
    let todayIn = 0, todayOut = 0;
    if (typeof inventoryLogs !== 'undefined') {
        inventoryLogs.forEach(log => {
            if (log.date === todayStr) {
                if (log.type === '입고') todayIn += log.quantity;
                else todayOut += log.quantity;
            }
        });
    }
    
    const elUrgent = document.getElementById('briefingUrgent');
    const elUrgentSub = document.getElementById('briefingUrgentSub');
    const elWeek = document.getElementById('briefingWeek');
    const elWeekSub = document.getElementById('briefingWeekSub');
    const elStock = document.getElementById('briefingStock');
    const elStockSub = document.getElementById('briefingStockSub');
    
    if (elUrgent) {
        elUrgent.textContent = urgentCount + '건';
        elUrgentSub.textContent = urgentCount > 0 ? `총 ${formatCurrency(urgentAmount)}원 정산 필요` : '만기 도래 건 없음';
    }
    if (elWeek) {
        elWeek.textContent = weekCount + '건';
        elWeekSub.textContent = weekCount > 0 ? `총 ${formatCurrency(weekAmount)}원 처리 대상` : '이번 주 만기 건 없음';
    }
    if (elStock) {
        if (todayIn > 0 || todayOut > 0) {
            elStock.textContent = `입 ${formatCurrency(todayIn)} / 출 ${formatCurrency(todayOut)}`;
            elStockSub.textContent = `순 변동: ${todayIn >= todayOut ? '+' : ''}${formatCurrency(todayIn - todayOut)} kg`;
        } else {
            elStock.textContent = '-';
            elStockSub.textContent = '오늘 입출고 없음';
        }
    }
    
    if (window.applyLanguageTranslations) window.applyLanguageTranslations();
}

// Filters
itemFilter.addEventListener('change', renderTable);
searchInput.addEventListener('input', renderTable);
filterStartDate.addEventListener('change', renderTable);
filterEndDate.addEventListener('change', renderTable);

// Navigation
const navDashboard = document.getElementById('nav-dashboard');
const navStatistics = document.getElementById('nav-statistics');
const navSettings = document.getElementById('nav-settings');
const navCrm = document.getElementById('nav-crm');
const navCalendar = document.getElementById('nav-calendar');
const navInventory = document.getElementById('nav-inventory');

const viewDashboard = document.getElementById('view-dashboard');
const viewStatistics = document.getElementById('view-statistics');
const viewSettings = document.getElementById('view-settings');
const viewCrm = document.getElementById('view-crm');
const viewCalendar = document.getElementById('view-calendar');
const viewInventory = document.getElementById('view-inventory');

const allViews = [viewDashboard, viewStatistics, viewSettings, viewCrm, viewCalendar, viewInventory];
const allNavs = [navDashboard, navStatistics, navSettings, navCrm, navCalendar, navInventory];

function switchView(viewId) {
    allViews.forEach(v => { if (v) v.style.display = 'none'; });
    allNavs.forEach(n => { if (n) n.classList.remove('active'); });
    document.querySelectorAll('.mob-nav-item').forEach(m => m.classList.remove('active'));
    const mobActive = document.getElementById(`mob-nav-${viewId}`);
    if (mobActive) mobActive.classList.add('active');

    if (viewId === 'dashboard') {
        viewDashboard.style.display = 'block';
        navDashboard.classList.add('active');
    } else if (viewId === 'statistics') {
        viewStatistics.style.display = 'block';
        navStatistics.classList.add('active');
        renderCharts();
    } else if (viewId === 'settings') {
        viewSettings.style.display = 'block';
        navSettings.classList.add('active');
    } else if (viewId === 'crm') {
        viewCrm.style.display = 'block';
        navCrm.classList.add('active');
        renderCRM();
    } else if (viewId === 'calendar') {
        viewCalendar.style.display = 'block';
        navCalendar.classList.add('active');
        renderCalendar();
    } else if (viewId === 'inventory') {
        viewInventory.style.display = 'block';
        navInventory.classList.add('active');
        renderInventory();
    }
}

navDashboard.addEventListener('click', (e) => { e.preventDefault(); switchView('dashboard'); });
navStatistics.addEventListener('click', (e) => { e.preventDefault(); switchView('statistics'); });
navSettings.addEventListener('click', (e) => { e.preventDefault(); switchView('settings'); });
navCrm.addEventListener('click', (e) => { e.preventDefault(); switchView('crm'); });
navCalendar.addEventListener('click', (e) => { e.preventDefault(); switchView('calendar'); });
navInventory.addEventListener('click', (e) => { e.preventDefault(); switchView('inventory'); });

// Settings: Clear Data
const clearDataBtn = document.getElementById('clearDataBtn');
if (clearDataBtn) {
    clearDataBtn.addEventListener('click', () => {
        if (confirm('정말로 모든 데이터를 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.')) {
            records = [];
            saveToStorage();
            renderTable();
            updateStats();
            showToast('🗑️ 모든 데이터가 안전하게 초기화되었습니다.');
            switchView('dashboard');
        }
    });
}

// Settings: Backup & Restore
const exportBtn = document.getElementById('exportBtn');
const importInput = document.getElementById('importInput');
const importStatus = document.getElementById('importStatus');

if (exportBtn) {
    exportBtn.addEventListener('click', () => {
        const dataStr = JSON.stringify(records, null, 2);
        const blob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        const dateStr = new Date().toISOString().split('T')[0];
        a.download = `wonma_backup_${dateStr}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    });
}

if (importInput) {
    importInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        
        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const importedData = JSON.parse(event.target.result);
                if (Array.isArray(importedData)) {
                    if (confirm('기존 데이터를 유지하면서 병합하시겠습니까? (취소를 누르면 기존 데이터가 백업 파일로 완전히 교체됩니다.)')) {
                        // Merge (basic deduplication by ID)
                        const existingIds = new Set(records.map(r => r.id));
                        const newRecords = importedData.filter(r => !existingIds.has(r.id));
                        records = [...records, ...newRecords];
                    } else {
                        // Replace
                        records = importedData;
                    }
                    
                    records.sort((a, b) => new Date(b.date) - new Date(a.date));
                    saveToStorage();
                    renderTable();
                    updateStats();
                    
                    importStatus.style.display = 'block';
                    setTimeout(() => importStatus.style.display = 'none', 3000);
                } else {
                    alert('잘못된 형식의 백업 파일입니다.');
                }
            } catch (err) {
                alert('파일을 읽는 중 오류가 발생했습니다.');
                console.error(err);
            }
            importInput.value = ''; // Reset input
        };
        reader.readAsText(file);
    });
}

// Settings: Change Password & PIN
const passwordForm = document.getElementById('passwordForm');
const passwordMsg = document.getElementById('passwordMsg');
const tabSetPin = document.getElementById('tabSetPin');
const tabSetPwd = document.getElementById('tabSetPwd');
const pinSetForm = document.getElementById('pinSetForm');
const pinSetMsg = document.getElementById('pinSetMsg');

window.openPasswordModal = function(mode) {
    const modal = document.getElementById('passwordModal');
    if (pinSetMsg) pinSetMsg.style.display = 'none';
    if (passwordMsg) passwordMsg.style.display = 'none';
    if (pinSetForm) pinSetForm.reset();
    if (passwordForm) passwordForm.reset();
    
    if (mode === 'pwd') {
        if (tabSetPwd) tabSetPwd.click();
    } else {
        if (tabSetPin) tabSetPin.click();
    }
    
    if (modal) modal.classList.add('active');
};

window.closePasswordModal = function() {
    const modal = document.getElementById('passwordModal');
    if (modal) modal.classList.remove('active');
};

if(tabSetPin && tabSetPwd) {
    tabSetPin.addEventListener('click', () => {
        tabSetPin.classList.add('active');
        tabSetPwd.classList.remove('active');
        if (pinSetForm) pinSetForm.style.display = 'flex';
        if (passwordForm) passwordForm.style.display = 'none';
    });
    tabSetPwd.addEventListener('click', () => {
        tabSetPwd.classList.add('active');
        tabSetPin.classList.remove('active');
        if (passwordForm) passwordForm.style.display = 'flex';
        if (pinSetForm) pinSetForm.style.display = 'none';
    });
}

if(pinSetForm) {
    pinSetForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const currentPin = document.getElementById('currentPin').value;
        const newPin = document.getElementById('newPin').value;
        const confirmPin = document.getElementById('confirmPin').value;
        
        if (currentPin !== ADMIN_PIN) {
            pinSetMsg.textContent = '현재 간편 PIN 번호가 일치하지 않습니다.';
            pinSetMsg.style.color = '#ef4444';
            pinSetMsg.style.display = 'block';
            return;
        }
        
        if (!/^\d{4}$/.test(newPin)) {
            pinSetMsg.textContent = '새 간편 PIN은 4자리 숫자여야 합니다.';
            pinSetMsg.style.color = '#ef4444';
            pinSetMsg.style.display = 'block';
            return;
        }
        
        if (newPin !== confirmPin) {
            pinSetMsg.textContent = '새 간편 PIN과 확인 번호가 일치하지 않습니다.';
            pinSetMsg.style.color = '#ef4444';
            pinSetMsg.style.display = 'block';
            return;
        }
        
        ADMIN_PIN = newPin;
        localStorage.setItem('wonma_admin_pin', newPin);
        pushCredentialsToCloud(ADMIN_PIN, ADMIN_PASSWORD);
        
        pinSetMsg.textContent = '간편 PIN 번호가 성공적으로 저장되었습니다!';
        pinSetMsg.style.color = 'var(--color-miyeok)';
        pinSetMsg.style.display = 'block';
        pinSetForm.reset();
        
        setTimeout(() => {
            pinSetMsg.style.display = 'none';
            if (typeof closePasswordModal === 'function') closePasswordModal();
        }, 1500);
    });
}

if (passwordForm) {
    passwordForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const currentPwd = document.getElementById('currentPassword').value;
        const newPwd = document.getElementById('newPassword').value;
        const confirmPwd = document.getElementById('confirmPassword').value;
        
        if (currentPwd !== ADMIN_PASSWORD) {
            passwordMsg.textContent = '현재 비밀번호가 일치하지 않습니다.';
            passwordMsg.style.color = '#ef4444';
            passwordMsg.style.display = 'block';
            return;
        }
        
        if (newPwd !== confirmPwd) {
            passwordMsg.textContent = '새 비밀번호와 비밀번호 확인이 일치하지 않습니다.';
            passwordMsg.style.color = '#ef4444';
            passwordMsg.style.display = 'block';
            return;
        }
        
        if (newPwd.length < 4) {
            passwordMsg.textContent = '새 비밀번호는 4자리 이상이어야 합니다.';
            passwordMsg.style.color = '#ef4444';
            passwordMsg.style.display = 'block';
            return;
        }
        
        ADMIN_PASSWORD = newPwd;
        localStorage.setItem('wonma_admin_pwd', newPwd);
        pushCredentialsToCloud(ADMIN_PIN, ADMIN_PASSWORD);
        
        passwordMsg.textContent = '비밀번호가 성공적으로 변경되었습니다.';
        passwordMsg.style.color = 'var(--color-miyeok)'; // Emerald green
        passwordMsg.style.display = 'block';
        passwordForm.reset();
        
        setTimeout(() => {
            passwordMsg.style.display = 'none';
            if (typeof closePasswordModal === 'function') closePasswordModal();
        }, 1500);
    });
}

// CSV Export
const exportCsvBtn = document.getElementById('exportCsvBtn');
if (exportCsvBtn) {
    exportCsvBtn.addEventListener('click', () => {
        let csv = '\uFEFF거래처명,월일,품목,단위,수량,단가,금액,지급일,지급금액,미지급금,계산서발행,비고\n';
        
        const filterItem = itemFilter.value;
        const filterText = searchInput.value.toLowerCase();
        const startDate = filterStartDate.value;
        const endDate = filterEndDate.value;
        
        const filteredRecords = records.filter(r => {
            const matchItem = filterItem === 'all' || r.item === filterItem;
            const matchSearch = r.clientName.toLowerCase().includes(filterText);
            let matchDate = true;
            if (startDate && r.date < startDate) matchDate = false;
            if (endDate && r.date > endDate) matchDate = false;
            return matchItem && matchSearch && matchDate;
        });

        filteredRecords.forEach(r => {
            const unpaid = r.amount - (r.paymentAmount || 0);
            const row = [
                `"${r.clientName}"`, r.date, r.item, `"${r.unit || ''}"`,
                r.quantity, r.unitPrice, r.amount, r.paymentDate || '',
                r.paymentAmount || 0, unpaid, r.invoiceStatus, `"${r.remarks || ''}"`
            ];
            csv += row.join(',') + '\n';
        });

        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const dateStr = new Date().toISOString().split('T')[0];
        a.download = `wonma_export_${dateStr}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    });
}

// Charts Logic
let itemChartInstance = null;
let trendChartInstance = null;
let topClientsChartInstance = null;
let paymentStatusChartInstance = null;
let dailyTrendChartInstance = null;

function renderCharts() {
    if (!window.Chart) return;
    
    // Data prep for Item Ratio
    const itemData = {'매생이': 0, '미역': 0, '다시마': 0};
    records.forEach(r => itemData[r.item] += (r.amount || 0));
    
    const ctxItem = document.getElementById('itemRatioChart');
    if (ctxItem) {
        if (itemChartInstance) itemChartInstance.destroy();
        itemChartInstance = new Chart(ctxItem, {
            type: 'doughnut',
            data: {
                labels: ['매생이', '미역', '다시마'],
                datasets: [{
                    data: [itemData['매생이'], itemData['미역'], itemData['다시마']],
                    backgroundColor: ['#0ea5e9', '#10b981', '#8b5cf6'],
                    borderWidth: 0
                }]
            },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { color: '#f8fafc' } } } }
        });
    }

    // Data prep for Trend (last 6 months)
    const monthData = {};
    const today = new Date();
    for (let i = 5; i >= 0; i--) {
        const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
        const monthStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        monthData[monthStr] = {'매생이': 0, '미역': 0, '다시마': 0};
    }
    
    records.forEach(r => {
        const m = r.date.substring(0, 7);
        if (monthData[m]) {
            monthData[m][r.item] += (r.amount || 0);
        }
    });

    const labels = Object.keys(monthData);
    const datasets = [
        { label: '매생이', data: labels.map(l => monthData[l]['매생이']), backgroundColor: '#0ea5e9' },
        { label: '미역', data: labels.map(l => monthData[l]['미역']), backgroundColor: '#10b981' },
        { label: '다시마', data: labels.map(l => monthData[l]['다시마']), backgroundColor: '#8b5cf6' }
    ];

    const ctxTrend = document.getElementById('monthlyTrendChart');
    if (ctxTrend) {
        if (trendChartInstance) trendChartInstance.destroy();
        trendChartInstance = new Chart(ctxTrend, {
            type: 'bar',
            data: { labels, datasets },
            options: {
                responsive: true, maintainAspectRatio: false,
                scales: {
                    x: { stacked: true, ticks: { color: '#94a3b8' }, grid: { color: 'rgba(255,255,255,0.05)' } },
                    y: { stacked: true, ticks: { color: '#94a3b8' }, grid: { color: 'rgba(255,255,255,0.05)' } }
                },
                plugins: { legend: { position: 'bottom', labels: { color: '#f8fafc' } } }
            }
        });
    }

    // 1. Top 5 Clients
    const clientData = {};
    records.forEach(r => {
        clientData[r.clientName] = (clientData[r.clientName] || 0) + (r.amount || 0);
    });
    const topClients = Object.entries(clientData)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);
    
    const ctxTopClients = document.getElementById('topClientsChart');
    if (ctxTopClients) {
        if (topClientsChartInstance) topClientsChartInstance.destroy();
        topClientsChartInstance = new Chart(ctxTopClients, {
            type: 'bar',
            data: {
                labels: topClients.map(c => c[0]),
                datasets: [{
                    label: '매입 금액',
                    data: topClients.map(c => c[1]),
                    backgroundColor: '#3b82f6',
                    borderRadius: 4
                }]
            },
            options: {
                indexAxis: 'y', // horizontal bar
                responsive: true, maintainAspectRatio: false,
                scales: {
                    x: { ticks: { color: '#94a3b8' }, grid: { color: 'rgba(255,255,255,0.05)' } },
                    y: { ticks: { color: '#f8fafc' }, grid: { display: false } }
                },
                plugins: { legend: { display: false } }
            }
        });
    }

    // 2. Payment Status
    let totalPaid = 0;
    let totalUnpaid = 0;
    records.forEach(r => {
        const paid = r.paymentAmount || 0;
        totalPaid += paid;
        totalUnpaid += (r.amount - paid);
    });
    
    const ctxPayment = document.getElementById('paymentStatusChart');
    if (ctxPayment) {
        if (paymentStatusChartInstance) paymentStatusChartInstance.destroy();
        paymentStatusChartInstance = new Chart(ctxPayment, {
            type: 'pie',
            data: {
                labels: ['지급 완료', '미지급 잔액'],
                datasets: [{
                    data: [totalPaid, totalUnpaid],
                    backgroundColor: ['#10b981', '#f43f5e'],
                    borderWidth: 0
                }]
            },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { color: '#f8fafc' } } } }
        });
    }

    // 3. Daily Trend (Last 7 Days)
    const dailyData = {};
    for (let i = 6; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        const dateStr = d.toISOString().split('T')[0];
        dailyData[dateStr] = 0;
    }
    
    records.forEach(r => {
        if (dailyData[r.date] !== undefined) {
            dailyData[r.date] += (r.amount || 0);
        }
    });

    const ctxDaily = document.getElementById('dailyTrendChart');
    if (ctxDaily) {
        if (dailyTrendChartInstance) dailyTrendChartInstance.destroy();
        dailyTrendChartInstance = new Chart(ctxDaily, {
            type: 'line',
            data: {
                labels: Object.keys(dailyData).map(d => d.substring(5)), // MM-DD
                datasets: [{
                    label: '일별 거래액',
                    data: Object.values(dailyData),
                    borderColor: '#8b5cf6',
                    backgroundColor: 'rgba(139, 92, 246, 0.1)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.4
                }]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                scales: {
                    x: { ticks: { color: '#94a3b8' }, grid: { color: 'rgba(255,255,255,0.05)' } },
                    y: { ticks: { color: '#94a3b8' }, grid: { color: 'rgba(255,255,255,0.05)' } }
                },
                plugins: { legend: { display: false } }
            }
        });
    }

    // --- Phase 2: Price Trend Chart & Monthly Report ---
    renderPriceTrendChart();
    renderMonthlyReport();
}

// Print Receipt Logic
function printReceipt(id) {
    const record = records.find(r => r.id === id);
    if(!record) return;
    
    const printArea = document.getElementById('printArea');
    const unpaid = record.amount - (record.paymentAmount || 0);
    
    printArea.innerHTML = `
        <div class="receipt-container">
            <div class="receipt-header">
                <img src="./logo.png" alt="원마수산 로고" class="receipt-logo">
                <h2>지급 명세서</h2>
            </div>
            <div class="receipt-meta">
                <p><strong>발급일자:</strong> ${new Date().toISOString().split('T')[0]}</p>
                <p><strong>거래처명:</strong> ${record.clientName}</p>
            </div>
            <table class="receipt-table">
                <thead>
                    <tr>
                        <th>품목</th>
                        <th>단위</th>
                        <th>수량</th>
                        <th>단가</th>
                        <th>합계</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td>${record.item}</td>
                        <td>${record.unit || '-'}</td>
                        <td class="text-right">${formatCurrency(record.quantity)}</td>
                        <td class="text-right">${formatCurrency(record.unitPrice)}원</td>
                        <td class="text-right">${formatCurrency(record.amount)}원</td>
                    </tr>
                </tbody>
            </table>
            <div class="receipt-summary">
                <div class="summary-row"><span>총 금액:</span> <span>${formatCurrency(record.amount)}원</span></div>
                <div class="summary-row"><span>지급액 (${record.paymentDate || '-'}):</span> <span>${formatCurrency(record.paymentAmount || 0)}원</span></div>
                <div class="summary-row highlight-row"><span>미지급 잔액:</span> <span>${formatCurrency(unpaid)}원</span></div>
            </div>
            <div class="receipt-footer">
                <p>위 금액을 정히 영수(청구)함.</p>
                <div style="margin-top: 16px; font-size: 13px; color: #475569; text-align: left; padding-left: 12px; border-left: 3px solid #cbd5e1;">
                    <p style="margin-bottom: 2px;"><strong>상호명:</strong> ${settings.receipt.companyName || '원마수산'}</p>
                    <p style="margin-bottom: 2px;"><strong>사업자등록번호:</strong> ${settings.receipt.bizNumber || '-'}</p>
                    <p style="margin-bottom: 2px;"><strong>사업장 주소:</strong> ${settings.receipt.address || '-'}</p>
                    <p><strong>연락처:</strong> ${settings.receipt.phone || '-'}</p>
                </div>
                <div class="signature-box">
                    <span>${settings.receipt.companyName || '원마수산'}</span>
                    ${settings.receipt.stampImg ? `<img src="${settings.receipt.stampImg}" alt="직인" class="stamp" style="border:none; width:48px; height:48px; object-fit:contain; background:transparent;">` : `<div class="stamp">(인)</div>`}
                </div>
            </div>
        </div>
    `;
    
    window.print();
}

// --- Profile Management ---
const PROFILE_KEY = "wonma_profile";
const openProfileBtn = document.getElementById("openProfileBtn");
const profileModal = document.getElementById("profileModal");
const closeProfileBtn = document.getElementById("closeProfileBtn");
const cancelProfileBtn = document.getElementById("cancelProfileBtn");
const profileForm = document.getElementById("profileForm");
const profileImageInput = document.getElementById("profileImageInput");
const profileImagePreview = document.getElementById("profileImagePreview");
const profileImagePreviewWrapper = document.getElementById("profileImagePreviewWrapper");

const sidebarUserName = document.getElementById("sidebarUserName");
const sidebarUserEmail = document.getElementById("sidebarUserEmail");
const sidebarAvatar = document.getElementById("sidebarAvatar");

const profileNameInput = document.getElementById("profileNameInput");
const profileEmailInput = document.getElementById("profileEmailInput");

let currentProfilePicBase64 = null;

function loadProfile() {
    let profile = safeJSONParse(PROFILE_KEY, {
        name: "최고 관리자",
        email: "admin@wonma.com",
        pic: null
    });
    if (profile && profile.name && (profile.name.includes('') || profile.name.includes('\uFFFD') || profile.name.includes('ì') || profile.name.includes('ë'))) {
        profile.name = "최고 관리자";
        localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
    }
    currentLoginName = profile.name || "최고 관리자";
    
    if(sidebarUserName) sidebarUserName.textContent = profile.name;
    if(sidebarUserEmail) sidebarUserEmail.textContent = profile.email;
    if(profileNameInput) profileNameInput.value = profile.name;
    if(profileEmailInput) profileEmailInput.value = profile.email;
    
    const headerUserName = document.getElementById("headerUserName");
    const headerAvatar = document.getElementById("headerAvatar");
    if (headerUserName) headerUserName.textContent = profile.name;
    
    const mobileProfileBtn = document.getElementById("mobileProfileBtn");
    
    if (profile.pic) {
        currentProfilePicBase64 = profile.pic;
        if(sidebarAvatar) sidebarAvatar.innerHTML = `<img src="${profile.pic}" style="width: 100%; height: 100%; object-fit: cover;">`;
        if(mobileProfileBtn) mobileProfileBtn.innerHTML = `<img src="${profile.pic}" style="width: 100%; height: 100%; object-fit: cover;">`;
        if(headerAvatar) headerAvatar.innerHTML = `<img src="${profile.pic}" style="width: 100%; height: 100%; object-fit: cover;">`;
        if(profileImagePreview) {
            profileImagePreview.src = profile.pic;
            profileImagePreview.style.display = "block";
        }
    } else {
        if(sidebarAvatar) sidebarAvatar.innerHTML = `<i class="fa-solid fa-user-tie"></i>`;
        if(mobileProfileBtn) mobileProfileBtn.innerHTML = `<i class="fa-solid fa-user-tie" style="font-size: 14px;"></i>`;
        if(headerAvatar) headerAvatar.innerHTML = `<i class="fa-solid fa-user-tie" style="font-size: 15px;"></i>`;
        if(profileImagePreview) profileImagePreview.style.display = "none";
    }
    
    initLoginGreeting();
}

function openProfileModal() {
    loadProfile();
    profileModal.classList.add("active");
}

function closeProfileModal() {
    profileModal.classList.remove("active");
}

window.handleLogout = function() {
    if (!confirm("안전하게 로그아웃하고 시스템을 잠금(Lock) 하시겠습니까?")) return;
    sessionStorage.removeItem('wonma_auth');
    if(window.clearPinInput) window.clearPinInput();
    const pwdInput = document.getElementById('adminPassword');
    if(pwdInput) pwdInput.value = '';
    
    document.querySelector('.app-container').classList.remove('ready');
    document.getElementById('loginOverlay').classList.add('active');
    if(typeof closeProfileModal === 'function') closeProfileModal();
    initLoginGreeting();
    if(typeof playHapticBeep === 'function') playHapticBeep(440, 'sine', 0.08, 0.15);
    if(typeof showToast === 'function') showToast("🔒 안전하게 로그아웃되어 시스템이 잠겼습니다.");
};

if (logoutBtn) {
    logoutBtn.addEventListener('click', (e) => {
        e.preventDefault();
        window.handleLogout();
    });
}

if (openProfileBtn) openProfileBtn.addEventListener("click", openProfileModal);
if (closeProfileBtn) closeProfileBtn.addEventListener("click", closeProfileModal);
if (cancelProfileBtn) cancelProfileBtn.addEventListener("click", closeProfileModal);
if (profileModal) {
    profileModal.addEventListener("click", (e) => {
        if (e.target === profileModal) closeProfileModal();
    });
}
if (profileImagePreviewWrapper) {
    profileImagePreviewWrapper.addEventListener("click", () => {
        profileImageInput.click();
    });
}

if (profileImageInput) {
    profileImageInput.addEventListener("change", (e) => {
        const file = e.target.files[0];
        if (!file) return;
        
        if (file.size > 2 * 1024 * 1024) {
            alert("이미지 크기는 2MB 이하여야 합니다.");
            profileImageInput.value = "";
            return;
        }
        
        const reader = new FileReader();
        reader.onload = (event) => {
            currentProfilePicBase64 = event.target.result;
            profileImagePreview.src = currentProfilePicBase64;
            profileImagePreview.style.display = "block";
        };
        reader.readAsDataURL(file);
    });
}

if (profileForm) {
    profileForm.addEventListener("submit", (e) => {
        e.preventDefault();
        const profile = {
            name: profileNameInput.value || "최고 관리자",
            email: profileEmailInput.value || "admin@wonma.com",
            pic: currentProfilePicBase64
        };
        localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
        loadProfile();
        closeProfileModal();
    });
}

document.addEventListener("DOMContentLoaded", () => {
    loadProfile();
});

// --- Dashboard Excel/CSV Auto Upload (Drag & Drop + Button) ---
const autoUploadBtn = document.getElementById('autoUploadBtn');
const dashboardExcelInput = document.getElementById('dashboardExcelInput');
const tableSection = document.getElementById('tableSection');
const dragDropOverlay = document.getElementById('dragDropOverlay');

function handleFileUpload(file) {
    if (!file) return;
    const name = file.name ? file.name.toLowerCase() : '';
    if (name.endsWith('.csv') || name.endsWith('.txt')) {
        readAsTextFallback(file);
        return;
    }
    if (window.XLSX) {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array', cellDates: true });
                const firstSheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[firstSheetName];
                const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: false });
                parseArrayRowsAndAdd(rows);
            } catch (err) {
                console.warn("XLSX parse error, falling back to text CSV:", err);
                readAsTextFallback(file);
            }
        };
        reader.readAsArrayBuffer(file);
    } else {
        readAsTextFallback(file);
    }
}

function readAsTextFallback(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
        let text = e.target.result;
        // Detect CP949/EUC-KR character corruption
        if (text.includes('') || text.includes('\uFFFD') || /[\xC0-\xFD][\x80-\xBF]/.test(text) || text.includes('ì') || text.includes('ë')) {
            const eucReader = new FileReader();
            eucReader.onload = (ev) => parseCSVAndAdd(ev.target.result);
            eucReader.readAsText(file, 'euc-kr');
        } else {
            parseCSVAndAdd(text);
        }
    };
    reader.readAsText(file, 'UTF-8');
}

function parseCSVAndAdd(csvText) {
    if (!csvText) return;
    const lines = csvText.split(/\r?\n/).filter(line => line.trim() !== '');
    if (lines.length === 0) {
        if (window.showToast) showToast('⚠️ 데이터가 없거나 잘못된 파일입니다.');
        return;
    }
    const rows = lines.map(line => {
        const result = [];
        let cur = '';
        let inQuote = false;
        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            if (char === '"') { inQuote = !inQuote; }
            else if (char === ',' && !inQuote) { result.push(cur.trim().replace(/^"|"$/g, '')); cur = ''; }
            else { cur += char; }
        }
        result.push(cur.trim().replace(/^"|"$/g, ''));
        return result;
    });
    parseArrayRowsAndAdd(rows);
}

// Universal Excel date normalizer
function normalizeExcelDate(val) {
    if (!val) return new Date().toISOString().split('T')[0];
    // Numeric Excel serial number (e.g. 45847)
    if (typeof val === 'number' && val > 30000 && val < 60000) {
        const d = new Date((val - (25567 + 2)) * 86400 * 1000);
        if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
    }
    let s = String(val).trim();
    // 2026.07.06 or 2026/07/06 or 2026-07-06
    s = s.replace(/[./년월일]/g, '-').replace(/--+/g, '-').replace(/^-|-$/g, '');
    const parts = s.split('-');
    if (parts.length === 3) {
        let yr = parts[0];
        let mo = parts[1];
        let da = parts[2];
        if (yr.length === 2) yr = '20' + yr;
        if (mo.length === 1) mo = '0' + mo;
        if (da.length === 1) da = '0' + da;
        if (/^\d{4}$/.test(yr) && /^\d{2}$/.test(mo) && /^\d{2}$/.test(da)) {
            return `${yr}-${mo}-${da}`;
        }
    }
    return new Date().toISOString().split('T')[0];
}

// Universal Excel number normalizer
function normalizeExcelNumber(val, defaultVal = 0) {
    if (typeof val === 'number' && !isNaN(val)) return val;
    if (!val) return defaultVal;
    const str = String(val).replace(/[^\d.-]/g, '');
    const parsed = parseFloat(str);
    return isNaN(parsed) ? defaultVal : parsed;
}

function parseArrayRowsAndAdd(rows) {
    if (!rows || rows.length === 0) {
        if (window.showToast) showToast('⚠️ 엑셀 파일에 유효한 데이터가 없거나 양식이 올바르지 않습니다.');
        return;
    }
    let addedCount = 0;
    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (!row || !Array.isArray(row) || row.every(cell => !String(cell || '').trim())) continue;
        
        let clientName = String(row[0] || '').trim();
        // Check if row is header or title
        if (clientName.includes('거래처') || clientName.includes('상호') || clientName.includes('원마수산') || clientName.includes('표준양식')) {
            continue;
        }
        clientName = clientName.replace(/[\uFFFD\u0080-\u00FF]/g, '').trim() || '일반거래처';

        const dateStr = normalizeExcelDate(row[1]);

        const itemRaw = String(row[2] || '').trim();
        let item = '매생이';
        if (itemRaw.includes('미역')) item = '미역';
        else if (itemRaw.includes('다시마')) item = '다시마';
        else if (itemRaw.includes('매생')) item = '매생이';
        
        let quantity = normalizeExcelNumber(row[3], 1);
        if (quantity <= 0) quantity = 1;
        const unitPrice = normalizeExcelNumber(row[4], 0);
        const paymentAmount = normalizeExcelNumber(row[5], 0);
        
        const newRecord = {
            id: Date.now().toString() + Math.random().toString(36).substr(2, 5) + i,
            clientName: clientName,
            date: dateStr,
            item: item,
            unit: 'kg',
            quantity: quantity,
            unitPrice: unitPrice,
            amount: quantity * unitPrice,
            paymentDate: paymentAmount > 0 ? dateStr : '',
            paymentAmount: paymentAmount,
            invoiceStatus: '미발행',
            remarks: String(row[6] || '엑셀 자동 등록').trim()
        };
        records.push(newRecord);
        addedCount++;
    }
    
    if (addedCount > 0) {
        records.sort((a, b) => new Date(b.date) - new Date(a.date));
        saveToStorage();
        renderTable();
        updateStats();
        if (window.showToast) showToast(`✅ ${addedCount}건의 원물 지급 내역이 한글 깨짐 없이 완벽 등록되었습니다!`);
    } else {
        if (window.showToast) showToast('⚠️ 추가할 수 있는 유효한 데이터가 없습니다. 엑셀 양식을 확인해주세요.');
    }
}

if (autoUploadBtn && dashboardExcelInput) {
    autoUploadBtn.addEventListener('click', () => {
        dashboardExcelInput.click();
    });
    
    dashboardExcelInput.addEventListener('change', (e) => {
        handleFileUpload(e.target.files[0]);
        dashboardExcelInput.value = ''; // Reset
    });
}

const downloadTemplateBtn = document.getElementById('downloadTemplateBtn');
if (downloadTemplateBtn) {
    downloadTemplateBtn.addEventListener('click', () => {
        const templateCsv = '\uFEFF거래처명,거래일자,품목,수량,단가,지급액,비고\n' +
            '"청정해역",2026-07-06,"매생이",500,12000,6000000,"7월 정기 납품 결제완료"\n' +
            '"완도수협",2026-07-05,"미역",300,8500,1500000,"1차 출고분 (미지급 1,050,000원)"\n' +
            '"남도해조",2026-07-04,"다시마",1000,6000,0,"월말 일괄 결제 예정"\n' +
            '"바다원물(주)",2026-07-03,"매생이",250,13000,3250000,"신규 거래처 샘플 납품 완결"\n' +
            '"동해수산",2026-07-02,"미역",450,9000,4050000,"즉시 결제 완료"\n';
        const blob = new Blob([templateCsv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = '원마수산_자동업로드_표준양식(샘플).csv';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        if (window.showToast) showToast('📥 엑셀/CSV 표준 자동업로드 양식 파일이 다운로드되었습니다!');
    });
}

// Drag & Drop Handlers
if (tableSection && dragDropOverlay) {
    tableSection.addEventListener('dragover', (e) => {
        e.preventDefault();
        dragDropOverlay.style.display = 'flex';
    });
    
    tableSection.addEventListener('dragleave', (e) => {
        e.preventDefault();
        // Ignore internal elements
        if (e.relatedTarget && tableSection.contains(e.relatedTarget)) return;
        dragDropOverlay.style.display = 'none';
    });
    
    tableSection.addEventListener('drop', (e) => {
        e.preventDefault();
        dragDropOverlay.style.display = 'none';
        
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            handleFileUpload(e.dataTransfer.files[0]);
        }
    });
}

// ============================================================
// CRM SYSTEM (거래처 관리)
// ============================================================
const CRM_KEY = 'wonma_crm_clients';
let crmClients = sanitizeRecordsList(safeJSONParse(CRM_KEY, []), CRM_KEY);

function saveCRM() { localStorage.setItem(CRM_KEY, JSON.stringify(crmClients)); }

function renderCRM() {
    const grid = document.getElementById('crmClientGrid');
    const empty = document.getElementById('crmEmptyState');
    const searchText = (document.getElementById('crmSearchInput')?.value || '').toLowerCase();
    const gradeFilter = document.getElementById('crmGradeFilter')?.value || 'all';

    // Auto-detect clients from records if CRM is empty
    if (crmClients.length === 0 && records.length > 0) {
        const clientNames = [...new Set(records.map(r => r.clientName))];
        clientNames.forEach(name => {
            crmClients.push({ id: Date.now().toString() + Math.random().toString(36).substr(2, 5), name, phone: '', address: '', contact: '', grade: 'B' });
        });
        saveCRM();
    }

    let filtered = crmClients.filter(c => {
        const matchSearch = c.name.toLowerCase().includes(searchText) || (c.phone || '').includes(searchText) || (c.address || '').toLowerCase().includes(searchText);
        const matchGrade = gradeFilter === 'all' || c.grade === gradeFilter;
        return matchSearch && matchGrade;
    });

    if (!grid) return;
    grid.innerHTML = '';

    if (filtered.length === 0) {
        if (empty) empty.style.display = 'block';
        return;
    }
    if (empty) empty.style.display = 'none';

    filtered.forEach(client => {
        const clientRecords = records.filter(r => r.clientName === client.name);
        const totalAmount = clientRecords.reduce((s, r) => s + (r.amount || 0), 0);
        const totalUnpaid = clientRecords.reduce((s, r) => s + Math.max(0, (r.amount || 0) - (r.paymentAmount || 0)), 0);
        const txCount = clientRecords.length;

        const limit = client.creditLimit || 10000000;
        const isDanger = totalUnpaid > limit;
        const limitBadge = isDanger 
            ? `<span class="limit-badge" title="한도 ${formatCurrency(limit)}원 초과"><i class="fa-solid fa-triangle-exclamation"></i> 한도초과 (+${formatCurrency(totalUnpaid - limit)})</span>` 
            : `<span class="limit-safe-badge" title="신용한도 ${formatCurrency(limit)}원"><i class="fa-solid fa-check"></i> 한도정상</span>`;

        const gradeClass = client.grade === 'A' ? 'crm-grade-a' : client.grade === 'B' ? 'crm-grade-b' : 'crm-grade-c';
        const gradeLabel = client.grade === 'A' ? '⭐ A등급' : client.grade === 'B' ? '🔵 B등급' : '⚪ C등급';

        const card = document.createElement('div');
        card.className = `crm-card ${isDanger ? 'danger-limit' : ''}`;
        card.innerHTML = `
            <div class="crm-card-header">
                <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                    <span class="crm-card-name">${client.name}</span>
                    ${limitBadge}
                </div>
                <span class="crm-grade ${gradeClass}">${gradeLabel}</span>
            </div>
            <div class="crm-card-info">
                <span><i class="fa-solid fa-phone"></i>${client.phone || '미등록'}</span>
                <span><i class="fa-solid fa-location-dot"></i>${client.address || '미등록'}</span>
                <span><i class="fa-solid fa-user"></i>담당: ${client.contact || '미등록'}</span>
            </div>
            <div class="crm-card-stats">
                <div class="crm-card-stat"><span class="crm-card-stat-label">총 거래액</span><span class="crm-card-stat-value">${formatCurrency(totalAmount)}원</span></div>
                <div class="crm-card-stat"><span class="crm-card-stat-label">미지급</span><span class="crm-card-stat-value" style="color: ${totalUnpaid > 0 ? '#f87171' : '#34d399'}">${formatCurrency(totalUnpaid)}원</span></div>
                <div class="crm-card-stat"><span class="crm-card-stat-label">거래 수</span><span class="crm-card-stat-value">${txCount}건</span></div>
            </div>
            ${client.memo ? `<div class="crm-card-memo"><i class="fa-solid fa-sticky-note" style="margin-right: 6px;"></i>${client.memo}</div>` : ''}
            <div class="crm-card-actions">
                <button class="btn-icon" onclick="event.stopPropagation(); copyKakaoBilling('${client.name}')" title="카톡/문자 정산 안내톡 복사"><i class="fa-solid fa-comment-sms" style="color: #fbbf24;"></i></button>
                <button class="btn-icon" onclick="event.stopPropagation(); setCreditLimit('${client.id}')" title="신용한도 변경"><i class="fa-solid fa-shield-halved" style="color: #38bdf8;"></i></button>
                <button class="btn-icon" onclick="event.stopPropagation(); editCRMClient('${client.id}')" title="수정"><i class="fa-regular fa-pen-to-square"></i></button>
                <button class="btn-icon btn-danger" onclick="event.stopPropagation(); deleteCRMClient('${client.id}')" title="삭제"><i class="fa-solid fa-trash"></i></button>
            </div>
        `;
        card.addEventListener('click', () => showClientDetail(client.id));
        grid.appendChild(card);
    });
}

function showClientDetail(clientId) {
    const client = crmClients.find(c => c.id === clientId);
    if (!client) return;
    const panel = document.getElementById('crmDetailPanel');
    const title = document.getElementById('crmDetailTitle');
    const content = document.getElementById('crmDetailContent');
    if (!panel || !content) return;

    title.textContent = `${client.name} - 거래 이력`;
    const clientRecords = records.filter(r => r.clientName === client.name).sort((a, b) => new Date(b.date) - new Date(a.date));

    let rows = '';
    clientRecords.forEach(r => {
        const unpaid = (r.amount || 0) - (r.paymentAmount || 0);
        rows += `<tr>
            <td>${r.date}</td>
            <td><span class="badge badge-${r.item === '매생이' ? 'maesaengi' : r.item === '미역' ? 'miyeok' : 'dasima'}">${r.item}</span></td>
            <td class="text-right">${formatCurrency(r.amount)}원</td>
            <td class="text-right">${formatCurrency(r.paymentAmount || 0)}원</td>
            <td class="text-right ${unpaid > 0 ? 'unpaid-text' : ''}">${formatCurrency(unpaid)}원</td>
        </tr>`;
    });

    content.innerHTML = `
        <div style="display: flex; justify-content: flex-end; gap: 8px; margin-bottom: 16px;">
            <button class="btn btn-secondary btn-sm" onclick="copyKakaoBilling('${client.name}')"><i class="fa-solid fa-comment-sms" style="color: #fbbf24;"></i> 정산 안내톡 복사</button>
            <button class="btn btn-secondary btn-sm" onclick="setCreditLimit('${client.id}')"><i class="fa-solid fa-shield-halved" style="color: #38bdf8;"></i> 신용한도 변경</button>
        </div>
        ${client.memo ? `<div class="crm-card-memo" style="margin-bottom: 16px; font-size: 14px;"><i class="fa-solid fa-sticky-note" style="margin-right: 8px; color: var(--primary);"></i>${client.memo}</div>` : ''}
        <div class="table-responsive" style="max-height: 300px;">
            <table class="data-table"><thead><tr><th>날짜</th><th>품목</th><th class="text-right">금액</th><th class="text-right">지급</th><th class="text-right">미지급</th></tr></thead>
            <tbody>${rows || '<tr><td colspan="5" style="text-align:center; color: var(--text-muted);">거래 내역이 없습니다.</td></tr>'}</tbody></table>
        </div>`;
    panel.style.display = 'block';
}

document.getElementById('crmDetailCloseBtn')?.addEventListener('click', () => {
    document.getElementById('crmDetailPanel').style.display = 'none';
});

document.getElementById('addClientBtn')?.addEventListener('click', () => {
    const name = prompt('거래처명을 입력하세요:');
    if (!name || !name.trim()) return;
    const phone = prompt('연락처 (선택):') || '';
    const address = prompt('주소 (선택):') || '';
    const contact = prompt('담당자명 (선택):') || '';
    const grade = prompt('등급 (A/B/C, 기본: B):')?.toUpperCase() || 'B';
    const memo = prompt('메모 (선택):') || '';

    crmClients.push({ id: Date.now().toString(), name: name.trim(), phone, address, contact, grade: ['A','B','C'].includes(grade) ? grade : 'B', memo });
    saveCRM();
    renderCRM();
});

function editCRMClient(id) {
    const client = crmClients.find(c => c.id === id);
    if (!client) return;
    client.phone = prompt('연락처:', client.phone) ?? client.phone;
    client.address = prompt('주소:', client.address) ?? client.address;
    client.contact = prompt('담당자:', client.contact) ?? client.contact;
    const newGrade = prompt('등급 (A/B/C):', client.grade)?.toUpperCase();
    if (newGrade && ['A','B','C'].includes(newGrade)) client.grade = newGrade;
    client.memo = prompt('메모:', client.memo || '') ?? client.memo;
    saveCRM();
    renderCRM();
}

function deleteCRMClient(id) {
    if (!confirm('이 거래처를 삭제하시겠습니까?')) return;
    crmClients = crmClients.filter(c => c.id !== id);
    saveCRM();
    renderCRM();
}

document.getElementById('crmSearchInput')?.addEventListener('input', renderCRM);
document.getElementById('crmGradeFilter')?.addEventListener('change', renderCRM);

// ============================================================
// CALENDAR SYSTEM (결제 캘린더)
// ============================================================
let calCurrentDate = new Date();

function renderCalendar() {
    const grid = document.getElementById('calendarGrid');
    const titleEl = document.getElementById('calMonthTitle');
    if (!grid) return;

    const year = calCurrentDate.getFullYear();
    const month = calCurrentDate.getMonth();
    titleEl.textContent = `${year}년 ${month + 1}월`;

    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startDay = firstDay.getDay(); // 0=Sun
    const daysInMonth = lastDay.getDate();
    const prevMonthLastDay = new Date(year, month, 0).getDate();

    const todayStr = new Date().toISOString().split('T')[0];
    const monthPrefix = `${year}-${String(month + 1).padStart(2, '0')}`;

    // Build event map for this month
    const eventMap = {};
    records.forEach(r => {
        if (r.date && r.date.startsWith(monthPrefix)) {
            const day = parseInt(r.date.split('-')[2]);
            if (!eventMap[day]) eventMap[day] = [];
            const unpaid = (r.amount || 0) - (r.paymentAmount || 0);
            eventMap[day].push({
                client: r.clientName,
                item: r.item,
                amount: r.amount,
                isPaid: unpaid <= 0 && r.amount > 0,
                hasUnpaid: unpaid > 0
            });
        }
    });

    grid.innerHTML = '';
    // Header
    const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
    dayNames.forEach(d => {
        grid.innerHTML += `<div class="cal-header-cell">${d}</div>`;
    });

    // Previous month trailing days
    for (let i = startDay - 1; i >= 0; i--) {
        grid.innerHTML += `<div class="cal-day-cell other-month"><div class="cal-day-number">${prevMonthLastDay - i}</div></div>`;
    }

    // Current month days
    for (let d = 1; d <= daysInMonth; d++) {
        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const isToday = dateStr === todayStr;
        const events = eventMap[d] || [];

        let eventsHTML = '';
        events.slice(0, 3).forEach(ev => {
            if (ev.hasUnpaid) {
                eventsHTML += `<div class="cal-event event-unpaid" title="${ev.client} ${ev.item} ${formatCurrency(ev.amount)}원 (미지급)">${ev.client}</div>`;
            } else if (ev.isPaid) {
                eventsHTML += `<div class="cal-event event-paid" title="${ev.client} 정산완료">✓ ${ev.client}</div>`;
            } else {
                eventsHTML += `<div class="cal-event event-purchase" title="${ev.client} ${ev.item}">${ev.client}</div>`;
            }
        });
        if (events.length > 3) {
            eventsHTML += `<div class="cal-event event-purchase">+${events.length - 3}건 더</div>`;
        }

        grid.innerHTML += `<div class="cal-day-cell${isToday ? ' today' : ''}"><div class="cal-day-number">${d}</div>${eventsHTML}</div>`;
    }

    // Next month leading days
    const totalCells = startDay + daysInMonth;
    const remaining = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
    for (let i = 1; i <= remaining; i++) {
        grid.innerHTML += `<div class="cal-day-cell other-month"><div class="cal-day-number">${i}</div></div>`;
    }
}

document.getElementById('calPrevBtn')?.addEventListener('click', () => {
    calCurrentDate.setMonth(calCurrentDate.getMonth() - 1);
    renderCalendar();
});
document.getElementById('calNextBtn')?.addEventListener('click', () => {
    calCurrentDate.setMonth(calCurrentDate.getMonth() + 1);
    renderCalendar();
});
document.getElementById('calTodayBtn')?.addEventListener('click', () => {
    calCurrentDate = new Date();
    renderCalendar();
});

// ============================================================
// INVENTORY SYSTEM (재고 관리)
// ============================================================
const INV_KEY = 'wonma_inventory';
let inventoryLogs = sanitizeRecordsList(safeJSONParse(INV_KEY, []), INV_KEY);
const INV_MAX = { '매생이': 2000, '미역': 3000, '다시마': 3000 }; // Max capacity in kg
const INV_LOW = { '매생이': 200, '미역': 300, '다시마': 300 }; // Low stock threshold

function saveInventory() { localStorage.setItem(INV_KEY, JSON.stringify(inventoryLogs)); }

function getStockLevels() {
    const levels = { '매생이': 0, '미역': 0, '다시마': 0 };
    inventoryLogs.forEach(log => {
        if (levels[log.item] !== undefined) {
            if (log.type === '입고') {
                levels[log.item] += log.quantity;
            } else {
                levels[log.item] -= log.quantity;
            }
        }
    });
    // Clamp to 0
    Object.keys(levels).forEach(k => { if (levels[k] < 0) levels[k] = 0; });
    return levels;
}

function renderInventory() {
    const levels = getStockLevels();
    const tbody = document.getElementById('invTableBody');
    const emptyState = document.getElementById('invEmptyState');
    const alertPanel = document.getElementById('invAlertPanel');
    const alertText = document.getElementById('invAlertText');

    // Update gauge bars
    const items = [
        { key: '매생이', barId: 'invBarMaesaengi', amountId: 'invAmountMaesaengi' },
        { key: '미역', barId: 'invBarMiyeok', amountId: 'invAmountMiyeok' },
        { key: '다시마', barId: 'invBarDasima', amountId: 'invAmountDasima' }
    ];

    const lowItems = [];
    items.forEach(it => {
        const bar = document.getElementById(it.barId);
        const amountEl = document.getElementById(it.amountId);
        const level = levels[it.key];
        const max = INV_MAX[it.key];
        const pct = Math.min(Math.round((level / max) * 100), 100);

        if (bar) {
            bar.style.width = pct + '%';
            // Change color if low
            if (level <= INV_LOW[it.key] && level > 0) {
                bar.classList.add('bar-danger');
            } else {
                bar.classList.remove('bar-danger');
            }
        }
        if (amountEl) amountEl.textContent = `${formatCurrency(level)} kg`;
        if (level <= INV_LOW[it.key]) lowItems.push(it.key);
    });

    // Alert
    if (alertPanel && alertText) {
        if (settings.stockAlert && lowItems.length > 0) {
            alertPanel.style.display = 'block';
            alertText.innerHTML = `⚠️ <strong>${lowItems.join(', ')}</strong>의 재고가 부족합니다! 발주가 필요합니다.`;
        } else {
            alertPanel.style.display = 'none';
        }
    }

    // Table
    if (!tbody) return;
    // Apply filters
    const invFilterStart = document.getElementById('invFilterStart')?.value || '';
    const invFilterEnd = document.getElementById('invFilterEnd')?.value || '';
    const invFilterItem = document.getElementById('invFilterItem')?.value || 'all';
    const invFilterType = document.getElementById('invFilterType')?.value || 'all';
    
    const filtered = inventoryLogs.filter(log => {
        if (invFilterStart && log.date < invFilterStart) return false;
        if (invFilterEnd && log.date > invFilterEnd) return false;
        if (invFilterItem !== 'all' && log.item !== invFilterItem) return false;
        if (invFilterType !== 'all' && log.type !== invFilterType) return false;
        return true;
    });
    
    const sorted = [...filtered].sort((a, b) => new Date(b.date) - new Date(a.date));
    tbody.innerHTML = '';

    if (sorted.length === 0) {
        if (emptyState) emptyState.style.display = 'block';
        return;
    }
    if (emptyState) emptyState.style.display = 'none';

    sorted.forEach(log => {
        const typeColor = log.type === '입고' ? '#34d399' : '#f87171';
        const typeIcon = log.type === '입고' ? 'fa-arrow-down' : 'fa-arrow-up';
        tbody.innerHTML += `
            <tr>
                <td>${log.date}</td>
                <td><span class="badge badge-${log.item === '매생이' ? 'maesaengi' : log.item === '미역' ? 'miyeok' : 'dasima'}">${log.item}</span></td>
                <td style="color: ${typeColor}; font-weight: 600;"><i class="fa-solid ${typeIcon}"></i> ${log.type}</td>
                <td class="text-right">${formatCurrency(log.quantity)} kg</td>
                <td>${log.remarks || '-'}</td>
                <td class="text-center"><button class="btn-icon btn-danger" onclick="deleteInvLog('${log.id}')"><i class="fa-solid fa-trash"></i></button></td>
            </tr>
        `;
    });

    // --- Inventory Trend Chart (7 days) ---
    const trendToday = new Date();
    const last7 = [];
    for (let i = 6; i >= 0; i--) {
        const d = new Date(trendToday);
        d.setDate(d.getDate() - i);
        last7.push(d.toISOString().split('T')[0]);
    }
    
    // Calculate cumulative stock for each day
    const dailyStock = { '매생이': Array(7).fill(0), '미역': Array(7).fill(0), '다시마': Array(7).fill(0) };
    
    // For each day, compute what stock level was at end of that day
    ['매생이', '미역', '다시마'].forEach(item => {
        last7.forEach((dateStr, idx) => {
            let stockAtDate = 0;
            inventoryLogs.forEach(log => {
                if (log.item === item && log.date <= dateStr) {
                    stockAtDate += (log.type === '입고' ? log.quantity : -log.quantity);
                }
            });
            dailyStock[item][idx] = Math.max(0, stockAtDate);
        });
    });
    
    const ctxTrend = document.getElementById('invTrendChart');
    if (ctxTrend && window.Chart) {
        if (window.invTrendChartInstance) window.invTrendChartInstance.destroy();
        window.invTrendChartInstance = new Chart(ctxTrend, {
            type: 'line',
            data: {
                labels: last7.map(d => d.substring(5)),
                datasets: [
                    { label: '매생이', data: dailyStock['매생이'], borderColor: '#38bdf8', backgroundColor: 'rgba(56, 189, 248, 0.1)', fill: true, tension: 0.4, borderWidth: 2, pointRadius: 3 },
                    { label: '미역', data: dailyStock['미역'], borderColor: '#34d399', backgroundColor: 'rgba(52, 211, 153, 0.1)', fill: true, tension: 0.4, borderWidth: 2, pointRadius: 3 },
                    { label: '다시마', data: dailyStock['다시마'], borderColor: '#a78bfa', backgroundColor: 'rgba(167, 139, 250, 0.1)', fill: true, tension: 0.4, borderWidth: 2, pointRadius: 3 }
                ]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                scales: {
                    x: { ticks: { color: '#94a3b8' }, grid: { color: 'rgba(255,255,255,0.05)' } },
                    y: { ticks: { color: '#94a3b8', callback: v => v + ' kg' }, grid: { color: 'rgba(255,255,255,0.05)' } }
                },
                plugins: { legend: { position: 'top', labels: { color: '#f8fafc', padding: 15, usePointStyle: true } } }
            }
        });
    }
    
    // --- Depletion Forecast ---
    const forecastItems = [
        { key: '매생이', elId: 'invForecastMaesaengi' },
        { key: '미역', elId: 'invForecastMiyeok' },
        { key: '다시마', elId: 'invForecastDasima' }
    ];
    
    forecastItems.forEach(fi => {
        const el = document.getElementById(fi.elId);
        if (!el) return;
        
        const currentStock = levels[fi.key];
        
        // Calculate average daily outgoing over last 7 days
        let totalOut7 = 0;
        inventoryLogs.forEach(log => {
            if (log.item === fi.key && log.type === '출고') {
                const logDate = new Date(log.date);
                const diffDays = Math.ceil((trendToday - logDate) / (1000 * 60 * 60 * 24));
                if (diffDays >= 0 && diffDays <= 7) {
                    totalOut7 += log.quantity;
                }
            }
        });
        
        const avgDailyOut = totalOut7 / 7;
        
        if (avgDailyOut <= 0 || currentStock <= 0) {
            el.className = 'inv-forecast';
            el.innerHTML = '<i class="fa-solid fa-chart-line"></i> 출고 데이터 부족';
        } else {
            const daysLeft = Math.round(currentStock / avgDailyOut);
            if (daysLeft <= 3) {
                el.className = 'inv-forecast forecast-danger';
                el.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> 약 <strong>${daysLeft}일</strong> 후 소진 예상 — 긴급 발주 필요!`;
            } else if (daysLeft <= 7) {
                el.className = 'inv-forecast forecast-warning';
                el.innerHTML = `<i class="fa-solid fa-clock"></i> 약 <strong>${daysLeft}일</strong> 후 소진 예상 (일평균 출고 ${formatCurrency(Math.round(avgDailyOut))}kg)`;
            } else {
                el.className = 'inv-forecast forecast-safe';
                el.innerHTML = `<i class="fa-solid fa-check-circle"></i> 약 <strong>${daysLeft}일</strong>분 재고 보유 (일평균 출고 ${formatCurrency(Math.round(avgDailyOut))}kg)`;
            }
        }
    });
}

// Inventory Filter Listeners
document.getElementById('invFilterStart')?.addEventListener('change', renderInventory);
document.getElementById('invFilterEnd')?.addEventListener('change', renderInventory);
document.getElementById('invFilterItem')?.addEventListener('change', renderInventory);
document.getElementById('invFilterType')?.addEventListener('change', renderInventory);

document.getElementById('addStockBtn')?.addEventListener('click', () => {
    const item = prompt('품목 (매생이/미역/다시마):');
    if (!item || !['매생이', '미역', '다시마'].includes(item)) {
        alert('매생이, 미역, 다시마 중 하나를 입력해주세요.');
        return;
    }
    const type = prompt('유형 (입고/출고):');
    if (!type || !['입고', '출고'].includes(type)) {
        alert('입고 또는 출고를 입력해주세요.');
        return;
    }
    const quantity = parseFloat(prompt('수량 (kg):'));
    if (isNaN(quantity) || quantity <= 0) {
        alert('올바른 수량을 입력해주세요.');
        return;
    }
    const date = prompt('날짜 (YYYY-MM-DD):', new Date().toISOString().split('T')[0]);
    const remarks = prompt('비고 (선택):') || '';

    inventoryLogs.push({
        id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
        item, type, quantity, date: date || new Date().toISOString().split('T')[0], remarks
    });
    saveInventory();
    renderInventory();
});

function deleteInvLog(id) {
    if (!confirm('이 입출고 내역을 삭제하시겠습니까?')) return;
    inventoryLogs = inventoryLogs.filter(l => l.id !== id);
    saveInventory();
    renderInventory();
}

// --- Inventory CSV Auto Upload ---
const invAutoUploadBtn = document.getElementById('invAutoUploadBtn');
const invExcelInput = document.getElementById('invExcelInput');

function handleInvFileUpload(file) {
    if (!file) return;
    const name = file.name ? file.name.toLowerCase() : '';
    if (name.endsWith('.csv') || name.endsWith('.txt')) {
        readInvAsTextFallback(file);
        return;
    }
    if (window.XLSX) {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array', cellDates: true });
                const firstSheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[firstSheetName];
                const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: false });
                parseInvArrayRowsAndAdd(rows);
            } catch (err) {
                console.warn("Inv XLSX parse error, falling back to text CSV:", err);
                readInvAsTextFallback(file);
            }
        };
        reader.readAsArrayBuffer(file);
    } else {
        readInvAsTextFallback(file);
    }
}

function readInvAsTextFallback(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
        let text = e.target.result;
        if (text.includes('') || text.includes('\uFFFD') || /[\xC0-\xFD][\x80-\xBF]/.test(text) || text.includes('ì') || text.includes('ë')) {
            const eucReader = new FileReader();
            eucReader.onload = (ev) => parseInvCSVAndAdd(ev.target.result);
            eucReader.readAsText(file, 'euc-kr');
        } else {
            parseInvCSVAndAdd(text);
        }
    };
    reader.readAsText(file, 'UTF-8');
}

function parseInvCSVAndAdd(csvText) {
    if (!csvText) return;
    const lines = csvText.split(/\r?\n/).filter(line => line.trim() !== '');
    if (lines.length === 0) {
        alert('⚠️ 데이터가 없거나 잘못된 파일입니다.');
        return;
    }
    const rows = lines.map(line => {
        const result = [];
        let cur = '';
        let inQuote = false;
        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            if (char === '"') { inQuote = !inQuote; }
            else if (char === ',' && !inQuote) { result.push(cur.trim().replace(/^"|"$/g, '')); cur = ''; }
            else { cur += char; }
        }
        result.push(cur.trim().replace(/^"|"$/g, ''));
        return result;
    });
    parseInvArrayRowsAndAdd(rows);
}

function parseInvArrayRowsAndAdd(rows) {
    if (!rows || rows.length === 0) {
        alert('⚠️ 엑셀 파일에 유효한 데이터가 없거나 양식이 올바르지 않습니다.');
        return;
    }
    let addedCount = 0;
    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (!row || !Array.isArray(row) || row.every(cell => !String(cell || '').trim())) continue;

        let firstCell = String(row[0] || '').trim();
        // Check if row is header/title
        if (firstCell.includes('날짜') || firstCell.includes('일자') || firstCell.includes('품목') || firstCell.includes('재고')) {
            continue;
        }

        const dateStr = normalizeExcelDate(row[0]);
        const itemRaw = String(row[1] || '').trim();
        let item = '';
        if (itemRaw.includes('매생')) item = '매생이';
        else if (itemRaw.includes('미역')) item = '미역';
        else if (itemRaw.includes('다시마')) item = '다시마';

        const typeRaw = String(row[2] || '').trim();
        let type = '';
        if (typeRaw.includes('입') || typeRaw.toLowerCase() === 'in') type = '입고';
        else if (typeRaw.includes('출') || typeRaw.toLowerCase() === 'out') type = '출고';

        const quantity = normalizeExcelNumber(row[3], 0);
        const remarks = String(row[4] || '엑셀 자동 등록').trim();

        if (!item || !type || quantity <= 0) continue;

        inventoryLogs.push({
            id: Date.now().toString() + Math.random().toString(36).substr(2, 5) + i,
            item, type, quantity, date: dateStr, remarks
        });
        addedCount++;
    }

    if (addedCount > 0) {
        saveInventory();
        renderInventory();
        alert(`✅ 총 ${addedCount}건의 재고 입출고 내역이 한글 깨짐이나 오류 없이 완벽 등록되었습니다!`);
    } else {
        alert('⚠️ 유효한 데이터가 없습니다.\n엑셀 양식: 날짜, 품목(매생이/미역/다시마), 유형(입고/출고), 수량, 비고');
    }
}

if (invAutoUploadBtn && invExcelInput) {
    invAutoUploadBtn.addEventListener('click', () => {
        invExcelInput.click();
    });

    invExcelInput.addEventListener('change', (e) => {
        handleInvFileUpload(e.target.files[0]);
        invExcelInput.value = '';
    });
}


// --- Settings Logic ---
const setThemeLight = document.getElementById('setThemeLight');
const setFontSize = document.getElementById('setFontSize');
const setUnpaidDays = document.getElementById('setUnpaidDays');
const setStockAlert = document.getElementById('setStockAlert');
const setVatInclude = document.getElementById('setVatInclude');
const setPriceMaesaengi = document.getElementById('setPriceMaesaengi');
const setPriceMiyeok = document.getElementById('setPriceMiyeok');
const setPriceDasima = document.getElementById('setPriceDasima');
const savePricesBtn = document.getElementById('savePricesBtn');

const setCompanyName = document.getElementById('setCompanyName');
const setBizNumber = document.getElementById('setBizNumber');
const setBizAddress = document.getElementById('setBizAddress');
const setBizPhone = document.getElementById('setBizPhone');
const setStampInput = document.getElementById('setStampInput');
const setStampPreview = document.getElementById('setStampPreview');
const setStampPlaceholder = document.getElementById('setStampPlaceholder');
const clearStampBtn = document.getElementById('clearStampBtn');
const saveReceiptBtn = document.getElementById('saveReceiptBtn');

function initSettingsUI() {
    if(!setThemeLight) return; // if settings view is not in DOM
    
    // 1. UI Settings
    setThemeLight.checked = settings.themeLight;
    setFontSize.value = settings.fontSize;

    setThemeLight.addEventListener('change', (e) => {
        settings.themeLight = e.target.checked;
        saveSettings();
        applyThemeSettings();
    });

    setFontSize.addEventListener('change', (e) => {
        settings.fontSize = e.target.value;
        saveSettings();
        applyThemeSettings();
    });

    // 2. Smart & VAT
    setUnpaidDays.value = settings.unpaidDays;
    setStockAlert.checked = settings.stockAlert;
    setVatInclude.checked = settings.vatInclude;

    setUnpaidDays.addEventListener('change', (e) => {
        settings.unpaidDays = parseInt(e.target.value) || 14;
        saveSettings();
        renderDashboard();
    });

    setStockAlert.addEventListener('change', (e) => {
        settings.stockAlert = e.target.checked;
        saveSettings();
        renderInventory(); // Re-evaluates alerts
    });

    setVatInclude.addEventListener('change', (e) => {
        settings.vatInclude = e.target.checked;
        saveSettings();
        // Recalculate amount if modal is open
        if(quantityInput.value && unitPriceInput.value) calculateAmount();
    });

    // 3. Prices
    setPriceMaesaengi.value = settings.prices.maesaengi || '';
    setPriceMiyeok.value = settings.prices.miyeok || '';
    setPriceDasima.value = settings.prices.dasima || '';

    savePricesBtn.addEventListener('click', () => {
        settings.prices.maesaengi = parseFloat(setPriceMaesaengi.value) || 0;
        settings.prices.miyeok = parseFloat(setPriceMiyeok.value) || 0;
        settings.prices.dasima = parseFloat(setPriceDasima.value) || 0;
        saveSettings();
        alert('기본 단가가 저장되었습니다.');
    });

    // 4. Receipt
    setCompanyName.value = settings.receipt.companyName || '';
    setBizNumber.value = settings.receipt.bizNumber || '';
    setBizAddress.value = settings.receipt.address || '';
    setBizPhone.value = settings.receipt.phone || '';

    if (settings.receipt.stampImg) {
        setStampPreview.src = settings.receipt.stampImg;
        setStampPreview.style.display = 'block';
        setStampPlaceholder.style.display = 'none';
        clearStampBtn.style.display = 'block';
    }

    setStampInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            const dataUrl = ev.target.result;
            settings.receipt.stampImg = dataUrl;
            setStampPreview.src = dataUrl;
            setStampPreview.style.display = 'block';
            setStampPlaceholder.style.display = 'none';
            clearStampBtn.style.display = 'block';
        };
        reader.readAsDataURL(file);
    });

    clearStampBtn.addEventListener('click', () => {
        settings.receipt.stampImg = '';
        setStampPreview.src = '';
        setStampPreview.style.display = 'none';
        setStampPlaceholder.style.display = 'flex';
        clearStampBtn.style.display = 'none';
        setStampInput.value = '';
    });

    saveReceiptBtn.addEventListener('click', () => {
        settings.receipt.companyName = setCompanyName.value;
        settings.receipt.bizNumber = setBizNumber.value;
        settings.receipt.address = setBizAddress.value;
        settings.receipt.phone = setBizPhone.value;
        saveSettings();
        alert('영수증 맞춤 정보가 저장되었습니다.');
    });
}

// Call on startup
initSettingsUI();

// ============================================================
// --- Phase 2: High-End Premium Features Helper Functions ---
// ============================================================

// 1. CRM Credit Limit Management
function setCreditLimit(id) {
    const client = crmClients.find(c => c.id === id);
    if (!client) return;
    const currentLimit = client.creditLimit || 10000000;
    const input = prompt(`[${client.name}] 미수금 허용 신용한도(원)를 입력하세요.\n(기본값: 10,000,000원 - 1천만 원)`, currentLimit);
    if (input === null) return;
    const val = parseInt(input.replace(/[^0-9]/g, ''), 10);
    if (isNaN(val) || val < 0) {
        alert('올바른 금액을 입력하세요.');
        return;
    }
    client.creditLimit = val;
    saveCRM();
    renderCRM();
    alert(`[${client.name}] 신용한도가 ${formatCurrency(val)}원으로 설정되었습니다.`);
}

// 2. Smart Kakao/SMS Billing Message Generator
function copyKakaoBilling(clientName) {
    const clientRecords = records.filter(r => r.clientName === clientName);
    if (clientRecords.length === 0) {
        alert('해당 거래처의 거래 내역이 없습니다.');
        return;
    }
    const totalRev = clientRecords.reduce((s, r) => s + (r.amount || 0), 0);
    const totalPaid = clientRecords.reduce((s, r) => s + (r.paymentAmount || 0), 0);
    const unpaid = Math.max(0, totalRev - totalPaid);
    const todayStr = new Date().toISOString().split('T')[0];

    const msg = `[원마수산 정산 안내]\n안녕하세요, ${clientName} 대표님. 원마수산입니다.\n금일(${todayStr}) 기준 미결제 정산 잔액 안내드립니다.\n\n▪ 총 매입액: ${formatCurrency(totalRev)}원\n▪ 지급 완료액: ${formatCurrency(totalPaid)}원\n▪ 금일 기준 미지급 잔액: ${formatCurrency(unpaid)}원\n\n확인 부탁드리며, 문의사항 있으시면 언제든 연락 주십시오. 감사합니다.\n- 원마수산 배상 -`;

    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(msg).then(() => {
            showToast(`💬 [${clientName}] 정산 안내톡이 복사되었습니다! 카톡이나 문자에 Ctrl+V 하세요.`);
        }).catch(() => {
            fallbackCopyTextToClipboard(msg, clientName);
        });
    } else {
        fallbackCopyTextToClipboard(msg, clientName);
    }
}

function fallbackCopyTextToClipboard(text, clientName) {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.style.position = "fixed";
    textArea.style.left = "-999999px";
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    try {
        document.execCommand('copy');
        showToast(`💬 [${clientName}] 정산 안내톡이 복사되었습니다! 카톡이나 문자에 Ctrl+V 하세요.`);
    } catch (err) {
        alert("복사 실패: 직접 복사해주세요.\n\n" + text);
    }
    document.body.removeChild(textArea);
}

function showToast(message) {
    const container = document.getElementById('toastContainer');
    if (!container) {
        alert(message);
        return;
    }
    const toast = document.createElement('div');
    toast.className = 'toast-popup';
    toast.innerHTML = `<i class="fa-solid fa-bell" style="color: #38bdf8; font-size: 18px;"></i><span>${message}</span>`;
    container.appendChild(toast);
    setTimeout(() => {
        toast.classList.add('toast-fade-out');
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

// 3. Price Trend Chart (Last 6 Months Average Unit Price)
function renderPriceTrendChart() {
    const today = new Date();
    const priceData = {};
    for (let i = 5; i >= 0; i--) {
        const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
        const monthStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        priceData[monthStr] = {
            '매생이': { amt: 0, qty: 0 },
            '미역': { amt: 0, qty: 0 },
            '다시마': { amt: 0, qty: 0 }
        };
    }
    records.forEach(r => {
        const m = r.date ? r.date.substring(0, 7) : '';
        if (priceData[m] && priceData[m][r.item]) {
            priceData[m][r.item].amt += (r.amount || 0);
            priceData[m][r.item].qty += (r.quantity || 0);
        }
    });
    const priceLabels = Object.keys(priceData);
    const getAvgPrice = (month, item) => {
        const d = priceData[month][item];
        return d.qty > 0 ? Math.round(d.amt / d.qty) : (settings.prices[item === '매생이' ? 'maesaengi' : item === '미역' ? 'miyeok' : 'dasima'] || 0);
    };
    const ctxPriceTrend = document.getElementById('priceTrendChart');
    if (ctxPriceTrend && window.Chart) {
        if (window.priceTrendChartInstance) window.priceTrendChartInstance.destroy();
        window.priceTrendChartInstance = new Chart(ctxPriceTrend, {
            type: 'line',
            data: {
                labels: priceLabels,
                datasets: [
                    { label: '매생이 (원/kg)', data: priceLabels.map(l => getAvgPrice(l, '매생이')), borderColor: '#0ea5e9', backgroundColor: 'rgba(14, 165, 233, 0.1)', tension: 0.3, borderWidth: 3, pointRadius: 4 },
                    { label: '미역 (원/kg)', data: priceLabels.map(l => getAvgPrice(l, '미역')), borderColor: '#10b981', backgroundColor: 'rgba(16, 185, 129, 0.1)', tension: 0.3, borderWidth: 3, pointRadius: 4 },
                    { label: '다시마 (원/kg)', data: priceLabels.map(l => getAvgPrice(l, '다시마')), borderColor: '#8b5cf6', backgroundColor: 'rgba(139, 92, 246, 0.1)', tension: 0.3, borderWidth: 3, pointRadius: 4 }
                ]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                scales: {
                    x: { ticks: { color: '#94a3b8' }, grid: { color: 'rgba(255,255,255,0.05)' } },
                    y: { ticks: { color: '#94a3b8', callback: v => formatCurrency(v) + '원' }, grid: { color: 'rgba(255,255,255,0.05)' } }
                },
                plugins: { legend: { position: 'top', labels: { color: '#f8fafc', padding: 15, usePointStyle: true } } }
            }
        });
    }
}

// 4. Monthly Executive Report
function renderMonthlyReport() {
    const select = document.getElementById('reportMonthSelect');
    const container = document.getElementById('monthlyReportContainer');
    if (!select || !container) return;

    // Build available months list
    const months = [...new Set(records.map(r => (r.date || '').substring(0, 7)))].filter(Boolean).sort().reverse();
    const currentVal = select.value || (months[0] || 'all');
    select.innerHTML = '<option value="all">전체 누적 기간</option>' + months.map(m => `<option value="${m}" ${m === currentVal ? 'selected' : ''}>${m} 월간 보고서</option>`).join('');
    select.value = currentVal;

    const targetMonth = select.value || 'all';
    const reportRecords = records.filter(r => targetMonth === 'all' || (r.date && r.date.startsWith(targetMonth)));

    let totalRev = 0, totalPaid = 0;
    let qtyMae = 0, qtyMiy = 0, qtyDas = 0;
    const clientSet = new Set();

    reportRecords.forEach(r => {
        totalRev += (r.amount || 0);
        totalPaid += (r.paymentAmount || 0);
        clientSet.add(r.clientName);
        if (r.item === '매생이') qtyMae += (r.quantity || 0);
        else if (r.item === '미역') qtyMiy += (r.quantity || 0);
        else if (r.item === '다시마') qtyDas += (r.quantity || 0);
    });

    const totalUnpaid = Math.max(0, totalRev - totalPaid);

    container.innerHTML = `
        <table class="report-table">
            <thead>
                <tr>
                    <th>구분항목</th>
                    <th class="text-right">거래 수량 / 거래처 수</th>
                    <th class="text-right">합계 금액 (원)</th>
                    <th>비고</th>
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td><strong>매생이 총 매입</strong></td>
                    <td class="text-right">${formatCurrency(qtyMae)} kg</td>
                    <td class="text-right">-</td>
                    <td>주요 원물 물량</td>
                </tr>
                <tr>
                    <td><strong>미역 총 매입</strong></td>
                    <td class="text-right">${formatCurrency(qtyMiy)} kg</td>
                    <td class="text-right">-</td>
                    <td>주요 원물 물량</td>
                </tr>
                <tr>
                    <td><strong>다시마 총 매입</strong></td>
                    <td class="text-right">${formatCurrency(qtyDas)} kg</td>
                    <td class="text-right">-</td>
                    <td>주요 원물 물량</td>
                </tr>
                <tr>
                    <td><strong>거래 참여 거래처</strong></td>
                    <td class="text-right">${clientSet.size}개사</td>
                    <td class="text-right">-</td>
                    <td>활동 거래처 수</td>
                </tr>
                <tr style="border-top: 2px solid #cbd5e1;">
                    <td><strong>총 매입 금액 (매출/매입 총계)</strong></td>
                    <td class="text-right">${reportRecords.length}건 거래</td>
                    <td class="text-right" style="font-weight:700; color:#38bdf8;">${formatCurrency(totalRev)}원</td>
                    <td>지급 의무 총액</td>
                </tr>
                <tr>
                    <td><strong>지급 완료 대금</strong></td>
                    <td class="text-right">${reportRecords.filter(r=>r.paymentAmount>0).length}건 지급</td>
                    <td class="text-right" style="font-weight:700; color:#34d399;">${formatCurrency(totalPaid)}원</td>
                    <td>자금 집행 완료</td>
                </tr>
                <tr class="summary-total-row">
                    <td><strong>미지급 정산 잔액</strong></td>
                    <td class="text-right">-</td>
                    <td class="text-right" style="color:#f87171;">${formatCurrency(totalUnpaid)}원</td>
                    <td>향후 집행 예정액</td>
                </tr>
            </tbody>
        </table>
    `;
}

function printMonthlyReport() {
    const select = document.getElementById('reportMonthSelect');
    const targetMonth = select ? (select.value || 'all') : 'all';
    const reportRecords = records.filter(r => targetMonth === 'all' || (r.date && r.date.startsWith(targetMonth)));

    let totalRev = 0, totalPaid = 0;
    let qtyMae = 0, qtyMiy = 0, qtyDas = 0;
    const clientSet = new Set();
    reportRecords.forEach(r => {
        totalRev += (r.amount || 0);
        totalPaid += (r.paymentAmount || 0);
        clientSet.add(r.clientName);
        if (r.item === '매생이') qtyMae += (r.quantity || 0);
        else if (r.item === '미역') qtyMiy += (r.quantity || 0);
        else if (r.item === '다시마') qtyDas += (r.quantity || 0);
    });
    const totalUnpaid = Math.max(0, totalRev - totalPaid);
    const titleText = targetMonth === 'all' ? '전체 누적 경영 보고서' : `${targetMonth} 월간 경영 정산 보고서`;

    const printArea = document.getElementById('printArea');
    if (!printArea) return;

    printArea.innerHTML = `
        <div class="report-print-container" style="padding: 24px; color: black; background: white;">
            <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 3px solid #0f172a; padding-bottom: 16px; margin-bottom: 24px;">
                <div>
                    <h1 style="font-size: 26px; font-weight: 800; margin: 0; color: #0f172a;">${titleText}</h1>
                    <p style="margin: 6px 0 0; color: #475569; font-size: 14px;">원마수산 원물 지급 및 재무 종합 분석 리포트</p>
                </div>
                <div style="text-align: right; font-size: 13px; color: #475569;">
                    <p style="margin: 2px 0;"><strong>발행일자:</strong> ${new Date().toISOString().split('T')[0]}</p>
                    <p style="margin: 2px 0;"><strong>발행기관:</strong> ${settings.receipt.companyName || '원마수산'}</p>
                </div>
            </div>

            <h3 style="font-size: 16px; color: #0f172a; margin-bottom: 12px; border-left: 4px solid #0ea5e9; padding-left: 8px;">1. 요약 실적 종합</h3>
            <table class="report-table" style="width: 100%; border-collapse: collapse; margin-bottom: 28px;">
                <thead>
                    <tr style="background: #f1f5f9; color: #0f172a; border: 1px solid #cbd5e1;">
                        <th style="padding: 12px; border: 1px solid #cbd5e1;">총 매입액 (계약총액)</th>
                        <th style="padding: 12px; border: 1px solid #cbd5e1;">지급 완료액</th>
                        <th style="padding: 12px; border: 1px solid #cbd5e1;">미지급 잔액</th>
                        <th style="padding: 12px; border: 1px solid #cbd5e1;">거래 참여 거래처 수</th>
                    </tr>
                </thead>
                <tbody>
                    <tr style="text-align: right; font-size: 16px; font-weight: 700;">
                        <td style="padding: 14px; border: 1px solid #cbd5e1; color: #0f172a;">${formatCurrency(totalRev)}원</td>
                        <td style="padding: 14px; border: 1px solid #cbd5e1; color: #10b981;">${formatCurrency(totalPaid)}원</td>
                        <td style="padding: 14px; border: 1px solid #cbd5e1; color: #ef4444;">${formatCurrency(totalUnpaid)}원</td>
                        <td style="padding: 14px; border: 1px solid #cbd5e1; text-align: center; color: #0f172a;">${clientSet.size}개사</td>
                    </tr>
                </tbody>
            </table>

            <h3 style="font-size: 16px; color: #0f172a; margin-bottom: 12px; border-left: 4px solid #10b981; padding-left: 8px;">2. 품목별 매입 수량 현황</h3>
            <table class="report-table" style="width: 100%; border-collapse: collapse; margin-bottom: 36px;">
                <thead>
                    <tr style="background: #f1f5f9; color: #0f172a; border: 1px solid #cbd5e1;">
                        <th style="padding: 10px; border: 1px solid #cbd5e1;">매생이</th>
                        <th style="padding: 10px; border: 1px solid #cbd5e1;">미역</th>
                        <th style="padding: 10px; border: 1px solid #cbd5e1;">다시마</th>
                        <th style="padding: 10px; border: 1px solid #cbd5e1;">합계 수량</th>
                    </tr>
                </thead>
                <tbody>
                    <tr style="text-align: right; font-weight: 600;">
                        <td style="padding: 12px; border: 1px solid #cbd5e1;">${formatCurrency(qtyMae)} kg</td>
                        <td style="padding: 12px; border: 1px solid #cbd5e1;">${formatCurrency(qtyMiy)} kg</td>
                        <td style="padding: 12px; border: 1px solid #cbd5e1;">${formatCurrency(qtyDas)} kg</td>
                        <td style="padding: 12px; border: 1px solid #cbd5e1; font-weight: 700; color: #0f172a;">${formatCurrency(qtyMae + qtyMiy + qtyDas)} kg</td>
                    </tr>
                </tbody>
            </table>

            <div style="margin-top: 48px; display: flex; justify-content: flex-end; align-items: center; gap: 16px;">
                <div style="text-align: right;">
                    <p style="margin: 2px 0; font-size: 14px;">위와 같이 경영 실적 및 지급 내역을 확인하고 정산함.</p>
                    <p style="margin: 8px 0 0; font-weight: 700; font-size: 16px;">${settings.receipt.companyName || '원마수산'} 대표자</p>
                </div>
                <div style="position: relative; width: 64px; height: 64px; display: flex; align-items: center; justify-content: center;">
                    ${settings.receipt.stampImg ? `<img src="${settings.receipt.stampImg}" alt="직인" style="width:64px; height:64px; object-fit:contain;">` : `<div style="border:1px solid #94a3b8; padding:8px; border-radius:50%; font-size:12px; color:#64748b;">(인)</div>`}
                </div>
            </div>
        </div>
    `;

    window.print();
}

document.getElementById('reportMonthSelect')?.addEventListener('change', renderMonthlyReport);
document.getElementById('printReportBtn')?.addEventListener('click', printMonthlyReport);

