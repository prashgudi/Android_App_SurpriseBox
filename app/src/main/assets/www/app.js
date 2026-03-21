const STORAGE = {
  onboarded: "sb_onboarded",
  user: "sb_user",
  token: "sb_token",
  sessionRole: "sb_session_role",
  partnerContext: "sb_partner_context",
  apiBaseUrl: "sb_api_base_url",
  mockOtpMode: "sb_mock_otp_mode",
  notificationPrefs: "sb_notification_prefs",
  notifications: "sb_notifications",
  pushToken: "sb_push_token",
  webSocketUrl: "sb_ws_url",
  reservationRatings: "sb_reservation_ratings",
  supportTickets: "sb_support_tickets",
  supportCredits: "sb_support_credits",
  partnerApplication: "sb_partner_application"
};

const DEFAULT_API_BASE_URL = "https://api.surprisebox.in/v1";
const DEFAULT_LOCATION = { lat: 15.3647, lon: 75.1240 };
const MOCK_OTP_CODE = "123456";
const LIVE_POLL_INTERVAL_MS = 30000;
const LIVE_SOCKET_RETRY_MAX_MS = 30000;
const JS_TIMER_MAX_DELAY_MS = 2147483647;
const MAX_NOTIFICATIONS = 40;
const ACTIVE_RESERVATION_STATUSES = ["pending", "active", "confirmed"];
const PARTNER_ACTIVE_STATUSES = ["pending", "confirmed", "active", "reserved"];
const DEFAULT_PAYMENT_METHOD = "cash";
const PLATFORM_COMMISSION_RATE = 0.30;
const PAYMENT_SETTLED_STATUSES = ["paid", "captured", "completed", "settled"];
const DEFAULT_NOTIFICATION_PREFS = {
  liveUpdates: true,
  pickupReminders: true,
  whatsappReminders: true,
  webSocketUpdates: true
};

const onboardingSlides = [
  { title: "Save 60-70% on food", desc: "Discover surprise boxes from nearby restaurants at big discounts." },
  { title: "Fresh today, pick up tonight", desc: "Reserve now and collect in a fixed pickup slot." },
  { title: "Support local, reduce waste", desc: "Every reservation helps restaurants cut food waste." }
];

function createDefaultPartnerListingDraft() {
  return {
    quantity: "5",
    price: "99",
    pickupStartTime: "20:00",
    pickupEndTime: "21:00",
    description: ""
  };
}

function createDefaultPartnerApplicationDraft() {
  return {
    restaurantName: "",
    ownerName: "",
    phone: "",
    email: "",
    address: "",
    city: "",
    fssai: "",
    payoutUpi: "",
    documents: []
  };
}

const state = {
  route: "onboarding",
  onboardingIndex: 0,
  loginMode: "customer",
  sessionRole: "customer",
  pendingPhone: "",
  verificationId: "",
  activeListingId: null,
  activeListing: null,
  lastReservationId: null,
  partnerListingDraft: createDefaultPartnerListingDraft(),
  partnerApplicationDraft: createDefaultPartnerApplicationDraft(),
  filters: {
    radius: "5",
    cuisine: "all",
    sortBy: "distance"
  },
  busy: false,
  busyText: "",
  errorMessage: "",
  lastLiveSyncAt: 0,
  socketStatus: "disconnected",
  lastSocketEventAt: 0
};

let user = loadJSON(STORAGE.user, null);
let authToken = localStorage.getItem(STORAGE.token) || "";
let listings = [];
let reservations = [];
let partnerDashboard = null;
let partnerReservations = [];
let partnerListings = [];
let partnerLedger = null;
let partnerContext = loadJSON(STORAGE.partnerContext, null);
let adminPartners = [];
let adminPartnerEdits = {};
let adminPartnerNotes = {};
let notifications = loadJSON(STORAGE.notifications, []);
let notificationPrefs = loadNotificationPrefs();
let pushToken = localStorage.getItem(STORAGE.pushToken) || "";
let reservationRatings = loadJSON(STORAGE.reservationRatings, {});
let supportTickets = loadJSON(STORAGE.supportTickets, []);
let supportCredits = Number(localStorage.getItem(STORAGE.supportCredits) || "0");
let partnerApplication = loadJSON(STORAGE.partnerApplication, null);
let livePollTimerId = null;
let liveSyncInFlight = false;
let liveSocket = null;
let liveSocketReconnectTimerId = null;
let liveSocketRetryCount = 0;
let liveSocketManuallyStopped = false;
let lastSocketNotificationAt = 0;
const pickupReminderTimers = new Map();
const scheduledNativeReminderIds = new Set();

function isMockOtpModeEnabled() {
  return localStorage.getItem(STORAGE.mockOtpMode) === "true";
}

function setMockOtpModeEnabled(enabled) {
  localStorage.setItem(STORAGE.mockOtpMode, enabled ? "true" : "false");
}

function seedMockData() {
  if (listings.length === 0) {
    listings = [
      {
        id: 9001,
        restaurant: "Demo Bites Cafe",
        cuisine: ["indian", "snacks"],
        rating: 4.4,
        reviews: 128,
        price: 99,
        worth: 249,
        quantityAvailable: 6,
        distanceKm: 1.1,
        pickupSlot: "7:00 PM-9:00 PM",
        address: "Vidyanagar, Hubli",
        inside: "Wraps, rolls, and sides",
        allergens: "gluten",
        pickupDate: "",
        pickupStartTime: "",
        pickupEndTime: ""
      },
      {
        id: 9002,
        restaurant: "Mock Oven",
        cuisine: ["bakery", "desserts"],
        rating: 4.7,
        reviews: 89,
        price: 129,
        worth: 320,
        quantityAvailable: 4,
        distanceKm: 2.3,
        pickupSlot: "8:00 PM-10:00 PM",
        address: "Keshwapur, Hubli",
        inside: "Pastries and breads",
        allergens: "dairy, gluten",
        pickupDate: "",
        pickupStartTime: "",
        pickupEndTime: ""
      }
    ];
  }
}

function isPartnerSession() {
  return state.sessionRole === "partner";
}

function isPartnerLoginMode() {
  return state.loginMode === "partner";
}

function isAdminSession() {
  return state.sessionRole === "admin";
}

function normalizeRole(value) {
  const role = String(value || "").trim().toLowerCase();
  if (role === "admin") return "admin";
  return role === "partner" ? "partner" : "customer";
}

function normalizeLoginMode(value) {
  return value === "partner" ? "partner" : "customer";
}

function shouldShowRoleToggle() {
  return isMockOtpModeEnabled();
}

function setLoginMode(mode) {
  state.loginMode = mode === "partner" ? "partner" : "customer";
  clearError();
  render();
}

function mapPartnerDashboard(raw) {
  const dashboard = raw?.dashboard || raw || {};
  const summary = dashboard?.summary || dashboard?.today || dashboard;
  const restaurant = dashboard?.restaurant || summary?.restaurant || {};
  const restaurantId = restaurant?.id || dashboard?.restaurantId || summary?.restaurantId || partnerContext?.restaurantId || null;
  return {
    restaurantId,
    restaurantName: restaurant?.name || dashboard?.restaurantName || summary?.restaurantName || "Partner Restaurant",
    address: restaurant?.address || dashboard?.address || summary?.address || "Address unavailable",
    boxesListed: Number(summary?.boxes_listed ?? summary?.boxesListed ?? dashboard?.boxes_listed ?? dashboard?.boxesListed ?? 0),
    boxesSold: Number(summary?.boxes_sold ?? summary?.boxesSold ?? dashboard?.boxes_sold ?? dashboard?.boxesSold ?? 0),
    pickedUp: Number(summary?.picked_up ?? summary?.pickedUp ?? dashboard?.picked_up ?? dashboard?.pickedUp ?? 0),
    pending: Number(summary?.pending ?? summary?.pending_reservations ?? dashboard?.pending ?? 0),
    revenue: Number(summary?.revenue ?? dashboard?.revenue ?? 0)
  };
}

function mapPartnerReservation(raw) {
  const listing = raw?.listing || {};
  const customer = raw?.customer || raw?.user || {};
  const status = String(raw?.status || "pending").toLowerCase();
  const payment = raw?.payment || raw?.paymentDetails || {};
  const quantity = Number(raw?.quantity || raw?.reservedQuantity || 1);
  const fallbackAmount = Number(listing?.price || raw?.price || 0) * Math.max(1, quantity);
  return {
    id: raw?.id,
    code: raw?.code || raw?.reservationCode || raw?.reservation_code || `SB-${raw?.id || "0000"}`,
    customerName: customer?.name || raw?.customerName || "Customer",
    customerPhone: customer?.phone || raw?.customerPhone || "",
    quantity,
    pickupDate: listing?.pickupDate || raw?.pickupDate || "",
    pickupStartTime: listing?.pickupStartTime || raw?.pickupStartTime || "",
    pickupEndTime: listing?.pickupEndTime || raw?.pickupEndTime || "",
    pickupSlot: formatPickupSlot(
      listing?.pickupDate || raw?.pickupDate,
      listing?.pickupStartTime || raw?.pickupStartTime,
      listing?.pickupEndTime || raw?.pickupEndTime
    ),
    listingTitle: listing?.description || raw?.listingTitle || "Surprise Box",
    amount: Number(raw?.amount || payment?.amount || fallbackAmount),
    paymentMethod: normalizePaymentMethod(payment?.method || raw?.paymentMethod || raw?.payment_method),
    paymentStatus: normalizePaymentStatus(payment?.status || raw?.paymentStatus || raw?.payment_status),
    paymentReference: payment?.reference || raw?.paymentReference || raw?.payment_reference || "",
    paidAt: payment?.paidAt || raw?.paidAt || raw?.paymentPaidAt || "",
    status,
    createdAt: raw?.createdAt || new Date().toISOString()
  };
}

function normalizePaymentMethod(value) {
  const method = String(value || DEFAULT_PAYMENT_METHOD).trim().toLowerCase();
  if (method === "upi") return "upi";
  return "cash";
}

function normalizePaymentStatus(value) {
  const status = String(value || "pending").trim().toLowerCase();
  if (!status) return "pending";
  return status;
}

function isPaymentSettled(status) {
  return PAYMENT_SETTLED_STATUSES.includes(normalizePaymentStatus(status));
}

function formatPaymentMethod(method) {
  return normalizePaymentMethod(method) === "upi" ? "UPI" : "Cash";
}

function formatPaymentStatus(status) {
  const normalized = normalizePaymentStatus(status);
  if (normalized === "paid" || normalized === "captured" || normalized === "completed" || normalized === "settled") {
    return "Paid";
  }
  if (normalized === "failed") return "Failed";
  if (normalized === "refunded") return "Refunded";
  if (normalized === "cancelled") return "Cancelled";
  return "Pending";
}

function formatApplicationStatus(status) {
  const normalized = String(status || "submitted").replaceAll("_", " ").toLowerCase();
  if (!normalized) return "Submitted";
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function isReservationRateable(reservation) {
  const status = String(reservation?.status || "").toLowerCase();
  return status === "picked_up" || status === "completed" || status === "delivered";
}

function renderStars(stars = 0) {
  const normalized = Math.max(0, Math.min(5, Number(stars || 0)));
  return "★★★★★".slice(0, normalized) + "☆☆☆☆☆".slice(0, 5 - normalized);
}

function computeCommission(amount) {
  return Math.round(Number(amount || 0) * PLATFORM_COMMISSION_RATE);
}

function computePayout(amount) {
  return Math.max(0, Number(amount || 0) - computeCommission(amount));
}

function buildPartnerLedger(reservationItems = []) {
  const records = (Array.isArray(reservationItems) ? reservationItems : [])
    .filter((item) => String(item?.status || "").toLowerCase() !== "cancelled")
    .filter((item) => Number(item?.amount || 0) > 0);
  const gross = records.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const settled = records.filter((item) => isPaymentSettled(item.paymentStatus));
  const pending = records.filter((item) => !isPaymentSettled(item.paymentStatus));
  const paidGross = settled.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const pendingGross = pending.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const cashPaid = settled
    .filter((item) => normalizePaymentMethod(item.paymentMethod) === "cash")
    .reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const upiPaid = settled
    .filter((item) => normalizePaymentMethod(item.paymentMethod) === "upi")
    .reduce((sum, item) => sum + Number(item.amount || 0), 0);

  return {
    gross,
    commission: computeCommission(gross),
    payout: computePayout(gross),
    paidGross,
    pendingGross,
    cashPaid,
    upiPaid,
    settlements: records
      .slice()
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 12)
  };
}

function mapPartnerLedger(raw) {
  const source = raw?.ledger || raw?.report || raw || {};
  const summary = source?.summary || source;
  const computed = buildPartnerLedger(partnerReservations);
  return {
    gross: Number(summary?.gross ?? summary?.grossSales ?? computed.gross),
    commission: Number(summary?.commission ?? summary?.commissionAmount ?? computed.commission),
    payout: Number(summary?.payout ?? summary?.payoutAmount ?? computed.payout),
    paidGross: Number(summary?.paidGross ?? summary?.paidAmount ?? computed.paidGross),
    pendingGross: Number(summary?.pendingGross ?? summary?.pendingAmount ?? computed.pendingGross),
    cashPaid: Number(summary?.cashPaid ?? summary?.cashCollection ?? computed.cashPaid),
    upiPaid: Number(summary?.upiPaid ?? summary?.upiCollection ?? computed.upiPaid),
    settlements: Array.isArray(source?.settlements)
      ? source.settlements.map((item) => ({
          id: item?.id || item?.reservationId || "",
          code: item?.code || item?.reservationCode || `SB-${item?.reservationId || "0000"}`,
          amount: Number(item?.amount || 0),
          paymentMethod: normalizePaymentMethod(item?.paymentMethod || item?.method),
          paymentStatus: normalizePaymentStatus(item?.paymentStatus || item?.status),
          createdAt: item?.createdAt || item?.paidAt || new Date().toISOString()
        }))
      : computed.settlements
  };
}

function mapAdminPartner(raw) {
  return {
    id: raw?.id || raw?.partnerId || "",
    restaurantName: raw?.restaurantName || raw?.name || "Partner",
    phone: raw?.phone || raw?.contactPhone || "",
    address: raw?.address || "",
    status: String(raw?.status || "submitted").toLowerCase(),
    commissionRate: Number(raw?.commissionRate ?? raw?.commission ?? 0),
    payoutCycle: raw?.payoutCycle || raw?.payout || "weekly",
    zone: raw?.zone || raw?.city || "",
    reviewNotes: raw?.reviewNotes || raw?.notes || "",
    statusHistory: Array.isArray(raw?.statusHistory)
      ? raw.statusHistory
      : (Array.isArray(raw?.history) ? raw.history : []),
    createdAt: raw?.createdAt || new Date().toISOString()
  };
}

function getAdminPartnerEdit(partnerId) {
  if (!partnerId) return null;
  if (!adminPartnerEdits[partnerId]) {
    adminPartnerEdits[partnerId] = {
      commissionRate: "",
      payoutCycle: "",
      zone: ""
    };
  }
  return adminPartnerEdits[partnerId];
}

function updateAdminPartnerEdit(partnerId, key, value) {
  if (!partnerId) return;
  const edit = getAdminPartnerEdit(partnerId);
  if (!edit) return;
  edit[key] = String(value ?? "");
}

function updateAdminPartnerNote(partnerId, value) {
  if (!partnerId) return;
  adminPartnerNotes[partnerId] = String(value ?? "");
}

function computeAdminSummary(partners = []) {
  const summary = { submitted: 0, under_review: 0, approved: 0, live: 0, rejected: 0, suspended: 0 };
  partners.forEach((partner) => {
    const status = String(partner?.status || "submitted").toLowerCase();
    if (summary[status] !== undefined) summary[status] += 1;
    else summary.submitted += 1;
  });
  return summary;
}

function isActivePartnerReservationStatus(status) {
  return PARTNER_ACTIVE_STATUSES.includes(String(status || "").toLowerCase());
}

function seedMockPartnerData() {
  if (!partnerDashboard) {
    partnerDashboard = {
      restaurantId: partnerContext?.restaurantId || 777,
      restaurantName: partnerContext?.restaurantName || "Demo Partner Cafe",
      address: partnerContext?.address || "Vidyanagar, Hubli",
      boxesListed: 5,
      boxesSold: 4,
      pickedUp: 2,
      pending: 2,
      revenue: 280
    };
  }
  if (partnerReservations.length === 0) {
    partnerReservations = [
      {
        id: 7001,
        code: "SB-7001",
        customerName: "Priya",
        customerPhone: "+91 9876543210",
        quantity: 1,
        pickupDate: "",
        pickupStartTime: "20:00:00",
        pickupEndTime: "21:00:00",
        pickupSlot: "8:00 PM-9:00 PM",
        listingTitle: "Pizza slices and garlic bread",
        amount: 99,
        paymentMethod: "cash",
        paymentStatus: "pending",
        paymentReference: "",
        paidAt: "",
        status: "pending",
        createdAt: new Date().toISOString()
      },
      {
        id: 7002,
        code: "SB-7002",
        customerName: "Ravi",
        customerPhone: "+91 9123456780",
        quantity: 2,
        pickupDate: "",
        pickupStartTime: "20:30:00",
        pickupEndTime: "21:30:00",
        pickupSlot: "8:30 PM-9:30 PM",
        listingTitle: "Wraps and snacks",
        amount: 198,
        paymentMethod: "upi",
        paymentStatus: "paid",
        paymentReference: "UPI-MOCK-7002",
        paidAt: new Date().toISOString(),
        status: "confirmed",
        createdAt: new Date().toISOString()
      }
    ];
  }
  partnerContext = {
    restaurantId: partnerDashboard.restaurantId,
    restaurantName: partnerDashboard.restaurantName,
    address: partnerDashboard.address
  };
  partnerLedger = buildPartnerLedger(partnerReservations);
}

function seedMockAdminData() {
  if (adminPartners.length > 0) return;
  adminPartners = [
    {
      id: "P-1001",
      restaurantName: "Sunrise Bakery",
      phone: "+91 9876543210",
      address: "Indiranagar, Bengaluru",
      status: "under_review",
      commissionRate: 0.25,
      payoutCycle: "weekly",
      zone: "Indiranagar",
      reviewNotes: "Awaiting FSSAI copy.",
      statusHistory: [
        { status: "submitted", at: new Date(Date.now() - 86400000).toISOString() },
        { status: "under_review", at: new Date().toISOString() }
      ],
      createdAt: new Date().toISOString()
    },
    {
      id: "P-1002",
      restaurantName: "Spice Route Kitchen",
      phone: "+91 9123456780",
      address: "Koramangala, Bengaluru",
      status: "approved",
      commissionRate: 0.28,
      payoutCycle: "daily",
      zone: "Koramangala",
      reviewNotes: "Approved. Schedule onboarding call.",
      statusHistory: [
        { status: "submitted", at: new Date(Date.now() - 172800000).toISOString() },
        { status: "approved", at: new Date(Date.now() - 3600000).toISOString() }
      ],
      createdAt: new Date().toISOString()
    }
  ];
}

function normalizeApiBaseUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  let normalized = raw.replace(/\/+$/, "");
  try {
    const parsed = new URL(normalized);
    if (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") {
      // Android emulator maps host loopback to 10.0.2.2.
      parsed.hostname = "10.0.2.2";
    }
    normalized = parsed.toString().replace(/\/+$/, "");
  } catch {
    // Keep original for downstream validation.
  }
  return normalized;
}

function normalizeWebSocketUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  let normalized = raw.replace(/\/+$/, "");
  try {
    const parsed = new URL(normalized);
    if (parsed.protocol === "http:") parsed.protocol = "ws:";
    if (parsed.protocol === "https:") parsed.protocol = "wss:";
    if (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") {
      parsed.hostname = "10.0.2.2";
    }
    normalized = parsed.toString().replace(/\/+$/, "");
  } catch {
    // Keep original for validation.
  }
  return normalized;
}

function loadJSON(key, fallback) {
  const raw = localStorage.getItem(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function saveJSON(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function loadNotificationPrefs() {
  const stored = loadJSON(STORAGE.notificationPrefs, {});
  return { ...DEFAULT_NOTIFICATION_PREFS, ...stored };
}

function saveNotificationPrefs() {
  saveJSON(STORAGE.notificationPrefs, notificationPrefs);
}

function saveNotifications() {
  saveJSON(STORAGE.notifications, notifications);
}

function savePartnerApplication() {
  if (!partnerApplication) {
    localStorage.removeItem(STORAGE.partnerApplication);
    return;
  }
  saveJSON(STORAGE.partnerApplication, partnerApplication);
}

function saveSupportState() {
  saveJSON(STORAGE.reservationRatings, reservationRatings);
  saveJSON(STORAGE.supportTickets, supportTickets);
  localStorage.setItem(STORAGE.supportCredits, String(Math.max(0, Number(supportCredits || 0))));
}

function resetSupportState() {
  reservationRatings = {};
  supportTickets = [];
  supportCredits = 0;
  localStorage.removeItem(STORAGE.reservationRatings);
  localStorage.removeItem(STORAGE.supportTickets);
  localStorage.removeItem(STORAGE.supportCredits);
}

function getReservationRating(reservationId) {
  if (!reservationId) return null;
  return reservationRatings[String(reservationId)] || null;
}

function setReservationRating(reservationId, stars, comment = "") {
  if (!reservationId) return;
  reservationRatings[String(reservationId)] = {
    stars: Number(stars || 0),
    comment: String(comment || ""),
    updatedAt: new Date().toISOString()
  };
  saveSupportState();
}

function countRatedReservations() {
  return Object.values(reservationRatings).filter((item) => Number(item?.stars || 0) > 0).length;
}

function addNotification(title, message, type = "info") {
  const entry = {
    id: Date.now() + Math.floor(Math.random() * 1000),
    title,
    message,
    type,
    createdAt: new Date().toISOString()
  };
  notifications = [entry, ...notifications].slice(0, MAX_NOTIFICATIONS);
  saveNotifications();
}

function clearNotifications() {
  notifications = [];
  saveNotifications();
  render();
}

function isActiveReservationStatus(status) {
  return ACTIVE_RESERVATION_STATUSES.includes(String(status || "").toLowerCase());
}

function formatRelativeTime(timeValue) {
  const timestamp = new Date(timeValue).getTime();
  if (Number.isNaN(timestamp)) return "";
  const diffMs = Date.now() - timestamp;
  const diffSec = Math.max(0, Math.round(diffMs / 1000));
  if (diffSec < 15) return "just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  return `${diffDay}d ago`;
}

function getLiveSyncLabel() {
  if (isMockOtpModeEnabled()) return "Mock mode";
  if (!notificationPrefs.liveUpdates) return "Off";
  if (!state.lastLiveSyncAt) return "Waiting for first sync";
  return `Last sync ${formatRelativeTime(state.lastLiveSyncAt)}`;
}

function getSocketStatusLabel() {
  const status = state.socketStatus || "disconnected";
  if (status === "connected") {
    const when = state.lastSocketEventAt ? ` · event ${formatRelativeTime(state.lastSocketEventAt)}` : "";
    return `Connected${when}`;
  }
  if (status === "connecting") return "Connecting...";
  if (status === "reconnecting") return "Reconnecting...";
  if (status === "error") return "Connection error";
  if (status === "disabled") return "Disabled";
  if (status === "unsupported") return "Not supported";
  if (status === "invalid_url") return "Invalid URL";
  return "Disconnected";
}

function parsePickupDateTime(pickupDate, pickupStartTime) {
  if (!pickupDate || !pickupStartTime) return null;
  const parsed = new Date(`${pickupDate}T${pickupStartTime}`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function hasNativeReminderBridge() {
  return typeof window.SurpriseNative !== "undefined";
}

function isNativeNotificationPermissionGranted() {
  if (!hasNativeReminderBridge()) return false;
  try {
    return Boolean(window.SurpriseNative.isNotificationPermissionGranted());
  } catch {
    return false;
  }
}

function getNativeNotificationPermissionLabel() {
  if (!hasNativeReminderBridge()) return "Web only";
  return isNativeNotificationPermissionGranted() ? "Granted" : "Not granted";
}

function requestNativeNotificationPermission() {
  if (!hasNativeReminderBridge() || typeof window.SurpriseNative.requestNotificationPermission !== "function") {
    setError("Native notification permission API is unavailable.");
    return;
  }
  try {
    window.SurpriseNative.requestNotificationPermission();
  } catch {
    setError("Could not request native notification permission.");
  }
}

function hasNativePushBridge() {
  return hasNativeReminderBridge() && typeof window.SurpriseNative.getPushToken === "function";
}

function setPushToken(token) {
  const normalized = String(token || "").trim();
  pushToken = normalized;
  if (normalized) localStorage.setItem(STORAGE.pushToken, normalized);
  else localStorage.removeItem(STORAGE.pushToken);
}

function getNativePushToken() {
  if (!hasNativePushBridge()) return "";
  try {
    return String(window.SurpriseNative.getPushToken() || "").trim();
  } catch {
    return "";
  }
}

function requestNativePushToken() {
  if (!hasNativeReminderBridge() || typeof window.SurpriseNative.requestPushToken !== "function") return;
  try {
    window.SurpriseNative.requestPushToken();
  } catch {
    // Keep reminders flow resilient if push bridge fails.
  }
}

function scheduleNativePickupReminder(reservation, reminderAtMillis) {
  if (!hasNativeReminderBridge() || typeof window.SurpriseNative.schedulePickupReminder !== "function") {
    return false;
  }
  try {
    window.SurpriseNative.schedulePickupReminder(
      String(reservation.id),
      String(reservation.restaurant || "Restaurant"),
      String(reservation.pickupSlot || "pickup window"),
      Number(reminderAtMillis)
    );
    scheduledNativeReminderIds.add(String(reservation.id));
    return true;
  } catch {
    return false;
  }
}

function cancelNativePickupReminder(reservationId) {
  if (!hasNativeReminderBridge() || typeof window.SurpriseNative.cancelPickupReminder !== "function") {
    return;
  }
  try {
    window.SurpriseNative.cancelPickupReminder(String(reservationId));
    scheduledNativeReminderIds.delete(String(reservationId));
  } catch {
    // Keep cancellation resilient even if native bridge fails.
  }
}

function clearPickupReminderTimers() {
  pickupReminderTimers.forEach((timerId) => window.clearTimeout(timerId));
  pickupReminderTimers.clear();
}

function clearAllScheduledPickupReminders() {
  clearPickupReminderTimers();
  scheduledNativeReminderIds.forEach((reservationId) => cancelNativePickupReminder(reservationId));
  scheduledNativeReminderIds.clear();
  reservations.forEach((reservation) => cancelNativePickupReminder(reservation.id));
}

function schedulePickupReminder(reservation) {
  if (!notificationPrefs.pickupReminders) return;
  if (!reservation || !reservation.id || !isActiveReservationStatus(reservation.status)) return;

  const pickupAt = parsePickupDateTime(reservation.pickupDate, reservation.pickupStartTime);
  if (!pickupAt) return;
  const reminderAt = pickupAt.getTime() - (60 * 60 * 1000);
  const delay = reminderAt - Date.now();
  if (delay <= 0) return;

  scheduleNativePickupReminder(reservation, reminderAt);

  if (pickupReminderTimers.has(reservation.id)) return;
  if (delay > JS_TIMER_MAX_DELAY_MS) return;

  const timerId = window.setTimeout(() => {
    addNotification(
      "Pickup reminder",
      `${reservation.restaurant} pickup starts in 1 hour (${reservation.pickupSlot}).`,
      "reminder"
    );
    pickupReminderTimers.delete(reservation.id);
    if (state.route === "notifications") render();
  }, delay);

  pickupReminderTimers.set(reservation.id, timerId);
}

function reschedulePickupReminders() {
  clearAllScheduledPickupReminders();
  reservations.forEach(schedulePickupReminder);
}

function updateNotificationPreference(key) {
  notificationPrefs[key] = !notificationPrefs[key];
  saveNotificationPrefs();

  if (key === "liveUpdates") {
    if (notificationPrefs.liveUpdates) startLiveUpdates();
    else {
      stopLiveUpdates();
      setSocketStatus("disabled");
    }
  }

  if (key === "pickupReminders") {
    if (notificationPrefs.pickupReminders) reschedulePickupReminders();
    else clearAllScheduledPickupReminders();
  }

  if (key === "webSocketUpdates") {
    if (notificationPrefs.webSocketUpdates) connectLiveSocket();
    else {
      stopLiveSocket();
      setSocketStatus("disabled");
    }
  }

  if (authToken && !isMockOtpModeEnabled()) {
    syncNotificationPreferencesToBackend();
  }

  render();
}

async function syncNotificationPreferencesToBackend() {
  try {
    await apiSyncNotificationPreferences();
  } catch {
    // Keep UI responsive even if backend preference sync is unavailable.
  }
}

async function syncPushTokenWithBackend() {
  if (!authToken || isMockOtpModeEnabled()) return;
  const token = getNativePushToken() || pushToken;
  if (!token) return;
  setPushToken(token);
  try {
    await apiSyncPushToken(token);
  } catch {
    // Backend may not expose a push-token endpoint in all environments.
  }
}

function computeListingsSignature(items) {
  return items
    .map((item) => `${item.id}:${item.quantityAvailable}:${item.price}`)
    .sort()
    .join("|");
}

function computeReservationsSignature(items) {
  return items
    .map((item) => `${item.id}:${item.status}:${item.code}:${item.paymentStatus}:${item.paymentMethod}`)
    .sort()
    .join("|");
}

function computePartnerDashboardSignature(dashboard) {
  if (!dashboard) return "";
  return [
    dashboard.restaurantId,
    dashboard.boxesListed,
    dashboard.boxesSold,
    dashboard.pickedUp,
    dashboard.pending,
    dashboard.revenue
  ].join("|");
}

function computePartnerReservationsSignature(items) {
  return items
    .map((item) => `${item.id}:${item.status}:${item.code}:${item.quantity}:${item.paymentStatus}:${item.paymentMethod}`)
    .sort()
    .join("|");
}

async function runLiveSync() {
  if (!authToken || isMockOtpModeEnabled() || isAdminSession() || !notificationPrefs.liveUpdates || liveSyncInFlight) return;
  liveSyncInFlight = true;
  try {
    if (isPartnerSession()) {
      const [dashboardResponse, reservationsResponse] = await Promise.all([
        apiGetPartnerDashboard(),
        apiGetPartnerReservations()
      ]);
      const nextDashboard = mapPartnerDashboard(dashboardResponse.dashboard || dashboardResponse);
      const nextPartnerReservations = (Array.isArray(reservationsResponse.reservations) ? reservationsResponse.reservations : [])
        .map(mapPartnerReservation);
      const dashboardChanged = computePartnerDashboardSignature(partnerDashboard) !== computePartnerDashboardSignature(nextDashboard);
      const reservationsChanged = computePartnerReservationsSignature(partnerReservations) !== computePartnerReservationsSignature(nextPartnerReservations);
      partnerDashboard = nextDashboard;
      partnerReservations = nextPartnerReservations;
      partnerLedger = buildPartnerLedger(nextPartnerReservations);
      partnerContext = {
        restaurantId: nextDashboard.restaurantId,
        restaurantName: nextDashboard.restaurantName,
        address: nextDashboard.address
      };
      state.lastLiveSyncAt = Date.now();

      if (dashboardChanged) {
        addNotification("Partner dashboard updated", "Today's metrics were refreshed.", "partner");
      }
      if (reservationsChanged) {
        addNotification("Partner reservation update", "Reservations were refreshed.", "partner");
      }

      if (
        dashboardChanged ||
        reservationsChanged ||
        state.route === "partner_dashboard" ||
        state.route === "partner_reservations" ||
        state.route === "partner_ledger"
      ) {
        render();
      }
    } else {
      const [listingResponse, reservationResponse] = await Promise.all([apiGetListings(), apiGetReservations()]);
      const nextListings = (Array.isArray(listingResponse.listings) ? listingResponse.listings : []).map(mapListing);
      const nextReservations = (Array.isArray(reservationResponse.reservations) ? reservationResponse.reservations : []).map(mapReservation);
      const listingsChanged = computeListingsSignature(listings) !== computeListingsSignature(nextListings);
      const reservationsChanged = computeReservationsSignature(reservations) !== computeReservationsSignature(nextReservations);

      listings = nextListings;
      reservations = nextReservations;
      state.lastLiveSyncAt = Date.now();
      reschedulePickupReminders();

      if (listingsChanged) {
        addNotification("Listings updated", `Now showing ${nextListings.length} available boxes.`, "update");
      }
      if (reservationsChanged) {
        addNotification("Reservation update", "Your reservation status was refreshed.", "update");
      }

      if (
        listingsChanged ||
        reservationsChanged ||
        state.route === "home" ||
        state.route === "reservations" ||
        state.route === "support"
      ) {
        render();
      }
    }
  } catch {
    // Keep live polling resilient; manual refresh still shows full errors.
  } finally {
    liveSyncInFlight = false;
  }
}

function setSocketStatus(status) {
  state.socketStatus = status;
  if (
    state.route === "notifications" ||
    state.route === "home" ||
    state.route === "partner_dashboard" ||
    state.route === "partner_reservations"
  ) render();
}

function deriveWebSocketUrlFromApiBase() {
  try {
    const api = new URL(getApiBaseUrl());
    api.protocol = api.protocol === "https:" ? "wss:" : "ws:";
    api.pathname = "/ws";
    api.search = "";
    api.hash = "";
    return api.toString().replace(/\/+$/, "");
  } catch {
    return "";
  }
}

function getWebSocketUrl() {
  const stored = normalizeWebSocketUrl(localStorage.getItem(STORAGE.webSocketUrl) || "");
  if (stored) return stored;
  return deriveWebSocketUrlFromApiBase();
}

function setWebSocketUrl(value) {
  localStorage.setItem(STORAGE.webSocketUrl, normalizeWebSocketUrl(value));
}

function startLivePolling() {
  if (livePollTimerId || !authToken || isMockOtpModeEnabled() || !notificationPrefs.liveUpdates) return;
  livePollTimerId = window.setInterval(runLiveSync, LIVE_POLL_INTERVAL_MS);
}

function stopLivePolling() {
  if (!livePollTimerId) return;
  window.clearInterval(livePollTimerId);
  livePollTimerId = null;
}

function shouldUseWebSocket() {
  return Boolean(
    authToken &&
    !isMockOtpModeEnabled() &&
    notificationPrefs.liveUpdates &&
    notificationPrefs.webSocketUpdates &&
    typeof WebSocket !== "undefined"
  );
}

function scheduleLiveSocketReconnect() {
  if (liveSocketReconnectTimerId || liveSocketManuallyStopped) return;
  const delay = Math.min(LIVE_SOCKET_RETRY_MAX_MS, 1000 * (2 ** Math.min(liveSocketRetryCount, 5)));
  liveSocketRetryCount += 1;
  liveSocketReconnectTimerId = window.setTimeout(() => {
    liveSocketReconnectTimerId = null;
    connectLiveSocket();
  }, delay);
}

function notifySocketEvent(title, message) {
  const now = Date.now();
  if (now - lastSocketNotificationAt < 5000) return;
  lastSocketNotificationAt = now;
  addNotification(title, message, "socket");
}

function processSocketPayload(payload) {
  const eventType = String(payload?.type || payload?.event || "").toLowerCase();
  if (!eventType) return;
  if (eventType.includes("ping") || eventType.includes("heartbeat")) return;

  const listingRelated = eventType.includes("listing") || eventType.includes("availability");
  const reservationRelated = eventType.includes("reservation");

  if (listingRelated || reservationRelated) {
    runLiveSync();
  }

  if (payload?.message) {
    notifySocketEvent("Live event", String(payload.message));
    return;
  }

  if (listingRelated) {
    notifySocketEvent("Live listings event", "Listing availability changed on server.");
    return;
  }

  if (reservationRelated) {
    notifySocketEvent("Live reservation event", "Reservation status changed on server.");
  }
}

function connectLiveSocket() {
  if (!shouldUseWebSocket()) {
    if (typeof WebSocket === "undefined") setSocketStatus("unsupported");
    else if (!notificationPrefs.liveUpdates || isMockOtpModeEnabled()) setSocketStatus("disabled");
    else if (!notificationPrefs.webSocketUpdates) setSocketStatus("disabled");
    return;
  }

  const wsUrl = getWebSocketUrl();
  if (!wsUrl || (!wsUrl.startsWith("ws://") && !wsUrl.startsWith("wss://"))) {
    setSocketStatus("invalid_url");
    return;
  }

  if (liveSocket && (liveSocket.readyState === WebSocket.OPEN || liveSocket.readyState === WebSocket.CONNECTING)) {
    return;
  }

  liveSocketManuallyStopped = false;
  setSocketStatus("connecting");

  try {
    liveSocket = new WebSocket(wsUrl);
  } catch {
    setSocketStatus("error");
    scheduleLiveSocketReconnect();
    return;
  }

  liveSocket.onopen = () => {
    liveSocketRetryCount = 0;
    setSocketStatus("connected");
    notifySocketEvent("Live connection", "Connected to real-time updates.");
    if (authToken) {
      try {
        liveSocket.send(JSON.stringify({ type: "auth", token: authToken }));
      } catch {
        // Keep connection alive even if auth frame fails.
      }
    }
  };

  liveSocket.onmessage = (event) => {
    state.lastSocketEventAt = Date.now();
    let payload = null;
    try {
      payload = JSON.parse(event.data);
    } catch {
      payload = { type: "message", message: String(event.data || "") };
    }
    processSocketPayload(payload);
    if (state.route === "notifications" || state.route === "home") render();
  };

  liveSocket.onerror = () => {
    setSocketStatus("error");
  };

  liveSocket.onclose = () => {
    liveSocket = null;
    if (liveSocketManuallyStopped || !shouldUseWebSocket()) {
      setSocketStatus("disconnected");
      return;
    }
    setSocketStatus("reconnecting");
    scheduleLiveSocketReconnect();
  };
}

function stopLiveSocket() {
  liveSocketManuallyStopped = true;
  if (liveSocketReconnectTimerId) {
    window.clearTimeout(liveSocketReconnectTimerId);
    liveSocketReconnectTimerId = null;
  }
  if (!liveSocket) {
    setSocketStatus("disconnected");
    return;
  }
  const socketRef = liveSocket;
  liveSocket = null;
  try {
    socketRef.close(1000, "client-stop");
  } catch {
    // Ignore close errors.
  }
  setSocketStatus("disconnected");
}

function reconnectLiveSocket() {
  stopLiveSocket();
  liveSocketRetryCount = 0;
  connectLiveSocket();
}

function startLiveUpdates() {
  startLivePolling();
  connectLiveSocket();
}

function stopLiveUpdates() {
  stopLivePolling();
  stopLiveSocket();
}

function getApiBaseUrl() {
  const stored = normalizeApiBaseUrl(localStorage.getItem(STORAGE.apiBaseUrl) || "");
  if (stored) return stored;
  return normalizeApiBaseUrl(DEFAULT_API_BASE_URL);
}

function setApiBaseUrl(url) {
  localStorage.setItem(STORAGE.apiBaseUrl, normalizeApiBaseUrl(url));
}

function saveSession() {
  if (user) saveJSON(STORAGE.user, user);
  if (authToken) localStorage.setItem(STORAGE.token, authToken);
  localStorage.setItem(STORAGE.sessionRole, normalizeRole(user?.role || state.sessionRole));
  if (isPartnerSession() && partnerContext) {
    saveJSON(STORAGE.partnerContext, partnerContext);
  } else {
    partnerContext = null;
    localStorage.removeItem(STORAGE.partnerContext);
  }
}

function clearSession() {
  stopLiveUpdates();
  clearAllScheduledPickupReminders();
  user = null;
  authToken = "";
  partnerDashboard = null;
  partnerReservations = [];
  partnerListings = [];
  partnerLedger = null;
  partnerContext = null;
  adminPartners = [];
  adminPartnerEdits = {};
  adminPartnerNotes = {};
  state.sessionRole = "customer";
  state.loginMode = "customer";
  state.lastLiveSyncAt = 0;
  state.lastSocketEventAt = 0;
  localStorage.removeItem(STORAGE.user);
  localStorage.removeItem(STORAGE.token);
  localStorage.removeItem(STORAGE.sessionRole);
  localStorage.removeItem(STORAGE.partnerContext);
  resetSupportState();
}

function resetRuntimeData() {
  clearSession();
  reservations = [];
  listings = [];
  partnerDashboard = null;
  partnerReservations = [];
  partnerListings = [];
  partnerLedger = null;
  partnerContext = null;
  adminPartners = [];
  adminPartnerEdits = {};
  adminPartnerNotes = {};
  state.pendingPhone = "";
  state.verificationId = "";
  state.partnerListingDraft = createDefaultPartnerListingDraft();
  state.partnerApplicationDraft = createDefaultPartnerApplicationDraft();
}

function startBusy(text) {
  state.busy = true;
  state.busyText = text || "Please wait...";
  render();
}

function stopBusy() {
  state.busy = false;
  state.busyText = "";
  render();
}

function clearError() {
  state.errorMessage = "";
}

function setError(message) {
  state.errorMessage = message || "Something went wrong.";
  render();
}

function currency(amount) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0
  }).format(Number(amount || 0));
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatTime(timeValue) {
  if (!timeValue) return "";
  const [hRaw, mRaw] = String(timeValue).split(":");
  const h = Number(hRaw);
  const m = Number(mRaw || 0);
  if (Number.isNaN(h) || Number.isNaN(m)) return String(timeValue);
  const period = h >= 12 ? "PM" : "AM";
  const normalized = h % 12 || 12;
  return `${normalized}:${String(m).padStart(2, "0")} ${period}`;
}

function formatPickupSlot(dateValue, startTime, endTime) {
  const start = formatTime(startTime);
  const end = formatTime(endTime);
  if (start && end) return `${start}-${end}`;
  if (start) return start;
  if (dateValue) return String(dateValue);
  return "Today evening";
}

function mapListing(raw) {
  const restaurant = raw?.restaurant || {};
  const cuisineTypes = restaurant.cuisineTypes || [];
  const allergens = raw?.allergens || [];
  return {
    id: raw?.id,
    restaurant: restaurant.name || "Restaurant",
    cuisine: cuisineTypes,
    rating: Number(restaurant.averageRating || 0),
    reviews: Number(restaurant.totalRatings || 0),
    price: Number(raw?.price || 0),
    worth: Number(raw?.regularValue || 0),
    quantityAvailable: Number(raw?.quantityAvailable || 0),
    distanceKm: Number(restaurant.distance || 0),
    pickupSlot: formatPickupSlot(raw?.pickupDate, raw?.pickupStartTime, raw?.pickupEndTime),
    address: restaurant.address || "Address unavailable",
    inside: raw?.description || "Surprise assortment",
    allergens: allergens.join(", ") || "Not specified",
    pickupDate: raw?.pickupDate || "",
    pickupStartTime: raw?.pickupStartTime || "",
    pickupEndTime: raw?.pickupEndTime || ""
  };
}

function mapReservation(raw) {
  const listing = raw?.listing || {};
  const restaurantFromListing = listing?.restaurant || {};
  const restaurant = raw?.restaurant || restaurantFromListing || {};
  const pickupDate = listing?.pickupDate || raw?.pickupDate || "";
  const pickupStartTime = listing?.pickupStartTime || raw?.pickupStartTime || "";
  const pickupEndTime = listing?.pickupEndTime || raw?.pickupEndTime || "";
  const status = String(raw?.status || "pending").toLowerCase();
  const quantity = Number(raw?.quantity || raw?.reservedQuantity || 1);
  const payment = raw?.payment || raw?.paymentDetails || {};
  const fallbackAmount = Number(listing?.price || raw?.price || 0) * Math.max(1, quantity);
  return {
    id: raw?.id,
    code: raw?.code || raw?.reservationCode || raw?.reservation_code || "SB-0000",
    listingId: listing?.id || raw?.listingId || raw?.listing_id || null,
    quantity,
    restaurant: restaurant?.name || "Restaurant",
    address: restaurant?.address || "Address unavailable",
    price: Number(raw?.amount || payment?.amount || fallbackAmount),
    pickupSlot: formatPickupSlot(pickupDate, pickupStartTime, pickupEndTime),
    pickupDate,
    pickupStartTime,
    pickupEndTime,
    paymentMethod: normalizePaymentMethod(payment?.method || raw?.paymentMethod || raw?.payment_method),
    paymentStatus: normalizePaymentStatus(payment?.status || raw?.paymentStatus || raw?.payment_status),
    paymentReference: payment?.reference || raw?.paymentReference || raw?.payment_reference || "",
    paidAt: payment?.paidAt || raw?.paidAt || raw?.paymentPaidAt || "",
    createdAt: raw?.createdAt || new Date().toISOString(),
    status,
    canCancel: raw?.canCancel !== false && status !== "cancelled"
  };
}

async function apiRequest(path, options = {}) {
  const { method = "GET", body = null, tokenRequired = false, query = {} } = options;
  const base = getApiBaseUrl();
  const cleanBase = normalizeApiBaseUrl(base);
  if (!cleanBase || (!cleanBase.startsWith("http://") && !cleanBase.startsWith("https://"))) {
    throw new Error("Invalid API URL. Enter a full http:// or https:// URL.");
  }
  const url = new URL(`${cleanBase}${path}`);

  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, value);
    }
  });

  const headers = { "Content-Type": "application/json" };
  if (tokenRequired && authToken) {
    headers.Authorization = `Bearer ${authToken}`;
  }

  let response;
  try {
    response = await fetch(url.toString(), {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined
    });
  } catch (error) {
    const endpoint = `${url.origin}${url.pathname}`;
    const reason = error && error.message ? ` (${error.message})` : "";
    throw new Error(
      `Network error at ${endpoint}${reason}. If using local backend, use 10.0.2.2 instead of localhost.`
    );
  }

  let payload = {};
  try {
    payload = await response.json();
  } catch {
    payload = {};
  }

  if (!response.ok || payload.success === false) {
    if (response.status === 401) {
      clearSession();
      navigate("auth_phone");
      throw new Error("Session expired. Please login again.");
    }
    throw new Error(payload.message || `Request failed (${response.status})`);
  }

  return payload;
}

async function apiSendOtp(phone) {
  return apiRequest("/auth/send-otp", {
    method: "POST",
    body: { phone }
  });
}

async function apiVerifyOtp(phone, otp, verificationId) {
  return apiRequest("/auth/verify-otp", {
    method: "POST",
    body: { phone, otp, verificationId }
  });
}

async function apiGetListings() {
  const query = {
    lat: DEFAULT_LOCATION.lat,
    lon: DEFAULT_LOCATION.lon,
    radius: state.filters.radius,
    sortBy: state.filters.sortBy
  };
  if (state.filters.cuisine !== "all") {
    query.cuisine = state.filters.cuisine;
  }
  return apiRequest("/listings", { query, tokenRequired: true });
}

async function apiGetListingById(id) {
  return apiRequest(`/listings/${id}`, { tokenRequired: true });
}

async function apiCreateReservation(listingId, paymentMethod = DEFAULT_PAYMENT_METHOD) {
  const normalized = normalizePaymentMethod(paymentMethod);
  try {
    return await apiRequest("/reservations", {
      method: "POST",
      tokenRequired: true,
      body: { listingId, paymentMethod: normalized }
    });
  } catch (error) {
    const message = String(error?.message || "");
    if (!message.includes("(400)") && !message.includes("(422)") && !message.includes("(404)")) {
      throw error;
    }
    return apiRequest("/reservations", {
      method: "POST",
      tokenRequired: true,
      body: { listingId }
    });
  }
}

async function apiSubmitPartnerApplication(payload) {
  const attempts = [
    () => apiRequest("/partners/applications", { method: "POST", body: payload }),
    () => apiRequest("/partners/apply", { method: "POST", body: payload }),
    () => apiRequest("/partners/onboarding", { method: "POST", body: payload })
  ];
  let lastError = null;
  for (const attempt of attempts) {
    try {
      return await attempt();
    } catch (error) {
      lastError = error;
      if (!shouldTryPartnerFallback(error)) throw error;
    }
  }
  if (lastError) throw lastError;
}

async function apiRequestUploadUrl(payload) {
  return apiRequest("/uploads/presign", { method: "POST", body: payload });
}

async function uploadFileToPresignedUrl(url, file) {
  const response = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": file.type || "application/octet-stream" },
    body: file
  });
  if (!response.ok) {
    throw new Error(`Upload failed (${response.status})`);
  }
}

async function apiGetPartnerApplicationStatus() {
  const attempts = [
    () => apiRequest("/partners/applications/me", { tokenRequired: true }),
    () => apiRequest("/partners/application", { tokenRequired: true }),
    () => apiRequest("/partners/applications/status", { tokenRequired: true })
  ];
  let lastError = null;
  for (const attempt of attempts) {
    try {
      return await attempt();
    } catch (error) {
      lastError = error;
      if (!shouldTryPartnerFallback(error)) throw error;
    }
  }
  if (lastError) throw lastError;
}

async function apiGetReservations() {
  return apiRequest("/reservations", {
    tokenRequired: true,
    query: { page: 1, limit: 50 }
  });
}

async function apiCancelReservation(id) {
  return apiRequest(`/reservations/${id}/cancel`, {
    method: "PUT",
    tokenRequired: true
  });
}

async function apiSubmitReservationRating(reservationId, stars, comment = "") {
  const payload = {
    reservationId,
    stars: Number(stars || 0),
    comment: String(comment || "")
  };
  const attempts = [
    () => apiRequest(`/reservations/${reservationId}/rating`, { method: "POST", tokenRequired: true, body: payload }),
    () => apiRequest(`/reservations/${reservationId}/ratings`, { method: "POST", tokenRequired: true, body: payload }),
    () => apiRequest("/ratings", { method: "POST", tokenRequired: true, body: payload })
  ];
  for (const attempt of attempts) {
    try {
      return await attempt();
    } catch (error) {
      if (!shouldTryPartnerFallback(error)) throw error;
    }
  }
}

async function apiCreateSupportTicket(payload) {
  const attempts = [
    () => apiRequest("/support/tickets", { method: "POST", tokenRequired: true, body: payload }),
    () => apiRequest("/support/complaints", { method: "POST", tokenRequired: true, body: payload }),
    () => apiRequest("/complaints", { method: "POST", tokenRequired: true, body: payload })
  ];
  for (const attempt of attempts) {
    try {
      return await attempt();
    } catch (error) {
      if (!shouldTryPartnerFallback(error)) throw error;
    }
  }
}

async function apiGetSupportSummary() {
  const attempts = [
    () => apiRequest("/support/me", { tokenRequired: true }),
    () => apiRequest("/support/summary", { tokenRequired: true }),
    () => apiRequest("/support/tickets", { tokenRequired: true, query: { page: 1, limit: 20 } })
  ];
  for (const attempt of attempts) {
    try {
      return await attempt();
    } catch (error) {
      if (!shouldTryPartnerFallback(error)) throw error;
    }
  }
}

function shouldTryPartnerFallback(error) {
  const message = String(error?.message || "");
  return message.includes("(404)") || message.includes("(405)");
}

function getPartnerRestaurantId() {
  return partnerContext?.restaurantId || user?.restaurantId || null;
}

async function apiGetPartnerDashboard() {
  try {
    return await apiRequest("/partners/dashboard", { tokenRequired: true });
  } catch (error) {
    const restaurantId = getPartnerRestaurantId();
    if (!restaurantId || !shouldTryPartnerFallback(error)) throw error;
    return apiRequest(`/partners/${restaurantId}/dashboard`, { tokenRequired: true });
  }
}

async function apiGetPartnerReservations(status = "") {
  const query = { status, page: 1, limit: 100 };
  try {
    return await apiRequest("/partners/reservations", { tokenRequired: true, query });
  } catch (error) {
    const restaurantId = getPartnerRestaurantId();
    if (!restaurantId || !shouldTryPartnerFallback(error)) throw error;
    return apiRequest(`/partners/${restaurantId}/reservations`, { tokenRequired: true, query });
  }
}

async function apiCreatePartnerListing(payload) {
  try {
    return await apiRequest("/partners/listings", {
      method: "POST",
      tokenRequired: true,
      body: payload
    });
  } catch (error) {
    const restaurantId = getPartnerRestaurantId();
    if (!restaurantId || !shouldTryPartnerFallback(error)) throw error;
    return apiRequest(`/partners/${restaurantId}/listings`, {
      method: "POST",
      tokenRequired: true,
      body: payload
    });
  }
}

async function apiConfirmPartnerPickup(reservationId) {
  try {
    return await apiRequest(`/partners/reservations/${reservationId}/pickup`, {
      method: "PUT",
      tokenRequired: true
    });
  } catch (error) {
    const restaurantId = getPartnerRestaurantId();
    if (!restaurantId || !shouldTryPartnerFallback(error)) throw error;
    return apiRequest(`/partners/${restaurantId}/reservations/${reservationId}/pickup`, {
      method: "PUT",
      tokenRequired: true
    });
  }
}

async function apiGetAdminPartners() {
  return apiRequest("/admin/partners", { tokenRequired: true, query: { page: 1, limit: 50 } });
}

async function apiUpdateAdminPartnerStatus(partnerId, payload) {
  if (!partnerId) throw new Error("Partner ID missing.");
  return apiRequest(`/admin/partners/${partnerId}`, {
    method: "PUT",
    tokenRequired: true,
    body: payload
  });
}

async function apiGetPartnerLedger() {
  try {
    return await apiRequest("/partners/ledger", { tokenRequired: true, query: { range: "today" } });
  } catch (error) {
    const restaurantId = getPartnerRestaurantId();
    if (!restaurantId || !shouldTryPartnerFallback(error)) throw error;
    return apiRequest(`/partners/${restaurantId}/ledger`, { tokenRequired: true, query: { range: "today" } });
  }
}

async function apiUpdatePartnerReservationPayment(reservationId, paymentPayload) {
  const payload = {
    paymentMethod: normalizePaymentMethod(paymentPayload?.paymentMethod),
    paymentStatus: normalizePaymentStatus(paymentPayload?.paymentStatus || "paid"),
    paymentReference: String(paymentPayload?.paymentReference || "")
  };
  const canFallback = (error) => {
    const message = String(error?.message || "");
    return message.includes("(404)") || message.includes("(405)") || message.includes("(422)");
  };
  try {
    return await apiRequest(`/partners/reservations/${reservationId}/payment`, {
      method: "PUT",
      tokenRequired: true,
      body: payload
    });
  } catch (error) {
    const restaurantId = getPartnerRestaurantId();
    if (restaurantId && canFallback(error)) {
      return apiRequest(`/partners/${restaurantId}/reservations/${reservationId}/payment`, {
        method: "PUT",
        tokenRequired: true,
        body: payload
      });
    }
    if (canFallback(error)) {
      return apiRequest(`/reservations/${reservationId}/payment`, {
        method: "PUT",
        tokenRequired: true,
        body: payload
      });
    }
    throw error;
  }
}

async function apiSyncPushToken(token) {
  if (!token || !user?.id) return;
  const attempts = [
    () => apiRequest(`/users/${user.id}`, { method: "PUT", tokenRequired: true, body: { fcmToken: token } }),
    () => apiRequest(`/users/${user.id}`, { method: "PUT", tokenRequired: true, body: { fcm_token: token } }),
    () => apiRequest("/users/me", { method: "PUT", tokenRequired: true, body: { fcmToken: token } }),
    () => apiRequest("/users/push-token", { method: "POST", tokenRequired: true, body: { fcmToken: token } })
  ];

  let lastError = null;
  for (const attempt of attempts) {
    try {
      return await attempt();
    } catch (error) {
      lastError = error;
      if (!shouldTryPartnerFallback(error)) throw error;
    }
  }
  if (lastError) throw lastError;
}

async function apiSyncNotificationPreferences() {
  if (!user?.id) return;
  const payload = {
    notifications: {
      push: Boolean(notificationPrefs.liveUpdates),
      pickupReminders: Boolean(notificationPrefs.pickupReminders),
      whatsapp: Boolean(notificationPrefs.whatsappReminders)
    }
  };
  const attempts = [
    () => apiRequest(`/users/${user.id}`, { method: "PUT", tokenRequired: true, body: payload }),
    () => apiRequest("/users/me", { method: "PUT", tokenRequired: true, body: payload }),
    () => apiRequest("/users/preferences", { method: "PUT", tokenRequired: true, body: payload })
  ];

  let lastError = null;
  for (const attempt of attempts) {
    try {
      return await attempt();
    } catch (error) {
      lastError = error;
      if (!shouldTryPartnerFallback(error)) throw error;
    }
  }
  if (lastError) throw lastError;
}

async function apiEnableReservationReminderChannels(reservationId, channels) {
  if (!reservationId) return;
  const payload = { reservationId, ...channels };
  const attempts = [
    () => apiRequest(`/reservations/${reservationId}/reminders`, { method: "POST", tokenRequired: true, body: channels }),
    () => apiRequest(`/reservations/${reservationId}/reminder`, { method: "POST", tokenRequired: true, body: channels }),
    () => apiRequest("/notifications/reminders", { method: "POST", tokenRequired: true, body: payload })
  ];

  for (const attempt of attempts) {
    try {
      return await attempt();
    } catch (error) {
      if (!shouldTryPartnerFallback(error)) throw error;
    }
  }
}

function renderTopNav(title, subtitle) {
  return `
    <div class="top-nav">
      <div class="brand">${title}</div>
      <div class="subtitle">${subtitle}</div>
    </div>
  `;
}

function renderBottomNav(active) {
  if (!user) return "";
  const notificationLabel = notifications.length ? `Updates (${notifications.length})` : "Updates";
  return `
    <div class="bottom-nav">
      <button class="nav-btn ${active === "home" ? "active" : ""}" onclick="navigate('home')">Home</button>
      <button class="nav-btn ${active === "reservations" ? "active" : ""}" onclick="navigate('reservations')">My Reservations</button>
      <button class="nav-btn ${active === "support" ? "active" : ""}" onclick="navigate('support')">Support</button>
      <button class="nav-btn ${active === "notifications" ? "active" : ""}" onclick="navigate('notifications')">${notificationLabel}</button>
    </div>
  `;
}

function renderPartnerBottomNav(active) {
  if (!user) return "";
  const notificationLabel = notifications.length ? `Updates (${notifications.length})` : "Updates";
  return `
    <div class="bottom-nav">
      <button class="nav-btn ${active === "partner_dashboard" ? "active" : ""}" onclick="navigate('partner_dashboard')">Dashboard</button>
      <button class="nav-btn ${active === "partner_reservations" ? "active" : ""}" onclick="navigate('partner_reservations')">Reservations</button>
      <button class="nav-btn ${active === "partner_ledger" ? "active" : ""}" onclick="navigate('partner_ledger')">Ledger</button>
      <button class="nav-btn ${active === "notifications" ? "active" : ""}" onclick="navigate('notifications')">${notificationLabel}</button>
    </div>
  `;
}

function renderAdminBottomNav(active) {
  if (!user) return "";
  const notificationLabel = notifications.length ? `Updates (${notifications.length})` : "Updates";
  return `
    <div class="bottom-nav">
      <button class="nav-btn ${active === "admin_dashboard" ? "active" : ""}" onclick="navigate('admin_dashboard')">Admin</button>
      <button class="nav-btn ${active === "admin_partners" ? "active" : ""}" onclick="navigate('admin_partners')">Approvals</button>
      <button class="nav-btn ${active === "notifications" ? "active" : ""}" onclick="navigate('notifications')">${notificationLabel}</button>
    </div>
  `;
}

function renderStatusCard() {
  if (state.busy) {
    return `<div class="card muted">${escapeHtml(state.busyText)}</div>`;
  }
  if (state.errorMessage) {
    return `<div class="card" style="border:1px solid #fecaca;color:#991b1b;background:#fef2f2;">${escapeHtml(state.errorMessage)}</div>`;
  }
  return "";
}

function getFilteredListings() {
  let result = listings.filter((l) => l.quantityAvailable > 0);
  const radiusNum = Number(state.filters.radius);
  if (!Number.isNaN(radiusNum)) {
    result = result.filter((l) => l.distanceKm <= radiusNum);
  }
  if (state.filters.cuisine !== "all") {
    result = result.filter((l) => l.cuisine.some((c) => c.toLowerCase() === state.filters.cuisine));
  }
  if (state.filters.sortBy === "price") {
    result.sort((a, b) => a.price - b.price);
  } else if (state.filters.sortBy === "rating") {
    result.sort((a, b) => b.rating - a.rating);
  } else {
    result.sort((a, b) => a.distanceKm - b.distanceKm);
  }
  return result;
}

function renderOnboarding() {
  const slide = onboardingSlides[state.onboardingIndex];
  return `
    <div class="brand">SurpriseBox</div>
    <div class="card hero slide">
      <h2>${slide.title}</h2>
      <p>${slide.desc}</p>
      <div class="dot-row">
        ${onboardingSlides.map((_, i) => `<span class="dot ${i === state.onboardingIndex ? "active" : ""}"></span>`).join("")}
      </div>
    </div>
    <div class="row between" style="margin-top:12px;">
      <button class="btn btn-outline" onclick="skipOnboarding()">Skip</button>
      <button class="btn btn-primary" onclick="nextOnboarding()">${state.onboardingIndex === onboardingSlides.length - 1 ? "Start" : "Next"}</button>
    </div>
  `;
}

function renderPhoneAuth() {
  const mockEnabled = isMockOtpModeEnabled();
  const showToggle = shouldShowRoleToggle();
  const subtitle = showToggle
    ? (isPartnerLoginMode() ? "Partner login via phone OTP" : "Sign up with your phone number")
    : "Sign in with your phone number";
  const applicationStatus = partnerApplication ? formatApplicationStatus(partnerApplication.status) : "";
  return `
    ${renderTopNav("Welcome", subtitle)}
    ${renderStatusCard()}
    ${showToggle
      ? `
        <div class="card stack">
          <label class="muted">Login as (mock only)</label>
          <div class="row">
            <button class="btn ${state.loginMode === "customer" ? "btn-primary" : "btn-outline"} btn-block" onclick="setLoginMode('customer')">Customer</button>
            <button class="btn ${state.loginMode === "partner" ? "btn-primary" : "btn-outline"} btn-block" onclick="setLoginMode('partner')">Partner</button>
          </div>
          <div class="muted">${isPartnerLoginMode() ? "Use your registered restaurant phone number." : "Use your customer phone number."}</div>
        </div>
      `
      : `
        <div class="card muted">Your account type is determined after OTP verification and admin approval.</div>
      `}
    <div class="card stack">
      <label class="muted">Phone number</label>
      <input id="phone" type="tel" placeholder="+91 9876543210" value="${escapeHtml(state.pendingPhone)}" />
      <button class="btn btn-primary btn-block" onclick="sendOtp()">Send OTP</button>
    </div>
    <div class="card stack">
      <div class="section-title" style="margin:0;">Partner onboarding</div>
      <div class="muted">Restaurant owners can apply here. Approval required before partner access.</div>
      ${partnerApplication
        ? `
          <div class="value-line"><span>Status</span><strong>${escapeHtml(applicationStatus)}</strong></div>
          <button class="btn btn-outline btn-block" onclick="navigate('partner_apply_status')">View Application</button>
        `
        : `
          <button class="btn btn-outline btn-block" onclick="navigate('partner_apply')">Apply as Partner</button>
        `}
    </div>
    <div class="card stack">
      <label class="muted">Backend API Base URL</label>
      <input id="api-base-url" type="url" value="${escapeHtml(getApiBaseUrl())}" />
      <div class="muted">For emulator + local backend, use http://10.0.2.2:&lt;port&gt;/v1</div>
      <button class="btn btn-outline btn-block" onclick="saveApiBaseUrl()">Save API URL</button>
    </div>
    <div class="card stack">
      <label class="muted">Offline Mock OTP Mode</label>
      <button class="btn btn-outline btn-block" onclick="toggleMockOtpMode()">${mockEnabled ? "Disable Mock OTP" : "Enable Mock OTP"}</button>
      <div class="muted">For testing without backend. OTP code is ${MOCK_OTP_CODE}.</div>
    </div>
  `;
}

function renderOtp() {
  const mockBanner = isMockOtpModeEnabled()
    ? `<div class="card muted">Mock OTP mode enabled. Enter OTP ${MOCK_OTP_CODE}.</div>`
    : "";
  return `
    ${renderTopNav("Verify OTP", `Number: ${escapeHtml(state.pendingPhone)}`)}
    ${renderStatusCard()}
    ${mockBanner}
    <div class="card stack">
      <label class="muted">Enter 6-digit OTP</label>
      <input id="otp" type="number" placeholder="123456" />
      <button class="btn btn-primary btn-block" onclick="verifyOtp()">Verify & Continue</button>
      <button class="btn btn-outline btn-block" onclick="navigate('auth_phone')">Change Number</button>
    </div>
  `;
}

function renderHome() {
  const available = getFilteredListings();
  const cuisines = ["all", "italian", "fast food", "bakery", "desserts", "indian", "snacks"];
  return `
    ${renderTopNav(`Hi ${escapeHtml(user?.name || "there")}!`, `${available.length} boxes available near Vidyanagar`)}
    ${renderStatusCard()}
    <div class="card stack">
      <div class="value-line">
        <span>Live updates</span>
        <strong>${escapeHtml(getLiveSyncLabel())}</strong>
      </div>
      <div class="value-line">
        <span>WebSocket</span>
        <strong>${escapeHtml(getSocketStatusLabel())}</strong>
      </div>
      <button class="btn btn-outline btn-block" onclick="navigate('notifications')">Notification Settings</button>
      <button class="btn btn-outline btn-block" onclick="signOut()">Switch Account</button>
    </div>
    <div class="card stack">
      <div class="row">
        <div style="flex:1;">
          <label class="muted">Radius</label>
          <select onchange="updateFilter('radius', this.value)">
            <option value="1" ${state.filters.radius === "1" ? "selected" : ""}>1 km</option>
            <option value="2" ${state.filters.radius === "2" ? "selected" : ""}>2 km</option>
            <option value="5" ${state.filters.radius === "5" ? "selected" : ""}>5 km</option>
          </select>
        </div>
        <div style="flex:1;">
          <label class="muted">Sort</label>
          <select onchange="updateFilter('sortBy', this.value)">
            <option value="distance" ${state.filters.sortBy === "distance" ? "selected" : ""}>Nearest</option>
            <option value="price" ${state.filters.sortBy === "price" ? "selected" : ""}>Price</option>
            <option value="rating" ${state.filters.sortBy === "rating" ? "selected" : ""}>Rating</option>
          </select>
        </div>
      </div>
      <div>
        <label class="muted">Cuisine</label>
        <select onchange="updateFilter('cuisine', this.value)">
          ${cuisines.map((c) => `<option value="${c}" ${state.filters.cuisine === c ? "selected" : ""}>${c === "all" ? "All" : c}</option>`).join("")}
        </select>
      </div>
      <button class="btn btn-outline btn-block" onclick="refreshListings()">Refresh Listings</button>
    </div>

    <div class="section-title">Available Surprise Boxes</div>
    ${available.length === 0 && !state.busy ? `<div class="card muted">No boxes found for selected filters.</div>` : ""}
    ${available.map((box) => `
      <div class="card box-card">
        <div class="row between">
          <h3>${escapeHtml(box.restaurant)}</h3>
          <span>${box.rating.toFixed(1)}⭐</span>
        </div>
        <div class="muted">${box.distanceKm.toFixed(1)} km away • Pickup ${escapeHtml(box.pickupSlot)}</div>
        <div class="row between" style="margin-top:10px;">
          <div class="price">Surprise Box - ${currency(box.price)}</div>
          <div class="worth">Worth ${currency(box.worth)}+</div>
        </div>
        <div class="muted" style="margin-top:6px;">${box.quantityAvailable} boxes left</div>
        <div style="margin-top:8px;">
          ${box.cuisine.map((c) => `<span class="pill">${escapeHtml(c)}</span>`).join("")}
        </div>
        <button class="btn btn-primary btn-block" style="margin-top:12px;" onclick="openDetails(${box.id})">View Details</button>
      </div>
    `).join("")}
    ${renderBottomNav("home")}
  `;
}

function renderDetails() {
  const box = state.activeListing || listings.find((x) => x.id === state.activeListingId);
  if (!box) {
    return `
      ${renderTopNav("Listing", "Details")}
      ${renderStatusCard()}
      <div class="card muted">Listing not found.</div>
      ${renderBottomNav("home")}
    `;
  }
  return `
    ${renderTopNav(escapeHtml(box.restaurant), `${box.rating.toFixed(1)}⭐ (${box.reviews} reviews)`)}
    ${renderStatusCard()}
    <div class="card stack">
      <div class="value-line"><span>Price</span><strong>${currency(box.price)}</strong></div>
      <div class="value-line"><span>Regular value</span><span>${currency(box.worth)}+</span></div>
      <div class="value-line"><span>You save</span><strong>${currency(box.worth - box.price)}+</strong></div>
      <div>
        <div class="muted">What might be inside?</div>
        <div>${escapeHtml(box.inside)}</div>
      </div>
      <div class="muted">Allergens: ${escapeHtml(box.allergens)}</div>
      <div class="muted">Pickup: ${escapeHtml(box.pickupSlot)}</div>
      <div class="muted">${escapeHtml(box.address)}</div>
      <button class="btn btn-outline btn-block" onclick="openMap(${box.id})">Get Directions</button>
      <button class="btn btn-primary btn-block" onclick="openReserveSheet()">Reserve for ${currency(box.price)}</button>
      <button class="btn btn-outline btn-block" onclick="navigate('home')">Back to Home</button>
    </div>
    ${renderBottomNav("home")}
  `;
}

function renderReservationSuccess() {
  const reservation = reservations.find((r) => r.id === state.lastReservationId) || reservations[0];
  if (!reservation) {
    return `
      ${renderTopNav("Reservation", "Status")}
      <div class="card muted">No reservation found.</div>
      ${renderBottomNav("reservations")}
    `;
  }
  return `
    ${renderTopNav("Reservation Confirmed", "Show this code at pickup")}
    ${renderStatusCard()}
    <div class="card">
      <div class="success-badge">✓</div>
      <div class="stack">
        <div class="value-line"><span>Code</span><strong>${escapeHtml(reservation.code)}</strong></div>
        <div class="value-line"><span>Restaurant</span><strong>${escapeHtml(reservation.restaurant)}</strong></div>
        <div class="value-line"><span>Pickup</span><strong>${escapeHtml(reservation.pickupSlot)}</strong></div>
        <div class="value-line"><span>Payment</span><strong>${formatPaymentMethod(reservation.paymentMethod)} · ${formatPaymentStatus(reservation.paymentStatus)}</strong></div>
        <div class="value-line"><span>Amount</span><strong>${currency(reservation.price)}</strong></div>
        <div class="muted">${escapeHtml(reservation.address)}</div>
      </div>
      <div class="stack" style="margin-top:12px;">
        <button class="btn btn-primary btn-block" onclick="navigate('reservations')">View My Reservations</button>
        <button class="btn btn-outline btn-block" onclick="navigate('home')">Reserve Another Box</button>
      </div>
    </div>
    ${renderBottomNav("reservations")}
  `;
}

function renderReservations() {
  const active = reservations.filter((r) => isActiveReservationStatus(r.status));
  const past = reservations.filter((r) => !isActiveReservationStatus(r.status));

  return `
    ${renderTopNav("My Reservations", `${active.length} active • ${past.length} past`)}
    ${renderStatusCard()}
    <div class="card stack">
      <div class="value-line">
        <span>Pickup reminders</span>
        <strong>${notificationPrefs.pickupReminders ? "On" : "Off"}</strong>
      </div>
      <div class="value-line">
        <span>Support credits</span>
        <strong>${currency(supportCredits)}</strong>
      </div>
      <button class="btn btn-outline btn-block" onclick="navigate('notifications')">Manage Notification Settings</button>
      <button class="btn btn-outline btn-block" onclick="navigate('support')">Ratings & Support</button>
      <button class="btn btn-outline btn-block" onclick="signOut()">Switch Account</button>
    </div>
    <div class="section-title">Active</div>
    ${active.length === 0 && !state.busy ? `<div class="card muted">No active reservations.</div>` : ""}
    ${active.map((r) => `
      <div class="card stack">
        <div class="value-line"><span>${escapeHtml(r.restaurant)}</span><strong>${escapeHtml(r.code)}</strong></div>
        <div class="muted">Pickup: ${escapeHtml(r.pickupSlot)}</div>
        <div class="muted">${escapeHtml(r.address)}</div>
        <div class="muted">Status: ${escapeHtml(r.status)}</div>
        <div class="value-line"><span>Payment</span><strong>${formatPaymentMethod(r.paymentMethod)} · ${formatPaymentStatus(r.paymentStatus)}</strong></div>
        <div class="value-line"><span>Amount</span><strong>${currency(r.price)}</strong></div>
        <button class="btn btn-outline btn-block" onclick="cancelReservation(${r.id})" ${r.canCancel ? "" : "disabled"}>Cancel Reservation</button>
      </div>
    `).join("")}

    <div class="section-title">Past</div>
    ${past.length === 0 && !state.busy ? `<div class="card muted">No past reservations.</div>` : ""}
    ${past.map((r) => `
      <div class="card stack">
        <div class="value-line"><span>${escapeHtml(r.restaurant)}</span><strong>${escapeHtml(r.status)}</strong></div>
        <div class="muted">${escapeHtml(r.code)} • ${new Date(r.createdAt).toLocaleString()}</div>
        <div class="muted">Payment: ${formatPaymentMethod(r.paymentMethod)} · ${formatPaymentStatus(r.paymentStatus)}</div>
      </div>
    `).join("")}
    ${renderBottomNav("reservations")}
  `;
}

function renderSupport() {
  const rateableReservations = reservations.filter((item) => isReservationRateable(item));
  const recentTickets = supportTickets
    .slice()
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 10);

  return `
    ${renderTopNav("Support & Ratings", "Rate pickups, raise complaints, track credits")}
    ${renderStatusCard()}
    <div class="card stack">
      <div class="value-line"><span>Rated reservations</span><strong>${countRatedReservations()}</strong></div>
      <div class="value-line"><span>Open tickets</span><strong>${supportTickets.filter((t) => t.status !== "resolved").length}</strong></div>
      <div class="value-line"><span>Credits balance</span><strong>${currency(supportCredits)}</strong></div>
      <button class="btn btn-outline btn-block" onclick="refreshSupportData()">Refresh Support Data</button>
    </div>
    <div class="section-title">Rate Your Pickups</div>
    ${rateableReservations.length === 0 ? `<div class="card muted">No completed pickups available for rating yet.</div>` : ""}
    ${rateableReservations.map((reservation) => {
      const rating = getReservationRating(reservation.id);
      const stars = Number(rating?.stars || 0);
      return `
        <div class="card stack">
          <div class="value-line"><span>${escapeHtml(reservation.restaurant)}</span><strong>${escapeHtml(reservation.code)}</strong></div>
          <div class="muted">${escapeHtml(reservation.pickupSlot)}</div>
          <div class="value-line"><span>Current rating</span><strong>${stars ? `${renderStars(stars)} (${stars}/5)` : "Not rated"}</strong></div>
          <div class="row">
            <button class="btn btn-outline btn-block" onclick='submitReservationRating(${JSON.stringify(reservation.id)}, 3)'>3★</button>
            <button class="btn btn-outline btn-block" onclick='submitReservationRating(${JSON.stringify(reservation.id)}, 4)'>4★</button>
            <button class="btn btn-outline btn-block" onclick='submitReservationRating(${JSON.stringify(reservation.id)}, 5)'>5★</button>
          </div>
        </div>
      `;
    }).join("")}
    <div class="section-title">Raise Complaint / Refund</div>
    <div class="card stack">
      <label class="muted">Reservation</label>
      <select id="support-reservation-id">
        <option value="">Select reservation</option>
        ${reservations.map((item) => `<option value="${item.id}">${escapeHtml(item.code)} · ${escapeHtml(item.restaurant)}</option>`).join("")}
      </select>
      <label class="muted">Issue details</label>
      <textarea id="support-message" rows="3" style="width:100%;border:1px solid #d1d5db;border-radius:12px;padding:11px;font-size:0.95rem;" placeholder="Describe the issue..."></textarea>
      <label class="row" style="align-items:center;">
        <input id="support-refund" type="checkbox" style="width:auto;" />
        <span class="muted">Request credit/refund</span>
      </label>
      <button class="btn btn-primary btn-block" onclick="submitSupportTicket()">Submit Complaint</button>
    </div>
    <div class="section-title">Recent Tickets</div>
    ${recentTickets.length === 0 ? `<div class="card muted">No support tickets yet.</div>` : ""}
    ${recentTickets.map((ticket) => `
      <div class="card stack">
        <div class="value-line"><span>${escapeHtml(ticket.code || `T-${ticket.id}`)}</span><strong>${escapeHtml(ticket.status || "open")}</strong></div>
        <div class="muted">${escapeHtml(ticket.message || "")}</div>
        <div class="muted">${ticket.refundRequested ? "Refund requested" : "No refund requested"}${ticket.creditIssued ? ` · Credit: ${currency(ticket.creditIssued)}` : ""}</div>
        <div class="muted">${new Date(ticket.createdAt).toLocaleString()}</div>
      </div>
    `).join("")}
    ${renderBottomNav("support")}
  `;
}

function renderPartnerApplication() {
  const draft = state.partnerApplicationDraft;
  return `
    ${renderTopNav("Partner Application", "Submit your restaurant details")}
    ${renderStatusCard()}
    <div class="card stack">
      <label class="muted">Restaurant name</label>
      <input type="text" value="${escapeHtml(draft.restaurantName)}" onchange="updatePartnerApplicationDraft('restaurantName', this.value)" />
      <label class="muted">Owner name</label>
      <input type="text" value="${escapeHtml(draft.ownerName)}" onchange="updatePartnerApplicationDraft('ownerName', this.value)" />
      <label class="muted">Phone</label>
      <input type="tel" value="${escapeHtml(draft.phone)}" onchange="updatePartnerApplicationDraft('phone', this.value)" />
      <label class="muted">Email (optional)</label>
      <input type="email" value="${escapeHtml(draft.email)}" onchange="updatePartnerApplicationDraft('email', this.value)" />
      <label class="muted">Address</label>
      <textarea rows="3" style="width:100%;border:1px solid #d1d5db;border-radius:12px;padding:11px;font-size:0.95rem;" onchange="updatePartnerApplicationDraft('address', this.value)">${escapeHtml(draft.address)}</textarea>
      <label class="muted">City / Zone</label>
      <input type="text" value="${escapeHtml(draft.city)}" onchange="updatePartnerApplicationDraft('city', this.value)" />
      <label class="muted">FSSAI (optional)</label>
      <input type="text" value="${escapeHtml(draft.fssai)}" onchange="updatePartnerApplicationDraft('fssai', this.value)" />
      <label class="muted">Payout UPI (optional)</label>
      <input type="text" value="${escapeHtml(draft.payoutUpi)}" onchange="updatePartnerApplicationDraft('payoutUpi', this.value)" />
      <label class="muted">Upload documents</label>
      <select id="partner-doc-type">
        ${["fssai", "gst", "shop_photo", "menu", "other"].map((type) => `
          <option value="${type}">${type.replaceAll("_", " ")}</option>
        `).join("")}
      </select>
      <input type="file" accept="image/*,application/pdf" onchange="handlePartnerDocumentUpload(this)" />
      ${Array.isArray(draft.documents) && draft.documents.length > 0 ? `
        <div class="card" style="margin:0;">
          ${draft.documents.map((doc, index) => `
            <div class="value-line">
              <span>${escapeHtml(doc.type)} • ${escapeHtml(doc.name)}</span>
              <button class="btn btn-outline" onclick="removePartnerDocument(${index})">Remove</button>
            </div>
          `).join("")}
        </div>
      ` : `<div class="muted">No documents uploaded yet.</div>`}
      <button class="btn btn-primary btn-block" onclick="submitPartnerApplication()">Submit Application</button>
      <button class="btn btn-outline btn-block" onclick="navigate('auth_phone')">Back to Login</button>
    </div>
  `;
}

function renderPartnerApplicationStatus() {
  if (!partnerApplication) {
    return `
      ${renderTopNav("Partner Application", "No application found")}
      <div class="card muted">No partner application submitted yet.</div>
      <button class="btn btn-outline btn-block" onclick="navigate('partner_apply')">Apply as Partner</button>
      <button class="btn btn-outline btn-block" onclick="navigate('auth_phone')">Back to Login</button>
    `;
  }
  return `
    ${renderTopNav("Partner Application", "Application status")}
    ${renderStatusCard()}
    <div class="card stack">
      <div class="value-line"><span>Restaurant</span><strong>${escapeHtml(partnerApplication.restaurantName)}</strong></div>
      <div class="value-line"><span>Status</span><strong>${escapeHtml(formatApplicationStatus(partnerApplication.status))}</strong></div>
      <div class="muted">${escapeHtml(partnerApplication.address || "")}</div>
      <div class="muted">Submitted: ${new Date(partnerApplication.createdAt).toLocaleString()}</div>
      <button class="btn btn-outline btn-block" onclick="navigate('auth_phone')">Back to Login</button>
    </div>
  `;
}

function renderAdminDashboard() {
  const summary = computeAdminSummary(adminPartners);
  return `
    ${renderTopNav("Admin Console", "Partner approvals and operations")}
    ${renderStatusCard()}
    <div class="card stack">
      <div class="value-line"><span>Submitted</span><strong>${summary.submitted}</strong></div>
      <div class="value-line"><span>Under review</span><strong>${summary.under_review}</strong></div>
      <div class="value-line"><span>Approved</span><strong>${summary.approved}</strong></div>
      <div class="value-line"><span>Live</span><strong>${summary.live}</strong></div>
      <div class="value-line"><span>Suspended</span><strong>${summary.suspended}</strong></div>
      <button class="btn btn-outline btn-block" onclick="navigate('admin_partners')">Review Partner Applications</button>
      <button class="btn btn-outline btn-block" onclick="refreshAdminPartners()">Refresh Admin Data</button>
    </div>
    ${renderAdminBottomNav("admin_dashboard")}
  `;
}

function renderAdminPartners() {
  const partners = adminPartners.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return `
    ${renderTopNav("Partner Approvals", "Review and approve new partners")}
    ${renderStatusCard()}
    ${partners.length === 0 ? `<div class="card muted">No partner applications yet.</div>` : ""}
    ${partners.map((partner) => {
      const edit = getAdminPartnerEdit(partner.id);
      const commissionValue = edit && edit.commissionRate !== ""
        ? edit.commissionRate
        : Math.round((partner.commissionRate || 0) * 100);
      const payoutValue = edit && edit.payoutCycle !== "" ? edit.payoutCycle : partner.payoutCycle;
      const zoneValue = edit && edit.zone !== "" ? edit.zone : partner.zone;
      const noteValue = adminPartnerNotes[partner.id] !== undefined
        ? adminPartnerNotes[partner.id]
        : (partner.reviewNotes || "");
      return `
      <div class="card stack">
        <div class="value-line"><span>${escapeHtml(partner.restaurantName)}</span><strong>${escapeHtml(partner.status)}</strong></div>
        <div class="muted">${escapeHtml(partner.address)}</div>
        <div class="muted">Phone: ${escapeHtml(partner.phone)}</div>
        <label class="muted">Commission %</label>
        <input type="number" min="0" max="50" value="${escapeHtml(commissionValue)}" onchange="updateAdminPartnerEdit('${escapeHtml(partner.id)}', 'commissionRate', this.value)" />
        <label class="muted">Payout cycle</label>
        <select onchange="updateAdminPartnerEdit('${escapeHtml(partner.id)}', 'payoutCycle', this.value)">
          ${["daily", "weekly", "biweekly", "monthly"].map((cycle) => `
            <option value="${cycle}" ${String(payoutValue || "").toLowerCase() === cycle ? "selected" : ""}>${cycle}</option>
          `).join("")}
        </select>
        <label class="muted">Zone</label>
        <input type="text" value="${escapeHtml(zoneValue || "")}" onchange="updateAdminPartnerEdit('${escapeHtml(partner.id)}', 'zone', this.value)" />
        <label class="muted">Review notes</label>
        <textarea rows="2" style="width:100%;border:1px solid #d1d5db;border-radius:12px;padding:11px;font-size:0.95rem;" onchange="updateAdminPartnerNote('${escapeHtml(partner.id)}', this.value)">${escapeHtml(noteValue)}</textarea>
        ${Array.isArray(partner.statusHistory) && partner.statusHistory.length > 0 ? `
          <div class="card muted" style="margin:0;">
            ${partner.statusHistory.map((entry) => `
              <div class="value-line">
                <span>${escapeHtml(entry.status || "")}</span>
                <span class="muted">${escapeHtml(entry.at || entry.createdAt || "")}</span>
              </div>
            `).join("")}
          </div>
        ` : ""}
        <div class="row">
          <button class="btn btn-outline btn-block" onclick='updateAdminPartnerStatus(${JSON.stringify(partner.id)}, "approved")' ${partner.status === "approved" || partner.status === "live" ? "disabled" : ""}>Approve</button>
          <button class="btn btn-outline btn-block" onclick='updateAdminPartnerStatus(${JSON.stringify(partner.id)}, "rejected")' ${partner.status === "rejected" ? "disabled" : ""}>Reject</button>
        </div>
        <div class="row">
          <button class="btn btn-outline btn-block" onclick='updateAdminPartnerStatus(${JSON.stringify(partner.id)}, "live")' ${partner.status === "live" ? "disabled" : ""}>Set Live</button>
          <button class="btn btn-outline btn-block" onclick='updateAdminPartnerStatus(${JSON.stringify(partner.id)}, "suspended")' ${partner.status === "suspended" ? "disabled" : ""}>Suspend</button>
        </div>
      </div>
    `;
    }).join("")}
    ${renderAdminBottomNav("admin_partners")}
  `;
}

function renderPartnerDashboard() {
  const summary = partnerDashboard || {
    restaurantName: "Partner Restaurant",
    address: "Address unavailable",
    boxesListed: 0,
    boxesSold: 0,
    pickedUp: 0,
    pending: 0,
    revenue: 0
  };
  const ledger = partnerLedger || buildPartnerLedger(partnerReservations);
  return `
    ${renderTopNav(`Partner: ${escapeHtml(summary.restaurantName)}`, escapeHtml(summary.address))}
    ${renderStatusCard()}
    <div class="card stack">
      <div class="section-title" style="margin:0;">Today's Summary</div>
      <div class="value-line"><span>Boxes listed</span><strong>${summary.boxesListed}</strong></div>
      <div class="value-line"><span>Boxes sold</span><strong>${summary.boxesSold}</strong></div>
      <div class="value-line"><span>Picked up</span><strong>${summary.pickedUp}</strong></div>
      <div class="value-line"><span>Pending</span><strong>${summary.pending}</strong></div>
      <div class="value-line"><span>Revenue</span><strong>${currency(summary.revenue)}</strong></div>
      <div class="value-line"><span>Est. Payout</span><strong>${currency(ledger.payout)}</strong></div>
    </div>
    <div class="card stack">
      <button class="btn btn-primary btn-block" onclick="navigate('partner_listing_create')">List Boxes For Today</button>
      <button class="btn btn-outline btn-block" onclick="navigate('partner_reservations')">View Active Reservations</button>
      <button class="btn btn-outline btn-block" onclick="navigate('partner_ledger')">View Ledger & Payouts</button>
      <button class="btn btn-outline btn-block" onclick="refreshPartnerDashboard()">Refresh Dashboard</button>
      <button class="btn btn-outline btn-block" onclick="signOut()">Switch Account</button>
    </div>
    ${partnerListings.length === 0 ? "" : `
      <div class="section-title">Recent Listed Boxes</div>
      ${partnerListings.map((item) => `
        <div class="card stack">
          <div class="value-line"><span>Quantity</span><strong>${item.quantity}</strong></div>
          <div class="value-line"><span>Price</span><strong>${currency(item.price)}</strong></div>
          <div class="muted">Pickup: ${escapeHtml(item.pickupSlot)}</div>
          <div class="muted">${escapeHtml(item.description || "No description")}</div>
        </div>
      `).join("")}
    `}
    ${renderPartnerBottomNav("partner_dashboard")}
  `;
}

function renderPartnerListingCreate() {
  const draft = state.partnerListingDraft;
  const quantity = Number(draft.quantity || 0);
  const price = Number(draft.price || 0);
  const payoutPerBox = Math.max(0, Math.round(price * 0.7));
  const potential = payoutPerBox * Math.max(0, quantity);
  return `
    ${renderTopNav("List Boxes", "Create today's partner listing")}
    ${renderStatusCard()}
    <div class="card stack">
      <label class="muted">How many boxes?</label>
      <input type="number" min="1" max="50" value="${escapeHtml(draft.quantity)}" onchange="updatePartnerListingDraft('quantity', this.value)" />
      <label class="muted">Price per box (INR)</label>
      <input type="number" min="1" value="${escapeHtml(draft.price)}" onchange="updatePartnerListingDraft('price', this.value)" />
      <div class="row">
        <div style="flex:1;">
          <label class="muted">Pickup start</label>
          <input type="time" value="${escapeHtml(draft.pickupStartTime)}" onchange="updatePartnerListingDraft('pickupStartTime', this.value)" />
        </div>
        <div style="flex:1;">
          <label class="muted">Pickup end</label>
          <input type="time" value="${escapeHtml(draft.pickupEndTime)}" onchange="updatePartnerListingDraft('pickupEndTime', this.value)" />
        </div>
      </div>
      <label class="muted">What might be inside? (optional)</label>
      <textarea id="partner-desc" rows="3" style="width:100%;border:1px solid #d1d5db;border-radius:12px;padding:11px;font-size:0.95rem;" oninput="updatePartnerListingDraft('description', this.value)">${escapeHtml(draft.description)}</textarea>
      <div class="card" style="margin:0;">
        <div class="value-line"><span>Preview</span><strong>${Math.max(0, quantity)} boxes • ${currency(price)}</strong></div>
        <div class="muted">Pickup: ${escapeHtml(formatPickupSlot("", draft.pickupStartTime, draft.pickupEndTime))}</div>
        <div class="muted">Estimated payout: ${currency(payoutPerBox)} per box, total ${currency(potential)}</div>
      </div>
      <button class="btn btn-primary btn-block" onclick="createPartnerListing()">List Boxes</button>
      <button class="btn btn-outline btn-block" onclick="navigate('partner_dashboard')">Back to Dashboard</button>
    </div>
    ${renderPartnerBottomNav("partner_dashboard")}
  `;
}

function renderPartnerReservations() {
  const active = partnerReservations.filter((r) => isActivePartnerReservationStatus(r.status));
  const past = partnerReservations.filter((r) => !isActivePartnerReservationStatus(r.status));
  return `
    ${renderTopNav("Partner Reservations", `${active.length} active • ${past.length} past`)}
    ${renderStatusCard()}
    <div class="card stack">
      <button class="btn btn-outline btn-block" onclick="refreshPartnerReservations()">Refresh Reservations</button>
      <button class="btn btn-outline btn-block" onclick="navigate('partner_listing_create')">List More Boxes</button>
      <button class="btn btn-outline btn-block" onclick="navigate('partner_ledger')">Open Ledger & Payouts</button>
      <button class="btn btn-outline btn-block" onclick="signOut()">Switch Account</button>
    </div>
    <div class="section-title">Active</div>
    ${active.length === 0 && !state.busy ? `<div class="card muted">No active reservations.</div>` : ""}
    ${active.map((r) => `
      <div class="card stack">
        <div class="value-line"><span>${escapeHtml(r.code)}</span><strong>${escapeHtml(r.status)}</strong></div>
        <div class="muted">Customer: ${escapeHtml(r.customerName)} ${r.customerPhone ? `• ${escapeHtml(r.customerPhone)}` : ""}</div>
        <div class="muted">Pickup: ${escapeHtml(r.pickupSlot)}</div>
        <div class="value-line"><span>Payment</span><strong>${formatPaymentMethod(r.paymentMethod)} · ${formatPaymentStatus(r.paymentStatus)}</strong></div>
        <div class="muted">Quantity: ${r.quantity} • Amount: ${currency(r.amount)}</div>
        <button class="btn btn-success btn-block" onclick='confirmPartnerPickup(${JSON.stringify(r.id)})' ${String(r.status).includes("picked") ? "disabled" : ""}>Confirm Pickup</button>
        ${isPaymentSettled(r.paymentStatus) ? "" : `
          <div class="row">
            <button class="btn btn-outline btn-block" onclick='markPartnerReservationPayment(${JSON.stringify(r.id)}, "cash")'>Cash Paid</button>
            <button class="btn btn-outline btn-block" onclick='markPartnerReservationPayment(${JSON.stringify(r.id)}, "upi")'>UPI Paid</button>
          </div>
        `}
      </div>
    `).join("")}
    <div class="section-title">Past</div>
    ${past.length === 0 && !state.busy ? `<div class="card muted">No past reservations.</div>` : ""}
    ${past.map((r) => `
      <div class="card stack">
        <div class="value-line"><span>${escapeHtml(r.code)}</span><strong>${escapeHtml(r.status)}</strong></div>
        <div class="muted">${escapeHtml(r.customerName)} • ${escapeHtml(r.pickupSlot)}</div>
        <div class="muted">Payment: ${formatPaymentMethod(r.paymentMethod)} · ${formatPaymentStatus(r.paymentStatus)}</div>
      </div>
    `).join("")}
    ${renderPartnerBottomNav("partner_reservations")}
  `;
}

function renderPartnerLedger() {
  const ledger = partnerLedger || buildPartnerLedger(partnerReservations);
  const rows = Array.isArray(ledger.settlements) ? ledger.settlements : [];
  return `
    ${renderTopNav("Partner Ledger", "Cash/UPI tracking and payout report")}
    ${renderStatusCard()}
    <div class="card stack">
      <div class="value-line"><span>Gross sales</span><strong>${currency(ledger.gross)}</strong></div>
      <div class="value-line"><span>Platform commission (30%)</span><strong>${currency(ledger.commission)}</strong></div>
      <div class="value-line"><span>Partner payout</span><strong>${currency(ledger.payout)}</strong></div>
      <div class="value-line"><span>Paid collections</span><strong>${currency(ledger.paidGross)}</strong></div>
      <div class="value-line"><span>Pending collections</span><strong>${currency(ledger.pendingGross)}</strong></div>
      <div class="value-line"><span>Cash paid</span><strong>${currency(ledger.cashPaid)}</strong></div>
      <div class="value-line"><span>UPI paid</span><strong>${currency(ledger.upiPaid)}</strong></div>
      <button class="btn btn-outline btn-block" onclick="refreshPartnerLedger()">Refresh Ledger</button>
      <button class="btn btn-outline btn-block" onclick="navigate('partner_reservations')">Back to Reservations</button>
    </div>
    <div class="section-title">Recent Settlements</div>
    ${rows.length === 0 ? `<div class="card muted">No payment records yet.</div>` : ""}
    ${rows.map((row) => `
      <div class="card stack">
        <div class="value-line"><span>${escapeHtml(row.code || "")}</span><strong>${currency(row.amount)}</strong></div>
        <div class="muted">${formatPaymentMethod(row.paymentMethod)} · ${formatPaymentStatus(row.paymentStatus)}</div>
        <div class="muted">${new Date(row.createdAt).toLocaleString()}</div>
      </div>
    `).join("")}
    ${renderPartnerBottomNav("partner_ledger")}
  `;
}

function renderNotifications() {
  return `
    ${renderTopNav("Updates & Notifications", "Live sync, reminders, and activity feed")}
    ${renderStatusCard()}
    <div class="card stack">
      <div class="value-line">
        <span>Live listing updates (30s)</span>
        <strong>${notificationPrefs.liveUpdates ? "On" : "Off"}</strong>
      </div>
      <button class="btn btn-outline btn-block" onclick="toggleNotificationPreference('liveUpdates')">
        ${notificationPrefs.liveUpdates ? "Turn Off Live Updates" : "Turn On Live Updates"}
      </button>
      <div class="value-line">
        <span>WebSocket live events</span>
        <strong>${notificationPrefs.webSocketUpdates ? "On" : "Off"}</strong>
      </div>
      <button class="btn btn-outline btn-block" onclick="toggleNotificationPreference('webSocketUpdates')">
        ${notificationPrefs.webSocketUpdates ? "Turn Off WebSocket Events" : "Turn On WebSocket Events"}
      </button>
      <div class="value-line">
        <span>Socket status</span>
        <strong>${escapeHtml(getSocketStatusLabel())}</strong>
      </div>
      <label class="muted">WebSocket URL</label>
      <input id="websocket-url" type="url" value="${escapeHtml(getWebSocketUrl())}" placeholder="wss://api.surprisebox.in/ws" />
      <button class="btn btn-outline btn-block" onclick="saveWebSocketUrl()">Save WebSocket URL</button>
      <button class="btn btn-outline btn-block" onclick="reconnectWebSocket()">Reconnect Socket</button>
      <div class="value-line">
        <span>Pickup reminders (1 hour prior)</span>
        <strong>${notificationPrefs.pickupReminders ? "On" : "Off"}</strong>
      </div>
      <button class="btn btn-outline btn-block" onclick="toggleNotificationPreference('pickupReminders')">
        ${notificationPrefs.pickupReminders ? "Turn Off Pickup Reminders" : "Turn On Pickup Reminders"}
      </button>
      <div class="value-line">
        <span>WhatsApp reminders</span>
        <strong>${notificationPrefs.whatsappReminders ? "On" : "Off"}</strong>
      </div>
      <button class="btn btn-outline btn-block" onclick="toggleNotificationPreference('whatsappReminders')">
        ${notificationPrefs.whatsappReminders ? "Turn Off WhatsApp Reminders" : "Turn On WhatsApp Reminders"}
      </button>
      <div class="value-line">
        <span>Push token</span>
        <strong>${pushToken ? "Available" : "Not available"}</strong>
      </div>
      <button class="btn btn-outline btn-block" onclick="requestNativePushToken()">Fetch Push Token</button>
      <button class="btn btn-outline btn-block" onclick="syncPushTokenWithBackend()">Sync Push Token</button>
      <div class="value-line">
        <span>Native notification permission</span>
        <strong>${escapeHtml(getNativeNotificationPermissionLabel())}</strong>
      </div>
      <button class="btn btn-outline btn-block" onclick="requestNativeNotificationPermission()" ${hasNativeReminderBridge() ? "" : "disabled"}>
        Request Notification Permission
      </button>
      <button class="btn btn-outline btn-block" onclick="clearNotifications()">Clear Activity Feed</button>
      <button class="btn btn-outline btn-block" onclick="signOut()">Sign Out</button>
    </div>

    <div class="section-title">Recent Activity</div>
    ${notifications.length === 0
      ? `<div class="card muted">${isPartnerSession() ? "No partner updates yet. List boxes or wait for live sync." : "No updates yet. Reserve a box or wait for live sync."}</div>`
      : ""}
    ${notifications.map((item) => `
      <div class="card stack">
        <div class="value-line"><strong>${escapeHtml(item.title)}</strong><span class="muted">${escapeHtml(formatRelativeTime(item.createdAt))}</span></div>
        <div>${escapeHtml(item.message)}</div>
      </div>
    `).join("")}
    ${isAdminSession()
      ? renderAdminBottomNav("notifications")
      : (isPartnerSession() ? renderPartnerBottomNav("notifications") : renderBottomNav("notifications"))}
  `;
}

function render() {
  const app = document.getElementById("app");
  if (!app) return;
  switch (state.route) {
    case "onboarding":
      app.innerHTML = renderOnboarding();
      break;
    case "auth_phone":
      app.innerHTML = renderPhoneAuth();
      break;
    case "auth_otp":
      app.innerHTML = renderOtp();
      break;
    case "details":
      app.innerHTML = renderDetails();
      break;
    case "reservation_success":
      app.innerHTML = renderReservationSuccess();
      break;
    case "reservations":
      app.innerHTML = renderReservations();
      break;
    case "support":
      app.innerHTML = renderSupport();
      break;
    case "partner_apply":
      app.innerHTML = renderPartnerApplication();
      break;
    case "partner_apply_status":
      app.innerHTML = renderPartnerApplicationStatus();
      break;
    case "admin_dashboard":
      app.innerHTML = renderAdminDashboard();
      break;
    case "admin_partners":
      app.innerHTML = renderAdminPartners();
      break;
    case "partner_dashboard":
      app.innerHTML = renderPartnerDashboard();
      break;
    case "partner_listing_create":
      app.innerHTML = renderPartnerListingCreate();
      break;
    case "partner_reservations":
      app.innerHTML = renderPartnerReservations();
      break;
    case "partner_ledger":
      app.innerHTML = renderPartnerLedger();
      break;
    case "notifications":
      app.innerHTML = renderNotifications();
      break;
    case "home":
    default:
      app.innerHTML = renderHome();
      break;
  }
}

function navigate(route, data = {}) {
  state.route = route;
  Object.assign(state, data);
  clearError();
  render();

  if (authToken && user && !isAdminSession()) startLiveUpdates();
  else stopLiveUpdates();

  if (route === "home") refreshListings();
  if (route === "reservations") refreshReservations();
  if (route === "support") refreshSupportData();
  if (route === "admin_dashboard") refreshAdminPartners();
  if (route === "admin_partners") refreshAdminPartners();
  if (route === "partner_dashboard") refreshPartnerDashboard();
  if (route === "partner_reservations") refreshPartnerReservations();
  if (route === "partner_ledger") refreshPartnerLedger();
  if (route === "notifications") runLiveSync();
  if (route === "details" && state.activeListingId) refreshListingDetails(state.activeListingId);
}

async function refreshListings() {
  if (!authToken) return;
  if (isMockOtpModeEnabled()) {
    seedMockData();
    state.lastLiveSyncAt = Date.now();
    clearError();
    render();
    return;
  }
  startBusy("Loading listings...");
  try {
    const response = await apiGetListings();
    const rawListings = Array.isArray(response.listings) ? response.listings : [];
    listings = rawListings.map(mapListing);
    state.lastLiveSyncAt = Date.now();
    clearError();
  } catch (error) {
    setError(`Could not load listings: ${error.message}`);
  } finally {
    stopBusy();
  }
}

async function refreshListingDetails(id) {
  if (isMockOtpModeEnabled()) {
    state.activeListing = listings.find((x) => x.id === id) || null;
    clearError();
    render();
    return;
  }
  startBusy("Loading listing details...");
  try {
    const response = await apiGetListingById(id);
    if (response.listing) {
      state.activeListing = mapListing(response.listing);
      const idx = listings.findIndex((x) => x.id === state.activeListing.id);
      if (idx >= 0) listings[idx] = state.activeListing;
      else listings.push(state.activeListing);
    }
    clearError();
  } catch (error) {
    setError(`Could not load listing details: ${error.message}`);
  } finally {
    stopBusy();
  }
}

async function refreshReservations() {
  if (!authToken) return;
  if (isMockOtpModeEnabled()) {
    reschedulePickupReminders();
    clearError();
    render();
    return;
  }
  startBusy("Loading reservations...");
  try {
    const response = await apiGetReservations();
    const rawReservations = Array.isArray(response.reservations) ? response.reservations : [];
    reservations = rawReservations.map(mapReservation);
    state.lastLiveSyncAt = Date.now();
    reschedulePickupReminders();
    clearError();
  } catch (error) {
    setError(`Could not load reservations: ${error.message}`);
  } finally {
    stopBusy();
  }
}

async function refreshSupportData(silent = false) {
  if (!authToken) return;
  if (isMockOtpModeEnabled()) {
    saveSupportState();
    clearError();
    render();
    return;
  }
  if (!silent) startBusy("Loading support data...");
  try {
    const response = await apiGetSupportSummary();
    const source = response?.support || response || {};
    const rawTickets = Array.isArray(source?.tickets)
      ? source.tickets
      : (Array.isArray(response?.tickets) ? response.tickets : []);
    supportTickets = rawTickets.map((ticket) => ({
      id: ticket?.id || Date.now() + Math.floor(Math.random() * 1000),
      code: ticket?.code || ticket?.ticketCode || "",
      reservationId: ticket?.reservationId || ticket?.reservation_id || "",
      message: ticket?.message || ticket?.description || "",
      status: String(ticket?.status || "open").toLowerCase(),
      refundRequested: Boolean(ticket?.refundRequested || ticket?.refund_request || ticket?.requestRefund),
      creditIssued: Number(ticket?.creditIssued || ticket?.credit || ticket?.refundAmount || 0),
      createdAt: ticket?.createdAt || new Date().toISOString()
    }));

    const creditValue = Number(source?.credits ?? source?.creditBalance ?? response?.credits ?? supportCredits);
    supportCredits = Number.isFinite(creditValue) ? creditValue : supportCredits;

    const rawRatings = source?.ratings || response?.ratings;
    if (rawRatings && typeof rawRatings === "object" && !Array.isArray(rawRatings)) {
      reservationRatings = Object.entries(rawRatings).reduce((acc, [reservationId, rating]) => {
        acc[String(reservationId)] = {
          stars: Number(rating?.stars || rating?.rating || 0),
          comment: String(rating?.comment || ""),
          updatedAt: rating?.updatedAt || rating?.createdAt || new Date().toISOString()
        };
        return acc;
      }, {});
    }

    saveSupportState();
    clearError();
  } catch (error) {
    setError(`Could not load support data: ${error.message}`);
  } finally {
    if (!silent) stopBusy();
    else render();
  }
}

async function refreshPartnerDashboard(silent = false) {
  if (!authToken) return;
  if (isMockOtpModeEnabled()) {
    seedMockPartnerData();
    partnerLedger = buildPartnerLedger(partnerReservations);
    state.lastLiveSyncAt = Date.now();
    clearError();
    render();
    return;
  }
  if (!silent) startBusy("Loading partner dashboard...");
  try {
    const response = await apiGetPartnerDashboard();
    const dashboard = mapPartnerDashboard(response.dashboard || response);
    partnerDashboard = dashboard;
    partnerContext = {
      restaurantId: dashboard.restaurantId,
      restaurantName: dashboard.restaurantName,
      address: dashboard.address
    };
    state.lastLiveSyncAt = Date.now();
    clearError();
  } catch (error) {
    setError(`Could not load partner dashboard: ${error.message}`);
  } finally {
    if (!silent) stopBusy();
    else render();
  }
}

async function refreshPartnerReservations(silent = false) {
  if (!authToken) return;
  if (isMockOtpModeEnabled()) {
    seedMockPartnerData();
    state.lastLiveSyncAt = Date.now();
    clearError();
    render();
    return;
  }
  if (!silent) startBusy("Loading partner reservations...");
  try {
    const response = await apiGetPartnerReservations();
    const rawReservations = Array.isArray(response.reservations) ? response.reservations : [];
    partnerReservations = rawReservations.map(mapPartnerReservation);
    partnerLedger = buildPartnerLedger(partnerReservations);
    state.lastLiveSyncAt = Date.now();
    clearError();
  } catch (error) {
    setError(`Could not load partner reservations: ${error.message}`);
  } finally {
    if (!silent) stopBusy();
    else render();
  }
}

async function refreshAdminPartners(silent = false) {
  if (!authToken) return;
  if (isMockOtpModeEnabled()) {
    seedMockAdminData();
    clearError();
    render();
    return;
  }
  if (!silent) startBusy("Loading partner applications...");
  try {
    const response = await apiGetAdminPartners();
    const rawPartners = Array.isArray(response.partners) ? response.partners : [];
    adminPartners = rawPartners.map(mapAdminPartner);
    clearError();
  } catch (error) {
    setError(`Could not load partner applications: ${error.message}`);
  } finally {
    if (!silent) stopBusy();
    else render();
  }
}

async function updateAdminPartnerStatus(partnerId, status) {
  const nextStatus = String(status || "").toLowerCase();
  if (!partnerId || !nextStatus) return;
  const current = adminPartners.find((partner) => partner.id === partnerId);
  const edit = getAdminPartnerEdit(partnerId);
  const commissionPercent = edit ? Number(edit.commissionRate) : Number.NaN;
  const note = adminPartnerNotes[partnerId] || current?.reviewNotes || "";
  const payload = { status: nextStatus, reviewNotes: note };
  if (!Number.isNaN(commissionPercent)) payload.commissionRate = commissionPercent / 100;
  else if (current && typeof current.commissionRate === "number") payload.commissionRate = current.commissionRate;
  if (edit && edit.payoutCycle) payload.payoutCycle = edit.payoutCycle;
  else if (current && current.payoutCycle) payload.payoutCycle = current.payoutCycle;
  if (edit && edit.zone) payload.zone = edit.zone;
  else if (current && current.zone) payload.zone = current.zone;
  if (isMockOtpModeEnabled()) {
    adminPartners = adminPartners.map((partner) => {
      if (partner.id !== partnerId) return partner;
      return {
        ...partner,
        status: nextStatus,
        commissionRate: payload.commissionRate ?? partner.commissionRate,
        payoutCycle: payload.payoutCycle ?? partner.payoutCycle,
        zone: payload.zone ?? partner.zone
      };
    });
    if (adminPartnerEdits[partnerId]) delete adminPartnerEdits[partnerId];
    if (adminPartnerNotes[partnerId]) delete adminPartnerNotes[partnerId];
    syncPartnerApplicationStatus(partnerId, nextStatus);
    addNotification("Partner status updated", `Partner ${partnerId} marked ${nextStatus}.`, "admin");
    clearError();
    render();
    return;
  }

  startBusy("Updating partner status...");
  try {
    await apiUpdateAdminPartnerStatus(partnerId, payload);
    await refreshAdminPartners(true);
    if (adminPartnerEdits[partnerId]) delete adminPartnerEdits[partnerId];
    if (adminPartnerNotes[partnerId]) delete adminPartnerNotes[partnerId];
    syncPartnerApplicationStatus(partnerId, nextStatus);
    addNotification("Partner status updated", `Partner ${partnerId} marked ${nextStatus}.`, "admin");
    clearError();
    render();
  } catch (error) {
    setError(`Partner update failed: ${error.message}`);
  } finally {
    stopBusy();
  }
}

async function refreshPartnerLedger(silent = false) {
  if (!authToken) return;
  if (isMockOtpModeEnabled()) {
    seedMockPartnerData();
    partnerLedger = buildPartnerLedger(partnerReservations);
    state.lastLiveSyncAt = Date.now();
    clearError();
    render();
    return;
  }
  if (!silent) startBusy("Loading payout ledger...");
  try {
    const response = await apiGetPartnerLedger();
    partnerLedger = mapPartnerLedger(response);
    state.lastLiveSyncAt = Date.now();
    clearError();
  } catch (error) {
    partnerLedger = buildPartnerLedger(partnerReservations);
    setError(`Could not load ledger: ${error.message}`);
  } finally {
    if (!silent) stopBusy();
    else render();
  }
}

function updatePartnerListingDraft(key, value) {
  state.partnerListingDraft[key] = value;
}

function updatePartnerApplicationDraft(key, value) {
  state.partnerApplicationDraft[key] = value;
}

async function uploadPartnerDocument(file, docType) {
  const payload = {
    fileName: file.name,
    contentType: file.type || "application/octet-stream",
    docType
  };
  const response = await apiRequestUploadUrl(payload);
  const uploadUrl = response.uploadUrl || response.url;
  const fileUrl = response.fileUrl || response.publicUrl || response.url;
  if (!uploadUrl || !fileUrl) throw new Error("Upload URL missing.");
  await uploadFileToPresignedUrl(uploadUrl, file);
  return {
    type: docType,
    name: file.name,
    size: file.size,
    url: fileUrl
  };
}

function syncPartnerApplicationStatus(partnerId, status) {
  if (!partnerApplication) return;
  const sameId = String(partnerApplication.id || "") === String(partnerId || "");
  if (!sameId) return;
  partnerApplication.status = String(status || partnerApplication.status || "submitted").toLowerCase();
  savePartnerApplication();
}

async function handlePartnerDocumentUpload(input) {
  const file = input?.files && input.files[0] ? input.files[0] : null;
  if (!file) return;
  const typeEl = document.getElementById("partner-doc-type");
  const docType = typeEl ? String(typeEl.value || "other") : "other";
  startBusy("Uploading document...");
  try {
    const uploaded = await uploadPartnerDocument(file, docType);
    const docs = Array.isArray(state.partnerApplicationDraft.documents)
      ? state.partnerApplicationDraft.documents.slice()
      : [];
    docs.push(uploaded);
    state.partnerApplicationDraft.documents = docs;
    if (input) input.value = "";
    clearError();
    render();
  } catch (error) {
    setError(`Upload failed: ${error.message}`);
  } finally {
    stopBusy();
  }
}

function removePartnerDocument(index) {
  const docs = Array.isArray(state.partnerApplicationDraft.documents)
    ? state.partnerApplicationDraft.documents.slice()
    : [];
  if (index < 0 || index >= docs.length) return;
  docs.splice(index, 1);
  state.partnerApplicationDraft.documents = docs;
  render();
}

async function refreshPartnerApplicationStatus(silent = false) {
  if (!authToken) return;
  if (isMockOtpModeEnabled()) {
    if (partnerApplication) savePartnerApplication();
    if (!silent) render();
    return;
  }
  if (!silent) startBusy("Checking partner application...");
  try {
    const response = await apiGetPartnerApplicationStatus();
    const application = response.application || response.partner || response || null;
    if (application) {
      partnerApplication = {
        id: application.id || partnerApplication?.id || "",
        status: application.status || partnerApplication?.status || "submitted",
        createdAt: application.createdAt || partnerApplication?.createdAt || new Date().toISOString(),
        restaurantName: application.restaurantName || partnerApplication?.restaurantName || "",
        ownerName: application.ownerName || partnerApplication?.ownerName || "",
        phone: application.phone || partnerApplication?.phone || "",
        email: application.email || partnerApplication?.email || "",
        address: application.address || partnerApplication?.address || "",
        city: application.city || partnerApplication?.city || "",
        fssai: application.fssai || partnerApplication?.fssai || "",
        payoutUpi: application.payoutUpi || partnerApplication?.payoutUpi || ""
      };
      savePartnerApplication();
    }
    clearError();
  } catch (error) {
    if (!silent) setError(`Could not load application status: ${error.message}`);
  } finally {
    if (!silent) stopBusy();
    else render();
  }
}

async function submitPartnerApplication() {
  const draft = state.partnerApplicationDraft;
  const payload = {
    restaurantName: String(draft.restaurantName || "").trim(),
    ownerName: String(draft.ownerName || "").trim(),
    phone: String(draft.phone || state.pendingPhone || "").trim(),
    email: String(draft.email || "").trim(),
    address: String(draft.address || "").trim(),
    city: String(draft.city || "").trim(),
    fssai: String(draft.fssai || "").trim(),
    payoutUpi: String(draft.payoutUpi || "").trim(),
    documents: Array.isArray(draft.documents)
      ? draft.documents.map((doc) => ({
          type: doc.type,
          name: doc.name,
          size: doc.size,
          url: doc.url
        }))
      : []
  };

  if (!payload.restaurantName || payload.restaurantName.length < 2) {
    setError("Enter a valid restaurant name.");
    return;
  }
  if (!payload.phone || payload.phone.length < 10) {
    setError("Enter a valid phone number.");
    return;
  }
  if (!payload.address || payload.address.length < 4) {
    setError("Enter a valid address.");
    return;
  }
  if (!payload.city || payload.city.length < 2) {
    setError("Enter a city/zone.");
    return;
  }

  if (isMockOtpModeEnabled()) {
    partnerApplication = {
      id: `APP-${String(Date.now()).slice(-5)}`,
      status: "submitted",
      createdAt: new Date().toISOString(),
      ...payload
    };
    savePartnerApplication();
    addNotification("Partner application submitted", "We will review and contact you shortly.", "partner");
    clearError();
    navigate("partner_apply_status");
    return;
  }

  startBusy("Submitting partner application...");
  try {
    const response = await apiSubmitPartnerApplication(payload);
    const application = response.application || response.partner || response || payload;
    partnerApplication = {
      id: application.id || `APP-${String(Date.now()).slice(-5)}`,
      status: application.status || "submitted",
      createdAt: application.createdAt || new Date().toISOString(),
      restaurantName: application.restaurantName || payload.restaurantName,
      ownerName: application.ownerName || payload.ownerName,
      phone: application.phone || payload.phone,
      email: application.email || payload.email,
      address: application.address || payload.address,
      city: application.city || payload.city,
      fssai: application.fssai || payload.fssai,
      payoutUpi: application.payoutUpi || payload.payoutUpi
    };
    savePartnerApplication();
    addNotification("Partner application submitted", "We will review and contact you shortly.", "partner");
    clearError();
    navigate("partner_apply_status");
  } catch (error) {
    setError(`Application failed: ${error.message}`);
  } finally {
    stopBusy();
  }
}

async function createPartnerListing() {
  const draft = state.partnerListingDraft;
  const quantity = Number(draft.quantity || 0);
  const price = Number(draft.price || 0);
  const pickupStart = String(draft.pickupStartTime || "").trim();
  const pickupEnd = String(draft.pickupEndTime || "").trim();
  if (!quantity || quantity < 1) {
    setError("Enter a valid box quantity.");
    return;
  }
  if (!price || price < 1) {
    setError("Enter a valid price.");
    return;
  }
  if (!pickupStart || !pickupEnd) {
    setError("Select pickup start and end time.");
    return;
  }

  const payload = {
    quantity,
    price,
    pickupStartTime: `${pickupStart}:00`,
    pickupEndTime: `${pickupEnd}:00`,
    description: String(draft.description || "").trim()
  };

  if (isMockOtpModeEnabled()) {
    seedMockPartnerData();
    partnerListings.unshift({
      id: Date.now(),
      quantity,
      price,
      pickupSlot: formatPickupSlot("", payload.pickupStartTime, payload.pickupEndTime),
      description: payload.description
    });
    partnerDashboard.boxesListed += quantity;
    partnerDashboard.pending += quantity;
    addNotification("Partner listing created", `${quantity} boxes listed at ${currency(price)} each.`, "partner");
    state.partnerListingDraft = createDefaultPartnerListingDraft();
    clearError();
    navigate("partner_dashboard");
    return;
  }

  startBusy("Creating partner listing...");
  try {
    const response = await apiCreatePartnerListing(payload);
    const listing = response.listing || response.data || payload;
    partnerListings.unshift({
      id: listing.id || Date.now(),
      quantity: Number(listing.quantity || payload.quantity),
      price: Number(listing.price || payload.price),
      pickupSlot: formatPickupSlot(
        listing.pickupDate || "",
        listing.pickupStartTime || payload.pickupStartTime,
        listing.pickupEndTime || payload.pickupEndTime
      ),
      description: listing.description || payload.description
    });
    addNotification("Partner listing created", `${quantity} boxes listed at ${currency(price)} each.`, "partner");
    state.partnerListingDraft = createDefaultPartnerListingDraft();
    await refreshPartnerDashboard(true);
    clearError();
    navigate("partner_dashboard");
  } catch (error) {
    setError(`Listing creation failed: ${error.message}`);
  } finally {
    stopBusy();
  }
}

async function confirmPartnerPickup(reservationId) {
  if (!reservationId) return;
  if (isMockOtpModeEnabled()) {
    partnerReservations = partnerReservations.map((item) => {
      if (item.id !== reservationId) return item;
      return { ...item, status: "picked_up" };
    });
    if (partnerDashboard) {
      partnerDashboard.pickedUp += 1;
      partnerDashboard.pending = Math.max(0, partnerDashboard.pending - 1);
    }
    partnerLedger = buildPartnerLedger(partnerReservations);
    addNotification("Pickup confirmed", `Reservation #${reservationId} marked as picked up.`, "partner");
    render();
    return;
  }
  startBusy("Confirming pickup...");
  try {
    await apiConfirmPartnerPickup(reservationId);
    await refreshPartnerReservations(true);
    await refreshPartnerDashboard(true);
    addNotification("Pickup confirmed", `Reservation #${reservationId} marked as picked up.`, "partner");
    clearError();
    render();
  } catch (error) {
    setError(`Pickup confirmation failed: ${error.message}`);
  } finally {
    stopBusy();
  }
}

async function markPartnerReservationPayment(reservationId, paymentMethod) {
  if (!reservationId) return;
  const normalizedMethod = normalizePaymentMethod(paymentMethod);
  if (isMockOtpModeEnabled()) {
    partnerReservations = partnerReservations.map((item) => {
      if (item.id !== reservationId) return item;
      return {
        ...item,
        paymentMethod: normalizedMethod,
        paymentStatus: "paid",
        paidAt: new Date().toISOString(),
        paymentReference: normalizedMethod === "upi" ? `UPI-MOCK-${reservationId}` : item.paymentReference
      };
    });
    partnerLedger = buildPartnerLedger(partnerReservations);
    addNotification(
      "Payment updated",
      `Reservation #${reservationId} marked paid (${formatPaymentMethod(normalizedMethod)}).`,
      "payment"
    );
    clearError();
    render();
    return;
  }

  startBusy("Updating payment status...");
  try {
    await apiUpdatePartnerReservationPayment(reservationId, {
      paymentMethod: normalizedMethod,
      paymentStatus: "paid"
    });
    await refreshPartnerReservations(true);
    await refreshPartnerLedger(true);
    addNotification(
      "Payment updated",
      `Reservation #${reservationId} marked paid (${formatPaymentMethod(normalizedMethod)}).`,
      "payment"
    );
    clearError();
    render();
  } catch (error) {
    setError(`Payment update failed: ${error.message}`);
  } finally {
    stopBusy();
  }
}

async function bootstrapPartnerSession() {
  if (isMockOtpModeEnabled()) {
    seedMockPartnerData();
    return;
  }
  const [dashboardResponse, reservationsResponse, ledgerResponse] = await Promise.all([
    apiGetPartnerDashboard(),
    apiGetPartnerReservations(),
    apiGetPartnerLedger().catch(() => null)
  ]);
  const dashboard = mapPartnerDashboard(dashboardResponse.dashboard || dashboardResponse);
  partnerDashboard = dashboard;
  partnerContext = {
    restaurantId: dashboard.restaurantId,
    restaurantName: dashboard.restaurantName,
    address: dashboard.address
  };
  const rawReservations = Array.isArray(reservationsResponse.reservations) ? reservationsResponse.reservations : [];
  partnerReservations = rawReservations.map(mapPartnerReservation);
  partnerLedger = ledgerResponse ? mapPartnerLedger(ledgerResponse) : buildPartnerLedger(partnerReservations);
}

function nextOnboarding() {
  if (state.onboardingIndex < onboardingSlides.length - 1) {
    state.onboardingIndex += 1;
    render();
    return;
  }
  localStorage.setItem(STORAGE.onboarded, "true");
  navigate("auth_phone");
}

function skipOnboarding() {
  localStorage.setItem(STORAGE.onboarded, "true");
  navigate("auth_phone");
}

async function sendOtp() {
  const phoneEl = document.getElementById("phone");
  const phone = phoneEl ? phoneEl.value.trim() : "";
  if (!phone || phone.length < 10) {
    setError("Enter a valid phone number.");
    return;
  }
  state.pendingPhone = phone;

  if (isMockOtpModeEnabled()) {
    state.verificationId = "mock-verification-id";
    clearError();
    navigate("auth_otp");
    return;
  }

  startBusy("Sending OTP...");
  try {
    const response = await apiSendOtp(phone);
    state.verificationId = response.verificationId || "";
    clearError();
    navigate("auth_otp");
  } catch (error) {
    setError(`OTP failed: ${error.message}`);
  } finally {
    stopBusy();
  }
}

async function verifyOtp() {
  const otpEl = document.getElementById("otp");
  const otp = otpEl ? otpEl.value.trim() : "";
  if (!otp || otp.length < 4) {
    setError("Enter a valid OTP.");
    return;
  }

  if (isMockOtpModeEnabled()) {
    if (otp !== MOCK_OTP_CODE) {
      setError(`Invalid mock OTP. Use ${MOCK_OTP_CODE}.`);
      return;
    }
    state.sessionRole = isPartnerLoginMode() ? "partner" : "customer";
    state.loginMode = normalizeLoginMode(state.sessionRole);
    authToken = "mock-token";
    user = {
      id: Date.now(),
      phone: state.pendingPhone,
      name: isPartnerSession() ? "Mock Partner" : "Mock User",
      role: state.sessionRole
    };
    if (isPartnerSession()) {
      seedMockPartnerData();
      state.partnerListingDraft = createDefaultPartnerListingDraft();
    } else {
      seedMockData();
    }
    saveSession();
    addNotification(
      "Signed in",
      isPartnerSession() ? "Signed in to partner mode with mock OTP." : "Signed in with mock OTP mode.",
      "auth"
    );
    clearError();
    navigate(isPartnerSession() ? "partner_dashboard" : "home");
    startLiveUpdates();
    if (!isPartnerSession()) refreshSupportData(true);
    return;
  }

  startBusy("Verifying OTP...");
  try {
    const response = await apiVerifyOtp(state.pendingPhone, otp, state.verificationId);
    authToken = response.token || "";
    if (!authToken) throw new Error("Token missing in response.");
    const resolvedRole = normalizeRole(response.user?.role || response.role);
    state.sessionRole = resolvedRole;
    state.loginMode = normalizeLoginMode(resolvedRole);
    user = {
      id: response.user?.id || Date.now(),
      phone: response.user?.phone || state.pendingPhone,
      name: response.user?.name || (resolvedRole === "partner" ? "Partner" : "User"),
      restaurantId: response.user?.restaurantId || response.user?.restaurant?.id || null,
      role: resolvedRole
    };
    if (resolvedRole === "admin") {
      adminPartners = [];
    } else if (isPartnerSession()) {
      await bootstrapPartnerSession();
      state.partnerListingDraft = createDefaultPartnerListingDraft();
    }
    saveSession();
    addNotification(
      "Signed in",
      isPartnerSession() ? "Partner OTP verified and session started." : "OTP verified and session started.",
      "auth"
    );
    clearError();
    navigate(
      resolvedRole === "admin"
        ? "admin_dashboard"
        : (isPartnerSession() ? "partner_dashboard" : "home")
    );
    if (!isAdminSession()) {
      startLiveUpdates();
      requestNativePushToken();
      syncPushTokenWithBackend();
      syncNotificationPreferencesToBackend();
      if (!isPartnerSession()) refreshSupportData(true);
      refreshPartnerApplicationStatus(true);
    } else {
      refreshAdminPartners(true);
    }
  } catch (error) {
    setError(`Verification failed: ${error.message}`);
  } finally {
    stopBusy();
  }
}

function updateFilter(key, value) {
  state.filters[key] = value;
  render();
  refreshListings();
}

function openDetails(id) {
  state.activeListingId = id;
  state.activeListing = listings.find((x) => x.id === id) || null;
  navigate("details");
}

function openMap(id) {
  const box = state.activeListing || listings.find((x) => x.id === id);
  if (!box) return;
  const query = encodeURIComponent(box.address);
  window.location.href = `https://www.google.com/maps/search/?api=1&query=${query}`;
}

function openReserveSheet() {
  const box = state.activeListing || listings.find((x) => x.id === state.activeListingId);
  if (!box) return;
  const content = document.getElementById("modal-content");
  if (!content) return;

  content.innerHTML = `
    <div class="stack">
      <h3 style="margin:0;">Confirm Reservation</h3>
      <div class="muted">${escapeHtml(box.restaurant)} Surprise Box</div>
      <div class="value-line"><span>Price</span><strong>${currency(box.price)}</strong></div>
      <div class="value-line"><span>Pickup</span><strong>${escapeHtml(box.pickupSlot)}</strong></div>
      <div class="stack">
        <label class="muted">Payment method</label>
        <select id="reserve-payment-method">
          <option value="cash">Cash at pickup</option>
          <option value="upi">UPI at pickup</option>
        </select>
      </div>
      <div class="row">
        <button class="btn btn-outline btn-block" onclick="closeModal()">Cancel</button>
        <button class="btn btn-success btn-block" onclick="reserveActiveListing()">Confirm</button>
      </div>
    </div>
  `;
  document.getElementById("modal").classList.remove("hidden");
}

function enableReminderChannelsForReservation(reservation) {
  if (!reservation?.id || !authToken || isMockOtpModeEnabled()) return;
  const channels = {
    push: true,
    whatsapp: Boolean(notificationPrefs.whatsappReminders)
  };
  apiEnableReservationReminderChannels(reservation.id, channels).catch(() => {
    // Endpoint may be unavailable in some environments.
  });
}

async function reserveActiveListing() {
  if (!state.activeListingId) return;
  const paymentMethodEl = document.getElementById("reserve-payment-method");
  const paymentMethod = normalizePaymentMethod(paymentMethodEl ? paymentMethodEl.value : DEFAULT_PAYMENT_METHOD);
  if (isMockOtpModeEnabled()) {
    const box = listings.find((x) => x.id === state.activeListingId);
    if (!box) {
      setError("Listing unavailable.");
      return;
    }
    if (box.quantityAvailable <= 0) {
      setError("No boxes left for this listing.");
      return;
    }
    box.quantityAvailable -= 1;
    const reservation = {
      id: Date.now(),
      code: `SB-${String(Date.now()).slice(-4)}`,
      listingId: box.id,
      restaurant: box.restaurant,
      address: box.address,
      price: box.price,
      pickupSlot: box.pickupSlot,
      pickupDate: box.pickupDate || "",
      pickupStartTime: box.pickupStartTime || "",
      pickupEndTime: box.pickupEndTime || "",
      createdAt: new Date().toISOString(),
      quantity: 1,
      paymentMethod,
      paymentStatus: "pending",
      paymentReference: "",
      paidAt: "",
      status: "confirmed",
      canCancel: true
    };
    reservations.unshift(reservation);
    schedulePickupReminder(reservation);
    addNotification("Reservation confirmed", `Your reservation ${reservation.code} is confirmed.`, "reservation");
    enableReminderChannelsForReservation(reservation);
    state.lastReservationId = reservation.id;
    closeModal();
    clearError();
    navigate("reservation_success");
    render();
    return;
  }
  startBusy("Creating reservation...");
  try {
    const response = await apiCreateReservation(state.activeListingId, paymentMethod);
    const reservation = response.reservation ? mapReservation(response.reservation) : null;
    if (!reservation) throw new Error("Reservation missing in response.");
    reservations.unshift(reservation);
    schedulePickupReminder(reservation);
    addNotification("Reservation confirmed", `Your reservation ${reservation.code} is confirmed.`, "reservation");
    enableReminderChannelsForReservation(reservation);
    state.lastReservationId = reservation.id;
    closeModal();
    clearError();
    navigate("reservation_success");
    refreshListings();
  } catch (error) {
    closeModal();
    setError(`Reservation failed: ${error.message}`);
  } finally {
    stopBusy();
  }
}

async function cancelReservation(id) {
  if (isMockOtpModeEnabled()) {
    const cancelled = reservations.find((r) => r.id === id);
    reservations = reservations.map((r) => {
      if (r.id !== id) return r;
      return { ...r, status: "cancelled", canCancel: false };
    });
    if (pickupReminderTimers.has(id)) {
      window.clearTimeout(pickupReminderTimers.get(id));
      pickupReminderTimers.delete(id);
    }
    cancelNativePickupReminder(id);
    if (cancelled) {
      addNotification("Reservation cancelled", `Reservation ${cancelled.code} was cancelled.`, "reservation");
    }
    clearError();
    render();
    return;
  }
  startBusy("Cancelling reservation...");
  try {
    await apiCancelReservation(id);
    await refreshReservations();
    if (pickupReminderTimers.has(id)) {
      window.clearTimeout(pickupReminderTimers.get(id));
      pickupReminderTimers.delete(id);
    }
    cancelNativePickupReminder(id);
    addNotification("Reservation cancelled", `Reservation #${id} was cancelled.`, "reservation");
    clearError();
  } catch (error) {
    setError(`Cancellation failed: ${error.message}`);
  } finally {
    stopBusy();
  }
}

async function submitReservationRating(reservationId, stars) {
  const numericStars = Number(stars || 0);
  if (!reservationId || numericStars < 1 || numericStars > 5) {
    setError("Choose a valid reservation and rating.");
    return;
  }

  if (isMockOtpModeEnabled()) {
    setReservationRating(reservationId, numericStars);
    addNotification("Rating submitted", `You rated reservation #${reservationId} with ${numericStars} stars.`, "rating");
    clearError();
    render();
    return;
  }

  startBusy("Submitting rating...");
  try {
    await apiSubmitReservationRating(reservationId, numericStars, "");
    setReservationRating(reservationId, numericStars);
    addNotification("Rating submitted", `You rated reservation #${reservationId} with ${numericStars} stars.`, "rating");
    clearError();
    render();
  } catch (error) {
    setError(`Could not submit rating: ${error.message}`);
  } finally {
    stopBusy();
  }
}

async function submitSupportTicket() {
  const reservationInput = document.getElementById("support-reservation-id");
  const messageInput = document.getElementById("support-message");
  const refundInput = document.getElementById("support-refund");

  const reservationId = reservationInput ? String(reservationInput.value || "").trim() : "";
  const message = messageInput ? String(messageInput.value || "").trim() : "";
  const refundRequested = Boolean(refundInput && refundInput.checked);
  if (!message || message.length < 8) {
    setError("Please describe the issue in at least 8 characters.");
    return;
  }

  const payload = {
    reservationId: reservationId || null,
    message,
    refundRequested
  };

  if (isMockOtpModeEnabled()) {
    const creditIssued = refundRequested ? 40 : 0;
    const ticket = {
      id: Date.now(),
      code: `T-${String(Date.now()).slice(-5)}`,
      reservationId,
      message,
      status: refundRequested ? "credit_issued" : "open",
      refundRequested,
      creditIssued,
      createdAt: new Date().toISOString()
    };
    supportTickets = [ticket, ...supportTickets].slice(0, 30);
    if (creditIssued > 0) supportCredits += creditIssued;
    saveSupportState();
    addNotification("Support ticket created", refundRequested ? "Complaint submitted and credit issued." : "Complaint submitted.", "support");
    if (messageInput) messageInput.value = "";
    if (refundInput) refundInput.checked = false;
    if (reservationInput) reservationInput.value = "";
    clearError();
    render();
    return;
  }

  startBusy("Submitting complaint...");
  try {
    const response = await apiCreateSupportTicket(payload);
    const ticketData = response?.ticket || response?.complaint || response || {};
    const ticket = {
      id: ticketData?.id || Date.now(),
      code: ticketData?.code || ticketData?.ticketCode || `T-${String(Date.now()).slice(-5)}`,
      reservationId: String(ticketData?.reservationId || reservationId || ""),
      message: ticketData?.message || message,
      status: String(ticketData?.status || "open").toLowerCase(),
      refundRequested: Boolean(ticketData?.refundRequested ?? refundRequested),
      creditIssued: Number(ticketData?.creditIssued || ticketData?.credit || ticketData?.refundAmount || 0),
      createdAt: ticketData?.createdAt || new Date().toISOString()
    };
    supportTickets = [ticket, ...supportTickets].slice(0, 30);
    if (ticket.creditIssued > 0) supportCredits += ticket.creditIssued;
    saveSupportState();
    addNotification("Support ticket created", "Your issue has been submitted.", "support");
    if (messageInput) messageInput.value = "";
    if (refundInput) refundInput.checked = false;
    if (reservationInput) reservationInput.value = "";
    clearError();
    render();
  } catch (error) {
    setError(`Could not submit complaint: ${error.message}`);
  } finally {
    stopBusy();
  }
}

function closeModal() {
  document.getElementById("modal").classList.add("hidden");
}

function saveApiBaseUrl() {
  const input = document.getElementById("api-base-url");
  const value = normalizeApiBaseUrl(input ? input.value : "");
  if (!value.startsWith("http://") && !value.startsWith("https://")) {
    setError("API URL must start with http:// or https://");
    return;
  }
  try {
    new URL(value);
  } catch {
    setError("API URL is invalid.");
    return;
  }
  setApiBaseUrl(value);
  if (input) input.value = value;
  clearError();
  render();
}

function saveWebSocketUrl() {
  const input = document.getElementById("websocket-url");
  const value = normalizeWebSocketUrl(input ? input.value : "");
  if (!value.startsWith("ws://") && !value.startsWith("wss://")) {
    setError("WebSocket URL must start with ws:// or wss://");
    return;
  }
  try {
    new URL(value);
  } catch {
    setError("WebSocket URL is invalid.");
    return;
  }
  setWebSocketUrl(value);
  if (input) input.value = value;
  reconnectLiveSocket();
  clearError();
  render();
}

function reconnectWebSocket() {
  reconnectLiveSocket();
  clearError();
  render();
}

function onNativeNotificationPermissionResult(granted) {
  const allowed = Boolean(granted);
  const message = allowed
    ? "Native notification permission granted."
    : "Native notification permission denied.";
  addNotification("Notification permission", message, "permission");
  if (!allowed) {
    setError("Notifications are off at OS level. Enable them to receive native pickup reminders.");
  } else {
    clearError();
  }
  render();
}

function onNativePushToken(token) {
  const normalized = String(token || "").trim();
  if (!normalized) return;
  const changed = normalized !== pushToken;
  setPushToken(normalized);
  if (changed) {
    addNotification("Push token updated", "Device push token received.", "push");
  }
  syncPushTokenWithBackend();
}

function toggleMockOtpMode() {
  const selectedLoginMode = state.loginMode;
  const next = !isMockOtpModeEnabled();
  setMockOtpModeEnabled(next);
  const statusMessage = next
    ? `Mock OTP enabled. Use OTP ${MOCK_OTP_CODE}.`
    : "Mock OTP disabled. Real backend OTP is active now.";
  resetRuntimeData();
  state.loginMode = selectedLoginMode;
  addNotification("OTP mode changed", statusMessage, "auth");
  navigate("auth_phone");
  setError(statusMessage);
}

function signOut() {
  const onboarded = localStorage.getItem(STORAGE.onboarded) === "true";
  const selectedLoginMode = state.sessionRole === "partner" ? "partner" : "customer";
  resetRuntimeData();
  if (onboarded) localStorage.setItem(STORAGE.onboarded, "true");
  state.loginMode = selectedLoginMode;
  navigate("auth_phone");
  addNotification("Signed out", "Session cleared. Please login again.", "auth");
}

function init() {
  const persistedRole = normalizeRole(user?.role || localStorage.getItem(STORAGE.sessionRole));
  state.loginMode = normalizeLoginMode(persistedRole);
  state.sessionRole = persistedRole;

  const onboarded = localStorage.getItem(STORAGE.onboarded) === "true";
  if (!onboarded) {
    state.route = "onboarding";
    render();
    return;
  }
  if (!user || !authToken) {
    state.route = "auth_phone";
    render();
    return;
  }
  if (isAdminSession()) {
    state.route = "admin_dashboard";
    render();
    refreshAdminPartners(true);
    return;
  }
  if (isPartnerSession()) {
    state.route = "partner_dashboard";
    render();
    startLiveUpdates();
    requestNativePushToken();
    syncPushTokenWithBackend();
    syncNotificationPreferencesToBackend();
    refreshPartnerDashboard();
    refreshPartnerReservations(true);
    refreshPartnerLedger(true);
    refreshPartnerApplicationStatus(true);
    return;
  }
  state.route = "home";
  render();
  startLiveUpdates();
  requestNativePushToken();
  syncPushTokenWithBackend();
  syncNotificationPreferencesToBackend();
  refreshListings();
  refreshReservations();
  refreshSupportData(true);
  refreshPartnerApplicationStatus(true);
}

window.navigate = navigate;
window.nextOnboarding = nextOnboarding;
window.skipOnboarding = skipOnboarding;
window.setLoginMode = setLoginMode;
window.sendOtp = sendOtp;
window.verifyOtp = verifyOtp;
window.updateFilter = updateFilter;
window.openDetails = openDetails;
window.openMap = openMap;
window.openReserveSheet = openReserveSheet;
window.reserveActiveListing = reserveActiveListing;
window.cancelReservation = cancelReservation;
window.submitReservationRating = submitReservationRating;
window.submitSupportTicket = submitSupportTicket;
window.closeModal = closeModal;
window.refreshListings = refreshListings;
window.refreshSupportData = refreshSupportData;
window.saveApiBaseUrl = saveApiBaseUrl;
window.saveWebSocketUrl = saveWebSocketUrl;
window.reconnectWebSocket = reconnectWebSocket;
window.requestNativeNotificationPermission = requestNativeNotificationPermission;
window.requestNativePushToken = requestNativePushToken;
window.syncPushTokenWithBackend = syncPushTokenWithBackend;
window.toggleMockOtpMode = toggleMockOtpMode;
window.signOut = signOut;
window.clearNotifications = clearNotifications;
window.toggleNotificationPreference = updateNotificationPreference;
window.onNativeNotificationPermissionResult = onNativeNotificationPermissionResult;
window.onNativePushToken = onNativePushToken;
window.updatePartnerListingDraft = updatePartnerListingDraft;
window.updatePartnerApplicationDraft = updatePartnerApplicationDraft;
window.submitPartnerApplication = submitPartnerApplication;
window.handlePartnerDocumentUpload = handlePartnerDocumentUpload;
window.removePartnerDocument = removePartnerDocument;
window.refreshPartnerApplicationStatus = refreshPartnerApplicationStatus;
window.createPartnerListing = createPartnerListing;
window.refreshPartnerDashboard = refreshPartnerDashboard;
window.refreshPartnerReservations = refreshPartnerReservations;
window.refreshPartnerLedger = refreshPartnerLedger;
window.refreshAdminPartners = refreshAdminPartners;
window.confirmPartnerPickup = confirmPartnerPickup;
window.markPartnerReservationPayment = markPartnerReservationPayment;
window.updateAdminPartnerStatus = updateAdminPartnerStatus;
window.updateAdminPartnerEdit = updateAdminPartnerEdit;
window.updateAdminPartnerNote = updateAdminPartnerNote;

init();
