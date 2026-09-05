/* =========================================================
   HOSTELLO V1
   Firebase Google Auth + Firestore + Frontend V1
   ========================================================= */

const STORAGE_KEY = "hostello_v1";

/* =========================================================
   DEFAULT DATA
   ========================================================= */

const DEFAULT_DATA = {
  currentUser: null,

  settings: {
    pgName: "JS Men's PG",
    ownerName: "Owner",
    ownerPhone: "",
    upi: "owner@upi",
    address: "",
    defaultRent: 8000,
    defaultMaintenance: 300,
    dueDay: 5
  },

  structure: {
    floors: [
      {
        number: 1,
        rooms: [101, 102, 103, 104, 105, 106]
      },
      {
        number: 2,
        rooms: [201, 202, 203, 204, 205, 206]
      },
      {
        number: 3,
        rooms: [301, 302, 303, 304, 305, 306]
      }
    ]
  },

  beds: [],
  tenants: [],
  invoices: [],
  invoiceSequence: 1
};

/* =========================================================
   APP STATE
   ========================================================= */

let db = loadData();

let currentSection = "dashboard";

let bedPath = {
  floor: null,
  room: null
};

let sendAllQueue = [];
let sendAllIndex = 0;

/* Tenant wizard */

let wizard = {
  open: false,
  step: 1,

  floor: null,
  room: null,
  bedId: null,

  data: {
    fullName: "",
    mobileNumber: "",
    alternateNumber: "",
    joiningDate: "",
    lockIn: "No Lock-in",
    feeType: "normal",
    monthlyRent: 8000,
    monthlyMaintenance: 300,
    preInformedVacateDate: ""
  }
};

/* =========================================================
   FIREBASE AUTH STATE
   ========================================================= */

let firebaseAuth = null;
let googleProvider = null;
let firebaseAuthReady = false;

let firebaseSignInWithPopup = null;
let firebaseSignOut = null;
let firebaseOnAuthStateChanged = null;

/* =========================================================
   FIREBASE FIRESTORE STATE
   ========================================================= */

let firebaseDb = null;
let firebaseFirestoreReady = false;

let firestoreDoc = null;
let firestoreGetDoc = null;
let firestoreSetDoc = null;
let firestoreServerTimestamp = null;

let firestoreSaveQueue = Promise.resolve();

/* =========================================================
   HELPERS
   ========================================================= */

function clone(value) {
  return JSON.parse(
    JSON.stringify(value)
  );
}

function uid(prefix = "id") {
  return `${prefix}_${Math.random()
    .toString(36)
    .slice(2, 9)}_${Date.now()
    .toString(36)
    .slice(-6)}`;
}

function money(value) {
  return `₹${Number(value || 0).toLocaleString(
    "en-IN"
  )}`;
}

function normalizePhone(value) {
  let phone = String(value || "").replace(
    /\D/g,
    ""
  );

  if (phone.length === 10) {
    phone = `91${phone}`;
  }

  return phone;
}

function formatDate(value) {
  if (!value) {
    return "—";
  }

  const date = new Date(
    `${value}T00:00:00`
  );

  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return date.toLocaleDateString(
    "en-IN",
    {
      day: "2-digit",
      month: "2-digit",
      year: "numeric"
    }
  );
}

function toISODate(date = new Date()) {
  const local = new Date(
    date.getTime() -
      date.getTimezoneOffset() * 60000
  );

  return local.toISOString().slice(0, 10);
}

function monthKey(date = new Date()) {
  return `${date.getFullYear()}-${String(
    date.getMonth() + 1
  ).padStart(2, "0")}`;
}

function monthLabel(date = new Date()) {
  return date.toLocaleDateString(
    "en-IN",
    {
      month: "long",
      year: "numeric"
    }
  );
}

function monthRange(date = new Date()) {
  const start = new Date(
    date.getFullYear(),
    date.getMonth(),
    1
  );

  const end = new Date(
    date.getFullYear(),
    date.getMonth() + 1,
    0
  );

  return {
    start: toISODate(start),
    end: toISODate(end)
  };
}

function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
      }[char])
  );
}

function escapeAttr(value) {
  return escapeHtml(value);
}

function statusClass(status) {
  if (status === "occupied") {
    return "green";
  }

  if (status === "notice") {
    return "brown";
  }

  return "white";
}

/* =========================================================
   STORAGE
   ========================================================= */

function loadData() {
  const raw = localStorage.getItem(
    STORAGE_KEY
  );

  if (!raw) {
    const data = clone(
      DEFAULT_DATA
    );

    data.beds =
      seedBeds(
        data.structure
      );

    return data;
  }

  try {
    const parsed = JSON.parse(raw);

    const data = {
      ...clone(DEFAULT_DATA),
      ...parsed,

      settings: {
        ...clone(
          DEFAULT_DATA.settings
        ),
        ...(parsed.settings || {})
      },

      structure:
        parsed.structure ||
        clone(
          DEFAULT_DATA.structure
        ),

      beds: Array.isArray(
        parsed.beds
      )
        ? parsed.beds
        : [],

      tenants: Array.isArray(
        parsed.tenants
      )
        ? parsed.tenants
        : [],

      invoices: Array.isArray(
        parsed.invoices
      )
        ? parsed.invoices
        : []
    };

    if (!data.beds.length) {
      data.beds =
        seedBeds(
          data.structure
        );
    }

    return data;
  } catch {
    const data = clone(
      DEFAULT_DATA
    );

    data.beds =
      seedBeds(
        data.structure
      );

    return data;
  }
}

function saveLocalDataOnly() {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(db)
  );
}

function saveData() {
  saveLocalDataOnly();

  if (
    !firebaseFirestoreReady ||
    !db.currentUser?.uid
  ) {
    return;
  }

  firestoreSaveQueue =
    firestoreSaveQueue
      .then(() =>
        saveOwnerToFirestore()
      )
      .catch((error) => {
        console.error(
          "Firestore save failed:",
          error
        );

        toast(
          "Cloud save failed"
        );
      });
}

function seedBeds(structure) {
  const beds = [];

  structure.floors.forEach(
    (floor) => {
      floor.rooms.forEach(
        (roomNumber) => {
          for (
            let number = 1;
            number <= 4;
            number++
          ) {
            beds.push({
              id: uid("bed"),
              floor: floor.number,
              room: roomNumber,
              number,
              status: "vacant",
              tenantId: null,
              createdAt: Date.now()
            });
          }
        }
      );
    }
  );

  return beds;
}

/* =========================================================
   LOOKUPS
   ========================================================= */

function getBed(id) {
  return (
    db.beds.find(
      (bed) =>
        bed.id === id
    ) || null
  );
}

function getTenant(id) {
  return (
    db.tenants.find(
      (tenant) =>
        tenant.id === id
    ) || null
  );
}

function roomBeds(room) {
  return db.beds
    .filter(
      (bed) =>
        bed.room === room
    )
    .sort(
      (a, b) =>
        a.number - b.number
    );
}

function floorRooms(floor) {
  const item =
    db.structure.floors.find(
      (entry) =>
        entry.number === floor
    );

  return item
    ? item.rooms
    : [];
}

function activeTenants() {
  return db.tenants.filter(
    (tenant) =>
      tenant.status === "active" ||
      tenant.status === "notice"
  );
}

function counts() {
  const total =
    db.beds.length;

  const occupied =
    db.beds.filter(
      (bed) =>
        bed.status ===
        "occupied"
    ).length;

  const notice =
    db.beds.filter(
      (bed) =>
        bed.status ===
        "notice"
    ).length;

  return {
    total,
    occupied,
    notice,
    vacant: Math.max(
      total -
        occupied -
        notice,
      0
    ),

    usedPercent: total
      ? Math.round(
          (
            (
              occupied +
              notice
            ) /
            total
          ) *
            100
        )
      : 0
  };
}

/* =========================================================
   TOAST
   ========================================================= */

function toast(message) {
  const el =
    document.getElementById(
      "toast"
    );

  if (!el) {
    return;
  }

  el.textContent =
    message;

  el.classList.add(
    "show"
  );

  clearTimeout(
    window.__hostelloToastTimer
  );

  window.__hostelloToastTimer =
    setTimeout(() => {
      el.classList.remove(
        "show"
      );
    }, 2400);
}

/* =========================================================
   FIREBASE APP
   ========================================================= */

async function waitForFirebaseApp(
  timeout = 10000
) {
  const start =
    Date.now();

  while (
    !window.hostelloFirebaseApp
  ) {
    if (
      Date.now() - start >=
      timeout
    ) {
      throw new Error(
        "Firebase App was not initialized. Check index.html."
      );
    }

    await new Promise(
      (resolve) =>
        setTimeout(
          resolve,
          50
        )
    );
  }

  return window.hostelloFirebaseApp;
}

/* =========================================================
   FIREBASE FIRESTORE
   ========================================================= */

async function initFirebaseFirestore() {
  try {
    const app =
      await waitForFirebaseApp();

    const firestoreModule =
      await import(
        "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js"
      );

    const {
      getFirestore,
      doc,
      getDoc,
      setDoc,
      serverTimestamp
    } = firestoreModule;

    firebaseDb =
      getFirestore(app);

    firestoreDoc =
      doc;

    firestoreGetDoc =
      getDoc;

    firestoreSetDoc =
      setDoc;

    firestoreServerTimestamp =
      serverTimestamp;

    firebaseFirestoreReady =
      true;

    window.hostelloFirebaseDb =
      firebaseDb;

    console.log(
      "Hostello Firestore connected"
    );

    const currentUser =
      firebaseAuth?.currentUser;

    if (currentUser) {
      await loadOwnerFromFirestore(
        currentUser.uid
      );
    }

  } catch (error) {
    console.error(
      "Firestore initialization failed:",
      error
    );

    firebaseFirestoreReady =
      false;
  }
}

function ownerDocRef(
  ownerUid
) {
  const uidToUse =
    ownerUid ||
    db.currentUser?.uid;

  if (
    !firebaseDb ||
    !uidToUse ||
    !firestoreDoc
  ) {
    return null;
  }

  return firestoreDoc(
    firebaseDb,
    "owners",
    uidToUse
  );
}

async function loadOwnerFromFirestore(
  ownerUid
) {
  if (
    !firebaseFirestoreReady ||
    !firebaseDb ||
    !firestoreGetDoc ||
    !ownerUid
  ) {
    return;
  }

  const ref =
    ownerDocRef(
      ownerUid
    );

  if (!ref) {
    return;
  }

  try {
    const snapshot =
      await firestoreGetDoc(
        ref
      );

    if (snapshot.exists()) {
      const cloud =
        snapshot.data() || {};

      const signedInUser = {
        ...(
          db.currentUser || {}
        ),
        uid: ownerUid
      };

      db = {
        ...clone(
          DEFAULT_DATA
        ),
        ...cloud,

        currentUser:
          signedInUser,

        settings: {
          ...clone(
            DEFAULT_DATA.settings
          ),
          ...(cloud.settings || {})
        },

        structure:
          cloud.structure
            ? clone(
                cloud.structure
              )
            : clone(
                DEFAULT_DATA.structure
              ),

        beds:
          Array.isArray(
            cloud.beds
          )
            ? clone(
                cloud.beds
              )
            : seedBeds(
                cloud.structure ||
                  DEFAULT_DATA.structure
              ),

        tenants:
          Array.isArray(
            cloud.tenants
          )
            ? clone(
                cloud.tenants
              )
            : [],

        invoices:
          Array.isArray(
            cloud.invoices
          )
            ? clone(
                cloud.invoices
              )
            : [],

        invoiceSequence:
          Number(
            cloud.invoiceSequence
          ) || 1
      };

      saveLocalDataOnly();

      renderAll();

      console.log(
        "Hostello data loaded from Firestore"
      );

      return;
    }

    await createOwnerInFirestore(
      ownerUid
    );

  } catch (error) {
    console.error(
      "Failed to load Firestore owner data:",
      error
    );

    toast(
      "Could not load cloud data"
    );
  }
}

async function createOwnerInFirestore(
  ownerUid
) {
  if (
    !firebaseFirestoreReady ||
    !firebaseDb ||
    !firestoreSetDoc ||
    !ownerUid
  ) {
    return;
  }

  const ref =
    ownerDocRef(
      ownerUid
    );

  if (!ref) {
    return;
  }

  try {
    const ownerData = {
      settings:
        clone(
          db.settings
        ),

      structure:
        clone(
          db.structure
        ),

      beds:
        clone(
          db.beds.length
            ? db.beds
            : seedBeds(
                db.structure
              )
        ),

      tenants: [],

      invoices: [],

      invoiceSequence: 1,

      createdAt:
        firestoreServerTimestamp
          ? firestoreServerTimestamp()
          : Date.now(),

      updatedAt:
        firestoreServerTimestamp
          ? firestoreServerTimestamp()
          : Date.now()
    };

    await firestoreSetDoc(
      ref,
      ownerData,
      {
        merge: true
      }
    );

    db.settings =
      clone(
        ownerData.settings
      );

    db.structure =
      clone(
        ownerData.structure
      );

    db.beds =
      clone(
        ownerData.beds
      );

    db.tenants = [];

    db.invoices = [];

    db.invoiceSequence = 1;

    saveLocalDataOnly();

    renderAll();

    console.log(
      "New Hostello owner created in Firestore"
    );

  } catch (error) {
    console.error(
      "Failed to create owner in Firestore:",
      error
    );

    toast(
      "Could not create cloud account"
    );
  }
}

async function saveOwnerToFirestore() {
  if (
    !firebaseFirestoreReady ||
    !firebaseDb ||
    !firestoreSetDoc ||
    !db.currentUser?.uid
  ) {
    return false;
  }

  const ref =
    ownerDocRef();

  if (!ref) {
    return false;
  }

  await firestoreSetDoc(
    ref,
    {
      settings:
        clone(
          db.settings
        ),

      structure:
        clone(
          db.structure
        ),

      beds:
        clone(
          db.beds
        ),

      tenants:
        clone(
          db.tenants
        ),

      invoices:
        clone(
          db.invoices
        ),

      invoiceSequence:
        Number(
          db.invoiceSequence
        ) || 1,

      updatedAt:
        firestoreServerTimestamp
          ? firestoreServerTimestamp()
          : Date.now()
    },
    {
      merge: true
    }
  );

  return true;
}

/* =========================================================
   FIREBASE AUTH
   ========================================================= */

async function initFirebaseAuth() {
  try {
    const app =
      await waitForFirebaseApp();

    const authModule =
      await import(
        "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js"
      );

    const {
      getAuth,
      GoogleAuthProvider,
      signInWithPopup,
      onAuthStateChanged,
      signOut
    } = authModule;

    firebaseAuth =
      getAuth(app);

    googleProvider =
      new GoogleAuthProvider();

    googleProvider.setCustomParameters(
      {
        prompt:
          "select_account"
      }
    );

    firebaseSignInWithPopup =
      signInWithPopup;

    firebaseSignOut =
      signOut;

    firebaseOnAuthStateChanged =
      onAuthStateChanged;

    firebaseAuthReady =
      true;

    window.hostelloFirebaseAuth =
      firebaseAuth;

    window.hostelloGoogleProvider =
      googleProvider;

    firebaseOnAuthStateChanged(
      firebaseAuth,
      handleAuthStateChanged
    );

    renderGoogleLoginUI();

  } catch (error) {
    console.error(
      "Firebase Auth initialization failed:",
      error
    );

    firebaseAuthReady =
      false;

    renderGoogleLoginUI(
      "Firebase Authentication is not ready. Check your Firebase setup."
    );
  }
}

async function handleAuthStateChanged(
  user
) {
  if (user) {
    db.currentUser = {
      uid:
        user.uid,

      email:
        user.email || "",

      name:
        user.displayName ||
        user.email?.split(
          "@"
        )[0] ||
        "Owner",

      photoURL:
        user.photoURL || ""
    };

    saveLocalDataOnly();

    showApp();

    if (
      firebaseFirestoreReady
    ) {
      await loadOwnerFromFirestore(
        user.uid
      );
    }

    return;
  }

  db.currentUser =
    null;

  saveLocalDataOnly();

  showLogin();
}

async function signInWithGoogle() {
  if (
    !firebaseAuthReady ||
    !firebaseAuth ||
    !googleProvider ||
    !firebaseSignInWithPopup
  ) {
    toast(
      "Firebase Authentication is not ready yet"
    );

    return;
  }

  try {
    await firebaseSignInWithPopup(
      firebaseAuth,
      googleProvider
    );
  } catch (error) {
    console.error(
      "Google sign-in error:",
      error
    );

    const messages = {
      "auth/popup-closed-by-user":
        "Google sign-in was cancelled",

      "auth/popup-blocked":
        "Your browser blocked the Google popup",

      "auth/cancelled-popup-request":
        "Google sign-in was cancelled",

      "auth/unauthorized-domain":
        "This website is not authorized in Firebase"
    };

    toast(
      messages[error.code] ||
        "Google sign-in failed"
    );
  }
}

async function firebaseLogout() {
  if (
    firebaseAuthReady &&
    firebaseAuth &&
    firebaseSignOut
  ) {
    try {
      await firebaseSignOut(
        firebaseAuth
      );

      return;
    } catch (error) {
      console.error(
        "Firebase sign-out error:",
        error
      );
    }
  }

  db.currentUser =
    null;

  saveLocalDataOnly();

  showLogin();
}

function renderGoogleLoginUI(
  errorMessage = ""
) {
  const form =
    document.getElementById(
      "loginForm"
    );

  if (!form) {
    return;
  }

  form.innerHTML = `
    <button
      id="googleLoginBtn"
      type="button"
      class="btn btn-primary btn-full"
    >
      Continue with Google
    </button>

    ${
      errorMessage
        ? `
          <p
            class="demo-note"
            style="color:#dc2626;margin-top:10px"
          >
            ${escapeHtml(
              errorMessage
            )}
          </p>
        `
        : ""
    }
  `;

  document
    .getElementById(
      "googleLoginBtn"
    )
    ?.addEventListener(
      "click",
      signInWithGoogle
    );
}

/* =========================================================
   LOGIN / APP UI
   ========================================================= */

function showLogin() {
  document
    .getElementById(
      "loginView"
    )
    ?.classList.remove(
      "hidden"
    );

  document
    .getElementById(
      "appView"
    )
    ?.classList.add(
      "hidden"
    );

  renderGoogleLoginUI();
}

function showApp() {
  document
    .getElementById(
      "loginView"
    )
    ?.classList.add(
      "hidden"
    );

  document
    .getElementById(
      "appView"
    )
    ?.classList.remove(
      "hidden"
    );

  updateHeaderIdentity();

  fillSettings();

  switchSection(
    "dashboard"
  );
}

function updateHeaderIdentity() {
  const ownerName =
    db.settings.ownerName ||
    db.currentUser?.name ||
    "Owner";

  const email =
    db.currentUser?.email ||
    "";

  const initial =
    ownerName
      .charAt(0)
      .toUpperCase() ||
    "O";

  const propertyName =
    document.getElementById(
      "topbarPropertyName"
    );

  const owner =
    document.getElementById(
      "sidebarOwner"
    );

  const emailEl =
    document.getElementById(
      "sidebarEmail"
    );

  const greeting =
    document.getElementById(
      "ownerGreetingName"
    );

  const topAvatar =
    document.getElementById(
      "topAvatar"
    );

  const sideAvatar =
    document.getElementById(
      "sideAvatar"
    );

  if (propertyName) {
    propertyName.textContent =
      db.settings.pgName;
  }

  if (owner) {
    owner.textContent =
      ownerName;
  }

  if (emailEl) {
    emailEl.textContent =
      email;
  }

  if (greeting) {
    greeting.textContent =
      `, ${ownerName}`;
  }

  if (topAvatar) {
    topAvatar.textContent =
      initial;
  }

  if (sideAvatar) {
    sideAvatar.textContent =
      initial;
  }
}

function switchSection(
  section
) {
  currentSection =
    section;

  document
    .querySelectorAll(
      ".app-section"
    )
    .forEach(
      (element) =>
        element.classList.add(
          "hidden"
        )
    );

  document
    .getElementById(
      `section-${section}`
    )
    ?.classList.remove(
      "hidden"
    );

  document
    .querySelectorAll(
      ".nav-item"
    )
    .forEach(
      (button) =>
        button.classList.toggle(
          "active",
          button.dataset.section ===
            section
        )
    );

  renderAll();

  window.scrollTo({
    top: 0,
    behavior: "smooth"
  });
}

function renderAll() {
  updateHeaderIdentity();

  renderDashboard();
  renderBeds();
  renderTenants();
  renderInvoices();
  renderPastTenants();
  renderStructureSummary();
  fillSettings();
}

/* =========================================================
   DASHBOARD
   ========================================================= */

function renderDashboard() {
  const c =
    counts();

  const total =
    document.getElementById(
      "statTotal"
    );

  const occupied =
    document.getElementById(
      "statOccupied"
    );

  const vacant =
    document.getElementById(
      "statVacant"
    );

  const notice =
    document.getElementById(
      "statNotice"
    );

  const percentage =
    document.getElementById(
      "occupancyPill"
    );

  if (total) {
    total.textContent =
      c.total;
  }

  if (occupied) {
    occupied.textContent =
      c.occupied;
  }

  if (vacant) {
    vacant.textContent =
      c.vacant;
  }

  if (notice) {
    notice.textContent =
      c.notice;
  }

  if (percentage) {
    percentage.textContent =
      `${c.usedPercent}% used`;
  }

  const floors =
    document.getElementById(
      "dashboardFloors"
    );

  if (floors) {
    floors.innerHTML =
      db.structure.floors
        .map(
          (floor) => {

            const rooms =
              floorRooms(
                floor.number
              );

            return `
              <div class="floor-row">

                <div class="floor-row-head">

                  <strong>
                    Floor ${floor.number}
                  </strong>

                  <span class="room-count">
                    ${rooms.length} rooms
                  </span>

                </div>

                <div class="room-mini-grid">

                  ${rooms
                    .map(
                      (room) => {

                        const beds =
                          roomBeds(
                            room
                          );

                        const used =
                          beds.filter(
                            (bed) =>
                              bed.status !==
                              "vacant"
                          ).length;

                        return `
                          <div
                            class="room-mini clickable"
                            onclick="openRoom(
                              ${floor.number},
                              ${room}
                            )"
                          >

                            <strong>
                              Room ${room}
                            </strong>

                            <small>
                              ${used}/${beds.length}
                              occupied or notice
                            </small>

                            <div class="status-dots">

                              ${beds
                                .map(
                                  (bed) =>
                                    `<span class="dot ${statusClass(
                                      bed.status
                                    )}"></span>`
                                )
                                .join("")}

                            </div>

                          </div>
                        `;
                      }
                    )
                    .join("")}

                </div>

              </div>
            `;
          }
        )
        .join("");
  }

  const upcoming =
    activeTenants()
      .filter(
        (tenant) =>
          Boolean(
            tenant.vacateDate
          )
      )
      .sort(
        (a, b) =>
          String(
            a.vacateDate
          ).localeCompare(
            String(
              b.vacateDate
            )
          )
      )
      .slice(0, 7);

  const upcomingEl =
    document.getElementById(
      "upcomingVacates"
    );

  if (upcomingEl) {
    upcomingEl.innerHTML =
      upcoming.length
        ? upcoming
            .map(
              (tenant) => `
                <div class="mini-item">

                  <div>

                    <strong>
                      ${escapeHtml(
                        tenant.fullName
                      )}
                    </strong>

                    <small>
                      Room ${
                        tenant.room
                      }
                      · Bed ${
                        tenant.bedNumber
                      }
                    </small>

                  </div>

                  <div class="notice-date">
                    ${formatDate(
                      tenant.vacateDate
                    )}
                  </div>

                </div>
              `
            )
            .join("")
        : `
            <div class="empty">
              <strong>
                No upcoming vacates
              </strong>

              No tenants are currently showing
              a vacate date.
            </div>
          `;
  }
}

/* =========================================================
   BED MANAGEMENT
   ========================================================= */

function renderBeds() {
  const heading =
    document.getElementById(
      "bedHeading"
    );

  const sub =
    document.getElementById(
      "bedSubheading"
    );

  const breadcrumb =
    document.getElementById(
      "bedBreadcrumb"
    );

  const view =
    document.getElementById(
      "bedsView"
    );

  if (
    !heading ||
    !sub ||
    !breadcrumb ||
    !view
  ) {
    return;
  }

  /* FLOOR SELECT */

  if (!bedPath.floor) {
    heading.textContent =
      "Select a floor";

    sub.textContent =
      "Choose a floor to view its rooms.";

    breadcrumb.innerHTML =
      "";

    view.innerHTML = `
      <div class="floor-select-grid">

        ${db.structure.floors
          .map(
            (floor) => `
              <div
                class="select-card"
                onclick="selectFloor(
                  ${floor.number}
                )"
              >

                <div class="big-icon">
                  🏢
                </div>

                <h3>
                  Floor ${floor.number}
                </h3>

                <p>
                  ${
                    floor.rooms.length
                  } rooms ·
                  ${floor.rooms.reduce(
                    (sum, room) =>
                      sum +
                      roomBeds(
                        room
                      ).length,
                    0
                  )} beds
                </p>

              </div>
            `
          )
          .join("")}

      </div>
    `;

    return;
  }

  /* ROOM SELECT */

  if (!bedPath.room) {
    heading.textContent =
      `Floor ${bedPath.floor}`;

    sub.textContent =
      "Select a room to view its beds.";

    breadcrumb.innerHTML = `
      <span class="crumb current">
        Floor ${bedPath.floor}
      </span>
    `;

    view.innerHTML = `
      <button
        class="btn btn-secondary back-btn"
        onclick="goFloorRoot()"
      >
        ← All Floors
      </button>

      <div class="room-grid">

        ${floorRooms(
          bedPath.floor
        )
          .map(
            (room) => {

              const beds =
                roomBeds(
                  room
                );

              const used =
                beds.filter(
                  (bed) =>
                    bed.status !==
                    "vacant"
                ).length;

              return `
                <div class="room-card">

                  <div class="room-head">

                    <strong>
                      Room ${room}
                    </strong>

                    <span class="room-count">
                      ${used}/${beds.length}
                      used
                    </span>

                  </div>

                  <div class="room-bed-preview">

                    ${beds
                      .slice(
                        0,
                        8
                      )
                      .map(
                        (bed) => `
                          <div class="mini-bed">

                            <span class="bed-symbol">
                              🛏️
                            </span>

                            <small>
                              Bed ${
                                bed.number
                              }
                            </small>

                          </div>
                        `
                      )
                      .join("")}

                  </div>

                  <button
                    class="btn btn-secondary btn-full"
                    style="margin-top:10px"
                    onclick="openRoom(
                      ${bedPath.floor},
                      ${room}
                    )"
                  >
                    Open Room
                  </button>

                </div>
              `;
            }
          )
          .join("")}

      </div>
    `;

    return;
  }

  /* BED VIEW */

  const beds =
    roomBeds(
      bedPath.room
    );

  heading.textContent =
    `Room ${bedPath.room}`;

  sub.textContent =
    "Select a bed to view information or manage the tenant.";

  breadcrumb.innerHTML = `
    <span
      class="crumb"
      onclick="goFloorRoot()"
    >
      Floor ${bedPath.floor}
    </span>

    <span>›</span>

    <span class="crumb current">
      Room ${bedPath.room}
    </span>
  `;

  view.innerHTML = `
    <button
      class="btn btn-secondary back-btn"
      onclick="goRoomList()"
    >
      ← Back to Rooms
    </button>

    <div class="panel glass bed-stage">

      <div class="panel-header">

        <div>

          <h3>
            Room ${bedPath.room}
          </h3>

          <p>
            ${beds.length} beds configured.
            Vacant beds can be removed.
          </p>

        </div>

        <button
          class="btn btn-secondary"
          onclick="addBed(
            ${bedPath.room},
            ${bedPath.floor}
          )"
        >
          + Add Bed
        </button>

      </div>

      <div class="bed-grid">

        ${beds
          .map(
            renderBedCard
          )
          .join("")}

      </div>

    </div>
  `;
}

function renderBedCard(
  bed
) {
  const tenant =
    bed.tenantId
      ? getTenant(
          bed.tenantId
        )
      : null;

  const label =
    bed.status === "occupied"
      ? "Occupied"
      : bed.status === "notice"
      ? "Notice Period"
      : "Vacant";

  return `
    <div
      class="bed-card ${statusClass(
        bed.status
      )} clickable"
      onclick="openBed(
        '${bed.id}'
      )"
    >

      <div class="bed-symbol-large">
        🛏️
      </div>

      <div class="bed-number">
        Bed ${bed.number}
      </div>

      <div class="bed-tenant">

        ${
          tenant
            ? escapeHtml(
                tenant.fullName
              )
            : "Available"
        }

      </div>

      <div
        class="bed-badge ${statusClass(
          bed.status
        )}"
      >
        ${label}
      </div>

    </div>
  `;
}

function selectFloor(
  floor
) {
  bedPath = {
    floor,
    room: null
  };

  renderBeds();
}

function openRoom(
  floor,
  room
) {
  bedPath = {
    floor,
    room
  };

  switchSection(
    "beds"
  );
}

function goFloorRoot() {
  bedPath = {
    floor: null,
    room: null
  };

  renderBeds();
}

function goRoomList() {
  bedPath.room =
    null;

  renderBeds();
}

function addBed(
  room,
  floor
) {
  const beds =
    roomBeds(
      room
    );

  const nextNumber =
    beds.length
      ? Math.max(
          ...beds.map(
            (bed) =>
              bed.number
          )
        ) + 1
      : 1;

  db.beds.push({
    id: uid("bed"),
    floor,
    room,
    number: nextNumber,
    status: "vacant",
    tenantId: null,
    createdAt: Date.now()
  });

  saveData();

  renderAll();

  toast(
    `Bed ${nextNumber} added`
  );
}

function removeBed(
  id
) {
  const bed =
    getBed(id);

  if (!bed) {
    return;
  }

  if (
    bed.status !==
      "vacant" ||
    bed.tenantId
  ) {
    toast(
      "Only vacant beds can be removed"
    );

    return;
  }

  const confirmed =
    confirm(
      `Remove Bed ${bed.number} from Room ${bed.room}?`
    );

  if (!confirmed) {
    return;
  }

  db.beds =
    db.beds.filter(
      (item) =>
        item.id !== id
    );

  saveData();

  closeModal();

  renderAll();

  toast(
    "Bed removed"
  );
}

function openBed(
  id
) {
  const bed =
    getBed(id);

  if (!bed) {
    return;
  }

  const tenant =
    bed.tenantId
      ? getTenant(
          bed.tenantId
        )
      : null;

  const statusText =
    bed.status === "occupied"
      ? "Occupied"
      : bed.status === "notice"
      ? "Notice Period"
      : "Vacant";

  openModal(`
    <div class="modal-header">

      <div>

        <h3>
          Bed ${bed.number}
          · Room ${bed.room}
        </h3>

        <p>
          Floor ${bed.floor}
        </p>

      </div>

      <button
        class="close-btn"
        onclick="closeModal()"
      >
        ✕
      </button>

    </div>

    <div class="modal-grid">

      <div class="info-card">

        <strong>
          Status
        </strong>

        <small>
          ${statusText}
        </small>

      </div>

      <div class="info-card">

        <strong>
          Location
        </strong>

        <small>
          Floor ${bed.floor}
          · Room ${bed.room}
          · Bed ${bed.number}
        </small>

      </div>

      <div class="info-card">

        <strong>
          Tenant
        </strong>

        <small>
          ${
            tenant
              ? escapeHtml(
                  tenant.fullName
                )
              : "No tenant assigned"
          }
        </small>

      </div>

      <div class="info-card">

        <strong>
          Monthly Fee
        </strong>

        <small>
          ${
            tenant
              ? money(
                  Number(
                    tenant.monthlyRent
                  ) +
                    Number(
                      tenant.monthlyMaintenance
                    )
                )
              : "—"
          }
        </small>

      </div>

    </div>

    ${
      tenant
        ? `
          <div
            class="info-card"
            style="margin-top:12px"
          >

            <strong>
              Tenant Contact
            </strong>

            <small>
              ${escapeHtml(
                tenant.mobileNumber
              )}
            </small>

            <div
              class="actions"
              style="margin-top:10px"
            >

              <button
                class="small-btn"
                onclick="
                  closeModal();
                  openTenant(
                    '${tenant.id}'
                  )
                "
              >
                View Tenant
              </button>

              ${
                tenant.status ===
                "notice"
                  ? `
                    <button
                      class="small-btn"
                      onclick="cancelNotice(
                        '${tenant.id}'
                      )"
                    >
                      Cancel Notice
                    </button>
                  `
                  : `
                    <button
                      class="small-btn"
                      onclick="giveNotice(
                        '${tenant.id}'
                      )"
                    >
                      Give Notice
                    </button>
                  `
              }

              <button
                class="small-btn danger"
                onclick="markVacated(
                  '${tenant.id}'
                )"
              >
                Mark Vacated
              </button>

            </div>

          </div>
        `
        : `
          <div class="modal-actions">

            <button
              class="btn btn-primary"
              onclick="
                closeModal();
                startTenantWizardAtBed(
                  '${bed.id}'
                )
              "
            >
              Add Tenant to This Bed
            </button>

          </div>

          <div class="modal-actions">

            <button
              class="btn btn-danger"
              onclick="removeBed(
                '${bed.id}'
              )"
            >
              Remove Bed
            </button>

          </div>
        `
    }
  `);
}

/* =========================================================
   ADD TENANT WIZARD
   FLOW:
   FLOOR → ROOM → BED → DETAILS → SAVE
   ========================================================= */

function resetWizard() {
  wizard = {
    open: true,
    step: 1,

    floor: null,
    room: null,
    bedId: null,

    data: {
      fullName: "",
      mobileNumber: "",
      alternateNumber: "",
      joiningDate: toISODate(),
      lockIn: "No Lock-in",
      feeType: "normal",
      monthlyRent:
        Number(
          db.settings.defaultRent
        ) || 8000,
      monthlyMaintenance:
        Number(
          db.settings
            .defaultMaintenance
        ) || 300,
      preInformedVacateDate:
        ""
    }
  };
}

function openAddTenantWizard() {
  resetWizard();
  renderTenantWizard();
}

function startTenantWizardAtBed(
  bedId
) {
  const bed =
    getBed(bedId);

  if (
    !bed ||
    bed.status !==
      "vacant"
  ) {
    toast(
      "That bed is not vacant"
    );

    return;
  }

  resetWizard();

  wizard.floor =
    bed.floor;

  wizard.room =
    bed.room;

  wizard.bedId =
    bed.id;

  wizard.step =
    4;

  renderTenantWizard();
}

function wizardStepTitle(
  step
) {
  return [
    "Select the floor",
    "Select the room",
    "Select the vacant bed",
    "Enter tenant details"
  ][step - 1];
}

function renderTenantWizard() {
  if (!wizard.open) {
    return;
  }

  openModal(`
    <div class="modal-header">

      <div>

        <h3>
          Add New Tenant
        </h3>

        <p>
          ${wizardStepTitle(
            wizard.step
          )}
        </p>

      </div>

      <button
        class="close-btn"
        onclick="closeTenantWizard()"
      >
        ✕
      </button>

    </div>

    <div class="wizard-steps">

      ${[1, 2, 3, 4]
        .map(
          (step, index) => {

            const active =
              wizard.step ===
              step;

            const done =
              wizard.step >
              step;

            return `
              <div
                class="wizard-step ${
                  active
                    ? "active"
                    : ""
                } ${
                  done
                    ? "done"
                    : ""
                }"
              >

                <span>
                  ${
                    done
                      ? "✓"
                      : step
                  }
                </span>

                ${
                  [
                    "Floor",
                    "Room",
                    "Bed",
                    "Details"
                  ][index]
                }

              </div>

              ${
                step < 4
                  ? `
                    <div class="wizard-line"></div>
                  `
                  : ""
              }
            `;
          }
        )
        .join("")}

    </div>

    <div class="wizard-body">

      ${renderWizardStep()}

    </div>

    <div class="modal-actions">

      ${
        wizard.step > 1
          ? `
            <button
              class="btn btn-secondary"
              onclick="wizardBack()"
            >
              ← Back
            </button>
          `
          : ""
      }

      <div
        style="flex:1"
      ></div>

      <button
        class="btn btn-secondary"
        onclick="closeTenantWizard()"
      >
        Cancel
      </button>

      ${
        wizard.step < 4

          ? `
            <button
              class="btn btn-primary"
              onclick="wizardNext()"
            >
              Continue →
            </button>
          `

          : `
            <button
              class="btn btn-primary"
              onclick="wizardNext()"
            >
              Save &amp; Allocate Tenant
            </button>
          `
      }

    </div>
  `);

  bindWizardInputs();
}

function renderWizardStep() {

  /* STEP 1 */

  if (
    wizard.step ===
    1
  ) {

    return `
      <h4>
        Select Floor
      </h4>

      <p class="step-help">
        Choose the floor where the tenant will stay.
      </p>

      <div class="wizard-grid">

        ${db.structure.floors
          .map(
            (floor) => `
              <div
                class="wizard-choice ${
                  wizard.floor ===
                  floor.number
                    ? "selected"
                    : ""
                }"
                onclick="wizardSelectFloor(
                  ${floor.number}
                )"
              >

                <h5>
                  Floor ${floor.number}
                </h5>

                <p>
                  ${
                    floor.rooms.length
                  } rooms ·
                  ${floor.rooms.reduce(
                    (sum, room) =>
                      sum +
                      roomBeds(
                        room
                      ).length,
                    0
                  )} beds
                </p>

              </div>
            `
          )
          .join("")}

      </div>
    `;
  }

  /* STEP 2 */

  if (
    wizard.step ===
    2
  ) {

    return `
      <h4>
        Select Room
      </h4>

      <p class="step-help">
        Choose a room on Floor ${
          wizard.floor
        }.
      </p>

      <div class="wizard-grid">

        ${floorRooms(
          wizard.floor
        )
          .map(
            (room) => {

              const beds =
                roomBeds(
                  room
                );

              const vacant =
                beds.filter(
                  (bed) =>
                    bed.status ===
                    "vacant"
                ).length;

              return `
                <div
                  class="wizard-choice ${
                    wizard.room ===
                    room
                      ? "selected"
                      : ""
                  } ${
                    vacant === 0
                      ? "disabled"
                      : ""
                  }"
                  ${
                    vacant > 0
                      ? `onclick="wizardSelectRoom(
                          ${room}
                        )"`
                      : ""
                  }
                >

                  <h5>
                    Room ${room}
                  </h5>

                  <p>
                    ${vacant} vacant ·
                    ${beds.length} total
                  </p>

                </div>
              `;
            }
          )
          .join("")}

      </div>
    `;
  }

  /* STEP 3 */

  if (
    wizard.step ===
    3
  ) {

    const beds =
      roomBeds(
        wizard.room
      );

    return `
      <h4>
        Select Bed
      </h4>

      <p class="step-help">
        Only vacant beds can be selected.
      </p>

      <div class="wizard-bed-grid">

        ${beds
          .map(
            (bed) => {

              const selectable =
                bed.status ===
                "vacant";

              const label =
                bed.status ===
                "occupied"
                  ? "Occupied"
                  : bed.status ===
                    "notice"
                  ? "Notice"
                  : "Vacant";

              return `
                <div
                  class="wizard-bed ${
                    wizard.bedId ===
                    bed.id
                      ? "selected"
                      : ""
                  } ${
                    !selectable
                      ? "locked"
                      : ""
                  }"
                  ${
                    selectable
                      ? `onclick="wizardSelectBed(
                          '${bed.id}'
                        )"`
                      : ""
                  }
                >

                  <span class="bed-icon">
                    🛏️
                  </span>

                  <strong>
                    Bed ${
                      bed.number
                    }
                  </strong>

                  <span
                    class="wizard-badge ${statusClass(
                      bed.status
                    )}"
                  >
                    ${label}
                  </span>

                </div>
              `;
            }
          )
          .join("")}

      </div>
    `;
  }

  /* STEP 4 */

  const d =
    wizard.data;

  const normal =
    d.feeType ===
    "normal";

  return `
    <h4>
      Tenant Details
    </h4>

    <p class="step-help">
      Enter personal details, contact information,
      joining date, lock-in and monthly fee.
    </p>

    <div
      class="review-grid"
      style="margin-bottom:13px"
    >

      <div class="review-row">

        <span>
          Floor
        </span>

        <strong>
          Floor ${
            wizard.floor
          }
        </strong>

      </div>

      <div class="review-row">

        <span>
          Room
        </span>

        <strong>
          Room ${
            wizard.room
          }
        </strong>

      </div>

      <div class="review-row">

        <span>
          Bed
        </span>

        <strong>
          Bed ${
            getBed(
              wizard.bedId
            )?.number ||
            "—"
          }
        </strong>

      </div>

      <div class="review-row">

        <span>
          Fee
        </span>

        <strong>
          ${
            normal
              ? "Same / Normal"
              : "Custom"
          }
        </strong>

      </div>

    </div>

    <div class="wizard-form-grid">

      <label>

        Full Name

        <input
          id="wizFullName"
          value="${escapeAttr(
            d.fullName
          )}"
          placeholder="Rahul Kumar"
          autocomplete="name"
        />

      </label>

      <label>

        WhatsApp / Mobile Number

        <input
          id="wizMobile"
          value="${escapeAttr(
            d.mobileNumber
          )}"
          placeholder="9876543210"
          inputmode="tel"
        />

      </label>

      <label>

        Alternate Number

        <span class="muted">
          (optional)
        </span>

        <input
          id="wizAlternate"
          value="${escapeAttr(
            d.alternateNumber
          )}"
          placeholder="Optional"
          inputmode="tel"
        />

      </label>

      <label>

        Joining Date

        <input
          id="wizJoiningDate"
          type="date"
          value="${escapeAttr(
            d.joiningDate
          )}"
        />

      </label>

      <label>

        Lock-in

        <select
          id="wizLockIn"
        >

          ${[
            "No Lock-in",
            "3 Months",
            "6 Months",
            "11 Months",
            "Custom"
          ]
            .map(
              (option) => `
                <option
                  value="${option}"
                  ${
                    d.lockIn ===
                    option
                      ? "selected"
                      : ""
                  }
                >
                  ${option}
                </option>
              `
            )
            .join("")}

        </select>

      </label>

      <label>

        Fee Type

        <select
          id="wizFeeType"
        >

          <option
            value="normal"
            ${
              normal
                ? "selected"
                : ""
            }
          >
            Same / Normal
          </option>

          <option
            value="custom"
            ${
              !normal
                ? "selected"
                : ""
            }
          >
            Custom
          </option>

        </select>

      </label>

      <label>

        Monthly Rent

        <input
          id="wizRent"
          type="number"
          min="0"
          value="${
            Number(
              d.monthlyRent
            ) || 0
          }"
          ${
            normal
              ? "readonly"
              : ""
          }
        />

      </label>

      <label>

        Monthly Maintenance

        <input
          id="wizMaintenance"
          type="number"
          min="0"
          value="${
            Number(
              d.monthlyMaintenance
            ) || 0
          }"
          ${
            normal
              ? "readonly"
              : ""
          }
        />

      </label>

      <label class="full">

        Pre-informed Vacate Date

        <span class="muted">
          (optional)
        </span>

        <input
          id="wizVacateDate"
          type="date"
          value="${escapeAttr(
            d.preInformedVacateDate
          )}"
        />

      </label>

    </div>

    <div class="notice-review">

      Mid-month joining is not prorated in Hostello V1.
      First partial-month payment can be handled manually.
      Normal billing starts from the next 1st.

    </div>

    ${
      d.preInformedVacateDate
        ? `
          <div
            class="notice-review"
            style="margin-top:8px"
          >
            This tenant will be created as
            <strong>Notice Period</strong>
            and the bed will appear brown.
          </div>
        `
        : ""
    }
  `;
}

function bindWizardInputs() {

  if (
    wizard.step !==
    4
  ) {
    return;
  }

  document
    .getElementById(
      "wizFullName"
    )
    ?.addEventListener(
      "input",
      (event) => {
        wizard.data.fullName =
          event.target.value;
      }
    );

  document
    .getElementById(
      "wizMobile"
    )
    ?.addEventListener(
      "input",
      (event) => {
        wizard.data.mobileNumber =
          event.target.value;
      }
    );

  document
    .getElementById(
      "wizAlternate"
    )
    ?.addEventListener(
      "input",
      (event) => {
        wizard.data.alternateNumber =
          event.target.value;
      }
    );

  document
    .getElementById(
      "wizJoiningDate"
    )
    ?.addEventListener(
      "change",
      (event) => {
        wizard.data.joiningDate =
          event.target.value;
      }
    );

  document
    .getElementById(
      "wizLockIn"
    )
    ?.addEventListener(
      "change",
      (event) => {
        wizard.data.lockIn =
          event.target.value;
      }
    );

  document
    .getElementById(
      "wizFeeType"
    )
    ?.addEventListener(
      "change",
      (event) => {

        updateWizardDataFromInputs();

        wizard.data.feeType =
          event.target.value;

        if (
          wizard.data.feeType ===
          "normal"
        ) {
          wizard.data.monthlyRent =
            Number(
              db.settings
                .defaultRent
            ) || 0;

          wizard.data.monthlyMaintenance =
            Number(
              db.settings
                .defaultMaintenance
            ) || 0;
        }

        renderTenantWizard();
      }
    );

  document
    .getElementById(
      "wizRent"
    )
    ?.addEventListener(
      "input",
      (event) => {
        wizard.data.monthlyRent =
          Number(
            event.target.value
          ) || 0;
      }
    );

  document
    .getElementById(
      "wizMaintenance"
    )
    ?.addEventListener(
      "input",
      (event) => {
        wizard.data.monthlyMaintenance =
          Number(
            event.target.value
          ) || 0;
      }
    );

  document
    .getElementById(
      "wizVacateDate"
    )
    ?.addEventListener(
      "change",
      (event) => {
        wizard.data
          .preInformedVacateDate =
          event.target.value;
      }
    );
}

function wizardSelectFloor(
  number
) {
  wizard.floor =
    number;

  wizard.room =
    null;

  wizard.bedId =
    null;

  renderTenantWizard();
}

function wizardSelectRoom(
  room
) {
  wizard.room =
    room;

  wizard.bedId =
    null;

  renderTenantWizard();
}

function wizardSelectBed(
  id
) {
  const bed =
    getBed(id);

  if (
    !bed ||
    bed.status !==
      "vacant"
  ) {
    return;
  }

  wizard.bedId =
    id;

  renderTenantWizard();
}

function updateWizardDataFromInputs() {

  if (
    wizard.step !==
    4
  ) {
    return;
  }

  const fullName =
    document.getElementById(
      "wizFullName"
    );

  const mobile =
    document.getElementById(
      "wizMobile"
    );

  const alternate =
    document.getElementById(
      "wizAlternate"
    );

  const joiningDate =
    document.getElementById(
      "wizJoiningDate"
    );

  const lockIn =
    document.getElementById(
      "wizLockIn"
    );

  const feeType =
    document.getElementById(
      "wizFeeType"
    );

  const rent =
    document.getElementById(
      "wizRent"
    );

  const maintenance =
    document.getElementById(
      "wizMaintenance"
    );

  const vacate =
    document.getElementById(
      "wizVacateDate"
    );

  if (fullName) {
    wizard.data.fullName =
      fullName.value.trim();
  }

  if (mobile) {
    wizard.data.mobileNumber =
      mobile.value.trim();
  }

  if (alternate) {
    wizard.data.alternateNumber =
      alternate.value.trim();
  }

  if (joiningDate) {
    wizard.data.joiningDate =
      joiningDate.value;
  }

  if (lockIn) {
    wizard.data.lockIn =
      lockIn.value;
  }

  if (feeType) {
    wizard.data.feeType =
      feeType.value;
  }

  if (rent) {
    wizard.data.monthlyRent =
      Number(
        rent.value
      ) || 0;
  }

  if (maintenance) {
    wizard.data.monthlyMaintenance =
      Number(
        maintenance.value
      ) || 0;
  }

  if (vacate) {
    wizard.data
      .preInformedVacateDate =
      vacate.value;
  }

  if (
    wizard.data.feeType ===
    "normal"
  ) {
    wizard.data.monthlyRent =
      Number(
        db.settings.defaultRent
      ) || 0;

    wizard.data.monthlyMaintenance =
      Number(
        db.settings
          .defaultMaintenance
      ) || 0;
  }
}

function wizardNext() {

  if (
    wizard.step ===
    1
  ) {
    if (!wizard.floor) {
      toast(
        "Select a floor first"
      );

      return;
    }

    wizard.step =
      2;

    renderTenantWizard();

    return;
  }

  if (
    wizard.step ===
    2
  ) {
    if (!wizard.room) {
      toast(
        "Select a room first"
      );

      return;
    }

    wizard.step =
      3;

    renderTenantWizard();

    return;
  }

  if (
    wizard.step ===
    3
  ) {
    if (!wizard.bedId) {
      toast(
        "Select a vacant bed first"
      );

      return;
    }

    wizard.step =
      4;

    renderTenantWizard();

    return;
  }

  if (
    wizard.step ===
    4
  ) {
    updateWizardDataFromInputs();

    if (
      !validateWizardDetails()
    ) {
      return;
    }

    createTenantFromWizard();
  }
}

function wizardBack() {

  if (
    wizard.step <=
    1
  ) {
    return;
  }

  updateWizardDataFromInputs();

  wizard.step--;

  renderTenantWizard();
}

function validateWizardDetails() {

  const data =
    wizard.data;

  const phone =
    normalizePhone(
      data.mobileNumber
    );

  const bed =
    getBed(
      wizard.bedId
    );

  if (
    !data.fullName
  ) {
    toast(
      "Enter the tenant's full name"
    );

    return false;
  }

  if (
    phone.length <
    12
  ) {
    toast(
      "Enter a valid 10-digit mobile number"
    );

    return false;
  }

  if (
    !data.joiningDate
  ) {
    toast(
      "Select a joining date"
    );

    return false;
  }

  if (
    data.monthlyRent <
      0 ||
    data.monthlyMaintenance <
      0
  ) {
    toast(
      "Fee cannot be negative"
    );

    return false;
  }

  if (
    data.preInformedVacateDate &&
    data.preInformedVacateDate <
      data.joiningDate
  ) {
    toast(
      "Vacate date cannot be before joining date"
    );

    return false;
  }

  if (
    !bed ||
    bed.status !==
      "vacant"
  ) {
    toast(
      "That bed is no longer vacant"
    );

    return false;
  }

  return true;
}

function createTenantFromWizard() {

  const data =
    wizard.data;

  const bed =
    getBed(
      wizard.bedId
    );

  if (!bed) {
    toast(
      "Selected bed not found"
    );

    return;
  }

  const tenantId =
    uid("tenant");

  const hasNotice =
    Boolean(
      data.preInformedVacateDate
    );

  const tenant = {
    id: tenantId,

    fullName:
      data.fullName,

    mobileNumber:
      normalizePhone(
        data.mobileNumber
      ),

    alternateNumber:
      data.alternateNumber,

    floor:
      bed.floor,

    room:
      bed.room,

    bedId:
      bed.id,

    bedNumber:
      bed.number,

    joiningDate:
      data.joiningDate,

    lockIn:
      data.lockIn,

    feeType:
      data.feeType,

    monthlyRent:
      Number(
        data.monthlyRent
      ) || 0,

    monthlyMaintenance:
      Number(
        data.monthlyMaintenance
      ) || 0,

    preInformedVacateDate:
      data.preInformedVacateDate ||
      null,

    noticeGivenDate:
      hasNotice
        ? data.joiningDate
        : null,

    vacateDate:
      hasNotice
        ? data.preInformedVacateDate
        : null,

    status:
      hasNotice
        ? "notice"
        : "active",

    createdAt:
      Date.now()
  };

  db.tenants.push(
    tenant
  );

  bed.tenantId =
    tenant.id;

  bed.status =
    hasNotice
      ? "notice"
      : "occupied";

  saveData();

  wizard.open =
    false;

  closeModal();

  renderAll();

  toast(
    `${tenant.fullName} allocated to Room ${tenant.room} · Bed ${tenant.bedNumber}`
  );
}

function closeTenantWizard() {
  wizard.open =
    false;

  closeModal();
}

/* =========================================================
   TENANTS
   ========================================================= */

function renderTenants() {

  const query =
    (
      document.getElementById(
        "tenantSearch"
      )?.value ||
      ""
    )
      .toLowerCase()
      .trim();

  const tenants =
    activeTenants()
      .filter(
        (tenant) =>
          `${tenant.fullName} ${tenant.mobileNumber} ${tenant.room} ${tenant.bedNumber}`
            .toLowerCase()
            .includes(
              query
            )
      )
      .sort(
        (a, b) =>
          a.floor - b.floor ||
          a.room - b.room ||
          a.bedNumber -
            b.bedNumber
      );

  const wrap =
    document.getElementById(
      "tenantTableWrap"
    );

  if (!wrap) {
    return;
  }

  wrap.innerHTML =
    tenants.length
      ? `
        <table class="data-table">

          <thead>

            <tr>

              <th>Floor</th>
              <th>Room</th>
              <th>Bed</th>
              <th>Tenant</th>
              <th>WhatsApp</th>
              <th>Fee</th>
              <th>Status</th>
              <th>Action</th>

            </tr>

          </thead>

          <tbody>

            ${tenants
              .map(
                (tenant) => `
                  <tr>

                    <td>
                      F${tenant.floor}
                    </td>

                    <td>
                      ${tenant.room}
                    </td>

                    <td>
                      ${tenant.bedNumber}
                    </td>

                    <td class="name-cell">

                      <strong>
                        ${escapeHtml(
                          tenant.fullName
                        )}
                      </strong>

                      <small>
                        ${formatDate(
                          tenant.joiningDate
                        )}
                      </small>

                    </td>

                    <td>
                      ${escapeHtml(
                        tenant.mobileNumber
                      )}
                    </td>

                    <td>
                      ${money(
                        Number(
                          tenant.monthlyRent
                        ) +
                          Number(
                            tenant.monthlyMaintenance
                          )
                      )}
                    </td>

                    <td>

                      <span
                        class="status-chip ${
                          tenant.status ===
                          "notice"
                            ? "chip-unpaid"
                            : "chip-paid"
                        }"
                      >
                        ${
                          tenant.status ===
                          "notice"
                            ? "Notice"
                            : "Active"
                        }
                      </span>

                    </td>

                    <td>

                      <button
                        class="small-btn"
                        onclick="openTenant(
                          '${tenant.id}'
                        )"
                      >
                        View
                      </button>

                    </td>

                  </tr>
                `
              )
              .join("")}

          </tbody>

        </table>
      `
      : `
        <div class="empty">

          <strong>
            No current tenants
          </strong>

          Click “Add New Tenant”
          to allocate a vacant bed.

        </div>
      `;
}

function openTenant(
  id
) {

  const tenant =
    getTenant(id);

  if (!tenant) {
    return;
  }

  const invoices =
    db.invoices
      .filter(
        (invoice) =>
          invoice.tenantId ===
          id
      )
      .sort(
        (a, b) =>
          b.createdAt -
          a.createdAt
      );

  openModal(`
    <div class="modal-header">

      <div>

        <h3>
          ${escapeHtml(
            tenant.fullName
          )}
        </h3>

        <p>
          Room ${tenant.room}
          · Bed ${
            tenant.bedNumber
          }
        </p>

      </div>

      <button
        class="close-btn"
        onclick="closeModal()"
      >
        ✕
      </button>

    </div>

    <div class="modal-grid">

      <div class="info-card">
        <strong>Status</strong>

        <small>
          ${
            tenant.status ===
            "notice"
              ? "Notice Period"
              : tenant.status ===
                "vacated"
              ? "Vacated"
              : "Active"
          }
        </small>
      </div>

      <div class="info-card">
        <strong>
          WhatsApp / Mobile
        </strong>

        <small>
          ${escapeHtml(
            tenant.mobileNumber
          )}
        </small>
      </div>

      <div class="info-card">
        <strong>
          Alternate Number
        </strong>

        <small>
          ${escapeHtml(
            tenant.alternateNumber ||
              "—"
          )}
        </small>
      </div>

      <div class="info-card">
        <strong>
          Joining Date
        </strong>

        <small>
          ${formatDate(
            tenant.joiningDate
          )}
        </small>
      </div>

      <div class="info-card">
        <strong>
          Lock-in
        </strong>

        <small>
          ${escapeHtml(
            tenant.lockIn
          )}
        </small>
      </div>

      <div class="info-card">
        <strong>
          Rent
        </strong>

        <small>
          ${money(
            tenant.monthlyRent
          )}
        </small>
      </div>

      <div class="info-card">
        <strong>
          Maintenance
        </strong>

        <small>
          ${money(
            tenant.monthlyMaintenance
          )}
        </small>
      </div>

      <div class="info-card">
        <strong>
          Vacate Date
        </strong>

        <small>
          ${formatDate(
            tenant.vacateDate
          )}
        </small>
      </div>

    </div>

    <div
      class="actions"
      style="margin-top:14px"
    >

      ${
        tenant.status !==
        "vacated"
          ? `
            <button
              class="small-btn"
              onclick="editTenant(
                '${tenant.id}'
              )"
            >
              Edit
            </button>
          `
          : ""
      }

      ${
        tenant.status ===
        "notice"
          ? `
            <button
              class="small-btn"
              onclick="cancelNotice(
                '${tenant.id}'
              )"
            >
              Cancel Notice
            </button>
          `
          : tenant.status ===
            "active"
          ? `
            <button
              class="small-btn"
              onclick="giveNotice(
                '${tenant.id}'
              )"
            >
              Give Notice
            </button>
          `
          : ""
      }

      ${
        tenant.status !==
        "vacated"
          ? `
            <button
              class="small-btn danger"
              onclick="markVacated(
                '${tenant.id}'
              )"
            >
              Mark Vacated
            </button>
          `
          : ""
      }

    </div>

    <div
      style="margin-top:18px"
    >

      <strong
        style="color:var(--navy)"
      >
        Invoice History
      </strong>

      <div
        style="margin-top:8px"
      >

        ${
          invoices.length
            ? invoices
                .map(
                  (invoice) => `
                    <div
                      class="mini-item"
                      style="margin-bottom:7px"
                    >

                      <div>

                        <strong>
                          ${
                            invoice.invoiceNumber
                          }
                        </strong>

                        <small>
                          ${
                            invoice.billingLabel
                          }
                        </small>

                      </div>

                      <div>

                        <strong>
                          ${money(
                            invoice.totalAmount
                          )}
                        </strong>

                        <small>
                          ${
                            invoice.isPaid
                              ? "Paid"
                              : "Unpaid"
                          }
                        </small>

                      </div>

                    </div>
                  `
                )
                .join("")
            : `
              <div class="empty">
                No invoices yet.
              </div>
            `
        }

      </div>

    </div>
  `);
}

function editTenant(
  id
) {

  const tenant =
    getTenant(id);

  if (!tenant) {
    return;
  }

  openModal(`
    <div class="modal-header">

      <div>

        <h3>
          Edit Tenant
        </h3>

        <p>
          Update tenant information.
        </p>

      </div>

      <button
        class="close-btn"
        onclick="openTenant(
          '${tenant.id}'
        )"
      >
        ✕
      </button>

    </div>

    <form
      id="editTenantForm"
    >

      <div class="modal-grid">

        <label>
          Full Name

          <input
            id="editName"
            value="${escapeAttr(
              tenant.fullName
            )}"
            required
          />
        </label>

        <label>
          WhatsApp / Mobile

          <input
            id="editPhone"
            value="${escapeAttr(
              tenant.mobileNumber
            )}"
            required
          />
        </label>

        <label>
          Alternate Number

          <input
            id="editAlt"
            value="${escapeAttr(
              tenant.alternateNumber ||
                ""
            )}"
          />
        </label>

        <label>
          Joining Date

          <input
            id="editJoin"
            type="date"
            value="${escapeAttr(
              tenant.joiningDate
            )}"
            required
          />
        </label>

        <label>
          Lock-in

          <input
            id="editLock"
            value="${escapeAttr(
              tenant.lockIn
            )}"
          />
        </label>

        <label>
          Monthly Rent

          <input
            id="editRent"
            type="number"
            min="0"
            value="${
              Number(
                tenant.monthlyRent
              ) || 0
            }"
          />
        </label>

        <label>
          Monthly Maintenance

          <input
            id="editMaint"
            type="number"
            min="0"
            value="${
              Number(
                tenant.monthlyMaintenance
              ) || 0
            }"
          />
        </label>

        <label>
          Vacate Date

          <input
            id="editVacate"
            type="date"
            value="${escapeAttr(
              tenant.vacateDate ||
                ""
            )}"
          />
        </label>

      </div>

      <div class="modal-actions">

        <button
          type="button"
          class="btn btn-secondary"
          onclick="openTenant(
            '${tenant.id}'
          )"
        >
          Cancel
        </button>

        <button
          type="submit"
          class="btn btn-primary"
        >
          Save Changes
        </button>

      </div>

    </form>
  `);

  document
    .getElementById(
      "editTenantForm"
    )
    ?.addEventListener(
      "submit",
      (event) => {

        event.preventDefault();

        tenant.fullName =
          document
            .getElementById(
              "editName"
            )
            .value.trim();

        tenant.mobileNumber =
          normalizePhone(
            document
              .getElementById(
                "editPhone"
              )
              .value
          );

        tenant.alternateNumber =
          document
            .getElementById(
              "editAlt"
            )
            .value.trim();

        tenant.joiningDate =
          document.getElementById(
            "editJoin"
          ).value;

        tenant.lockIn =
          document
            .getElementById(
              "editLock"
            )
            .value.trim() ||
          "No Lock-in";

        tenant.monthlyRent =
          Number(
            document
              .getElementById(
                "editRent"
              )
              .value
          ) || 0;

        tenant.monthlyMaintenance =
          Number(
            document
              .getElementById(
                "editMaint"
              )
              .value
          ) || 0;

        tenant.vacateDate =
          document.getElementById(
            "editVacate"
          ).value ||
          null;

        if (
          tenant.status !==
          "vacated"
        ) {

          if (
            tenant.vacateDate
          ) {
            tenant.status =
              "notice";

            tenant.noticeGivenDate =
              tenant.noticeGivenDate ||
              toISODate();
          } else {
            tenant.status =
              "active";

            tenant.noticeGivenDate =
              null;
          }

          const bed =
            getBed(
              tenant.bedId
            );

          if (bed) {
            bed.status =
              tenant.status ===
              "notice"
                ? "notice"
                : "occupied";
          }
        }

        tenant.updatedAt =
          Date.now();

        saveData();

        closeModal();

        renderAll();

        toast(
          "Tenant updated"
        );
      }
    );
}

function giveNotice(
  id
) {

  const tenant =
    getTenant(id);

  if (
    !tenant ||
    tenant.status ===
      "vacated"
  ) {
    return;
  }

  const suggested =
    toISODate(
      new Date(
        Date.now() +
          7 *
            86400000
      )
    );

  const date =
    prompt(
      "Enter vacate date (YYYY-MM-DD):",
      suggested
    );

  if (!date) {
    return;
  }

  if (
    date <
    tenant.joiningDate
  ) {
    toast(
      "Vacate date cannot be before joining date"
    );

    return;
  }

  tenant.status =
    "notice";

  tenant.noticeGivenDate =
    toISODate();

  tenant.vacateDate =
    date;

  const bed =
    getBed(
      tenant.bedId
    );

  if (bed) {
    bed.status =
      "notice";
  }

  saveData();

  closeModal();

  renderAll();

  toast(
    "Notice period recorded"
  );
}

function cancelNotice(
  id
) {

  const tenant =
    getTenant(id);

  if (
    !tenant ||
    tenant.status !==
      "notice"
  ) {
    return;
  }

  tenant.status =
    "active";

  tenant.noticeGivenDate =
    null;

  tenant.vacateDate =
    null;

  tenant.preInformedVacateDate =
    null;

  const bed =
    getBed(
      tenant.bedId
    );

  if (bed) {
    bed.status =
      "occupied";
  }

  saveData();

  closeModal();

  renderAll();

  toast(
    "Notice cancelled"
  );
}

function markVacated(
  id
) {

  const tenant =
    getTenant(id);

  if (
    !tenant ||
    tenant.status ===
      "vacated"
  ) {
    return;
  }

  if (
    !confirm(
      `Mark ${tenant.fullName} as vacated?`
    )
  ) {
    return;
  }

  tenant.status =
    "vacated";

  tenant.vacateDate =
    tenant.vacateDate ||
    toISODate();

  tenant.updatedAt =
    Date.now();

  const bed =
    getBed(
      tenant.bedId
    );

  if (bed) {
    bed.status =
      "vacant";

    bed.tenantId =
      null;
  }

  saveData();

  closeModal();

  renderAll();

  toast(
    "Tenant archived and bed freed"
  );
}

/* =========================================================
   INVOICES
   ========================================================= */

function invoiceMessage(
  invoice
) {

  const upiLine =
    db.settings.upi
      ? `UPI: ${db.settings.upi}\n`
      : "";

  return `
*${db.settings.pgName}*

PAYMENT BILL

Invoice No: ${invoice.invoiceNumber}
Invoice Date: ${formatDate(
    invoice.invoiceDate
  )}

Name: ${invoice.tenantNameSnapshot}
Room/Bed: ${invoice.roomSnapshot} - Bed ${invoice.bedSnapshot}
Joining Date: ${formatDate(
    invoice.joiningDateSnapshot
  )}

Rent Period: ${formatDate(
    invoice.rentPeriodStart
  )} - ${formatDate(
    invoice.rentPeriodEnd
  )}

Rent: ${money(
    invoice.rentAmount
  )}
Maintenance: ${money(
    invoice.maintenanceAmount
  )}
TOTAL: ${money(
    invoice.totalAmount
  )}

Due Date: ${formatDate(
    invoice.dueDate
  )}
${upiLine}
Please make the payment by the due date.

Thank you,
${db.settings.pgName}
`.trim();
}

function generateMonthlyBills() {

  const now =
    new Date();

  const billingMonth =
    monthKey(
      now
    );

  const range =
    monthRange(
      now
    );

  const dueDate =
    new Date(
      now.getFullYear(),
      now.getMonth(),
      Math.min(
        Number(
          db.settings.dueDay
        ) || 5,
        28
      )
    );

  let created =
    0;

  activeTenants().forEach(
    (tenant) => {

      const exists =
        db.invoices.some(
          (invoice) =>
            invoice.tenantId ===
              tenant.id &&
            invoice.billingMonth ===
              billingMonth
        );

      if (exists) {
        return;
      }

      const invoiceNumber =
        `INV-${String(
          db.invoiceSequence++
        ).padStart(
          3,
          "0"
        )}`;

      db.invoices.push({

        id:
          uid(
            "invoice"
          ),

        invoiceNumber,

        tenantId:
          tenant.id,

        billingMonth,

        billingLabel:
          monthLabel(
            now
          ),

        invoiceDate:
          range.start,

        dueDate:
          toISODate(
            dueDate
          ),

        rentPeriodStart:
          range.start,

        rentPeriodEnd:
          range.end,

        tenantNameSnapshot:
          tenant.fullName,

        tenantMobileSnapshot:
          tenant.mobileNumber,

        floorSnapshot:
          tenant.floor,

        roomSnapshot:
          tenant.room,

        bedSnapshot:
          tenant.bedNumber,

        joiningDateSnapshot:
          tenant.joiningDate,

        rentAmount:
          Number(
            tenant.monthlyRent
          ) || 0,

        maintenanceAmount:
          Number(
            tenant.monthlyMaintenance
          ) || 0,

        totalAmount:
          (
            Number(
              tenant.monthlyRent
            ) || 0
          ) +
          (
            Number(
              tenant.monthlyMaintenance
            ) || 0
          ),

        whatsappStatus:
          "pending",

        sentAt:
          null,

        isPaid:
          false,

        paidAt:
          null,

        createdAt:
          Date.now()
      });

      created++;
    }
  );

  saveData();

  renderAll();

  toast(
    created
      ? `${created} invoice${
          created === 1
            ? ""
            : "s"
        } generated`
      : "All monthly invoices already exist"
  );
}

/* =========================================================
   WHATSAPP
   ========================================================= */

function openWhatsApp(
  invoiceId
) {

  const invoice =
    db.invoices.find(
      (item) =>
        item.id ===
        invoiceId
    );

  if (!invoice) {
    return;
  }

  if (
    !invoice.tenantMobileSnapshot ||
    invoice.tenantMobileSnapshot.length <
      12
  ) {
    toast(
      "Invoice has no valid WhatsApp number"
    );

    return;
  }

  const url =
    `https://wa.me/${
      invoice.tenantMobileSnapshot
    }?text=${
      encodeURIComponent(
        invoiceMessage(
          invoice
        )
      )
    }`;

  window.open(
    url,
    "_blank",
    "noopener,noreferrer"
  );

  invoice.whatsappStatus =
    "sent";

  invoice.sentAt =
    new Date().toISOString();

  saveData();

  renderInvoices();
}

function startSendAll() {

  const pending =
    db.invoices
      .filter(
        (invoice) =>
          invoice.whatsappStatus !==
          "sent"
      )
      .sort(
        (a, b) =>
          a.createdAt -
          b.createdAt
      );

  if (!pending.length) {
    toast(
      "All current invoices are marked sent"
    );

    return;
  }

  sendAllQueue =
    pending;

  sendAllIndex =
    0;

  showSendAllModal();
}

function showSendAllModal() {

  if (
    sendAllIndex >=
    sendAllQueue.length
  ) {
    closeModal();

    toast(
      "Send All completed"
    );

    return;
  }

  const invoice =
    sendAllQueue[
      sendAllIndex
    ];

  openModal(`
    <div class="modal-header">

      <div>

        <h3>
          Send All WhatsApp
        </h3>

        <p>
          ${
            sendAllIndex + 1
          }
          of
          ${
            sendAllQueue.length
          }
          · Send one message at a time.
        </p>

      </div>

      <button
        class="close-btn"
        onclick="closeModal()"
      >
        ✕
      </button>

    </div>

    <div class="info-card">

      <strong>
        ${escapeHtml(
          invoice.tenantNameSnapshot
        )}
      </strong>

      <small>
        ${
          invoice.invoiceNumber
        }
        · Room ${
          invoice.roomSnapshot
        }
        · Bed ${
          invoice.bedSnapshot
        }
      </small>

    </div>

    <div
      class="message-preview"
      style="margin-top:12px"
    >
      ${escapeHtml(
        invoiceMessage(
          invoice
        )
      )}
    </div>

    <div class="modal-actions">

      <button
        class="btn btn-secondary"
        onclick="closeModal()"
      >
        Stop
      </button>

      <button
        class="btn btn-primary"
        onclick="openWhatsAppAndNext(
          '${invoice.id}'
        )"
      >
        Open WhatsApp →
      </button>

    </div>
  `);
}

function openWhatsAppAndNext(
  invoiceId
) {

  openWhatsApp(
    invoiceId
  );

  sendAllIndex++;

  setTimeout(
    showSendAllModal,
    450
  );
}

function togglePaid(
  id
) {

  const invoice =
    db.invoices.find(
      (item) =>
        item.id === id
    );

  if (!invoice) {
    return;
  }

  invoice.isPaid =
    !invoice.isPaid;

  invoice.paidAt =
    invoice.isPaid
      ? new Date().toISOString()
      : null;

  saveData();

  renderInvoices();

  toast(
    invoice.isPaid
      ? "Marked as paid"
      : "Payment marked unpaid"
  );
}

function viewInvoice(
  id
) {

  const invoice =
    db.invoices.find(
      (item) =>
        item.id === id
    );

  if (!invoice) {
    return;
  }

  openModal(`
    <div class="modal-header">

      <div>

        <h3>
          ${invoice.invoiceNumber}
        </h3>

        <p>
          ${escapeHtml(
            invoice.tenantNameSnapshot
          )}
          ·
          ${invoice.billingLabel}
        </p>

      </div>

      <button
        class="close-btn"
        onclick="closeModal()"
      >
        ✕
      </button>

    </div>

    <div class="message-preview">
      ${escapeHtml(
        invoiceMessage(
          invoice
        )
      )}
    </div>

    <div class="modal-actions">

      <button
        class="btn btn-secondary"
        onclick="closeModal()"
      >
        Close
      </button>

      <button
        class="btn btn-primary"
        onclick="openWhatsApp(
          '${invoice.id}'
        )"
      >
        ${
          invoice.whatsappStatus ===
          "sent"
            ? "Send Again"
            : "Send WhatsApp"
        }
      </button>

    </div>
  `);
}

function renderInvoices() {

  const query =
    (
      document.getElementById(
        "invoiceSearch"
      )?.value ||
      ""
    )
      .toLowerCase()
      .trim();

  const paymentFilter =
    document.getElementById(
      "invoiceStatusFilter"
    )?.value ||
    "all";

  const waFilter =
    document.getElementById(
      "invoiceWaFilter"
    )?.value ||
    "all";

  const all =
    [...db.invoices].sort(
      (a, b) =>
        b.createdAt -
        a.createdAt
    );

  const filtered =
    all.filter(
      (invoice) => {

        const text =
          `${invoice.invoiceNumber} ${invoice.tenantNameSnapshot} ${invoice.roomSnapshot} ${invoice.bedSnapshot}`
            .toLowerCase();

        const paymentOk =
          paymentFilter ===
            "all" ||
          (
            paymentFilter ===
              "paid" &&
            invoice.isPaid
          ) ||
          (
            paymentFilter ===
              "unpaid" &&
            !invoice.isPaid
          );

        const whatsAppOk =
          waFilter ===
            "all" ||
          invoice.whatsappStatus ===
            waFilter;

        return (
          (
            !query ||
            text.includes(
              query
            )
          ) &&
          paymentOk &&
          whatsAppOk
        );
      }
    );

  const invoiceCount =
    document.getElementById(
      "invoiceCount"
    );

  const invoiceSent =
    document.getElementById(
      "invoiceSent"
    );

  const invoicePending =
    document.getElementById(
      "invoicePending"
    );

  const invoicePaid =
    document.getElementById(
      "invoicePaid"
    );

  const invoiceUnpaid =
    document.getElementById(
      "invoiceUnpaid"
    );

  if (invoiceCount) {
    invoiceCount.textContent =
      all.length;
  }

  if (invoiceSent) {
    invoiceSent.textContent =
      all.filter(
        (invoice) =>
          invoice.whatsappStatus ===
          "sent"
      ).length;
  }

  if (invoicePending) {
    invoicePending.textContent =
      all.filter(
        (invoice) =>
          invoice.whatsappStatus !==
          "sent"
      ).length;
  }

  if (invoicePaid) {
    invoicePaid.textContent =
      all.filter(
        (invoice) =>
          invoice.isPaid
      ).length;
  }

  if (invoiceUnpaid) {
    invoiceUnpaid.textContent =
      all.filter(
        (invoice) =>
          !invoice.isPaid
      ).length;
  }

  const wrap =
    document.getElementById(
      "invoiceTableWrap"
    );

  if (!wrap) {
    return;
  }

  wrap.innerHTML =
    filtered.length
      ? `
        <table class="data-table">

          <thead>

            <tr>

              <th>Floor</th>
              <th>Room</th>
              <th>Bed</th>
              <th>Tenant</th>
              <th>WhatsApp</th>
              <th>Amount</th>
              <th>Invoice</th>
              <th>Payment</th>
              <th>WhatsApp</th>
              <th>Actions</th>

            </tr>

          </thead>

          <tbody>

            ${filtered
              .map(
                (invoice) => `
                  <tr>

                    <td>
                      F${
                        invoice.floorSnapshot
                      }
                    </td>

                    <td>
                      ${
                        invoice.roomSnapshot
                      }
                    </td>

                    <td>
                      ${
                        invoice.bedSnapshot
                      }
                    </td>

                    <td class="name-cell">

                      <strong>
                        ${escapeHtml(
                          invoice.tenantNameSnapshot
                        )}
                      </strong>

                      <small>
                        ${
                          invoice.billingLabel
                        }
                      </small>

                    </td>

                    <td>
                      ${escapeHtml(
                        invoice.tenantMobileSnapshot
                      )}
                    </td>

                    <td>

                      <strong>
                        ${money(
                          invoice.totalAmount
                        )}
                      </strong>

                    </td>

                    <td>

                      <strong>
                        ${
                          invoice.invoiceNumber
                        }
                      </strong>

                    </td>

                    <td>

                      <span
                        class="status-chip ${
                          invoice.isPaid
                            ? "chip-paid"
                            : "chip-unpaid"
                        }"
                      >
                        ${
                          invoice.isPaid
                            ? "Paid"
                            : "Unpaid"
                        }
                      </span>

                    </td>

                    <td>

                      <span
                        class="status-chip ${
                          invoice.whatsappStatus ===
                          "sent"
                            ? "chip-sent"
                            : "chip-pending"
                        }"
                      >
                        ${
                          invoice.whatsappStatus ===
                          "sent"
                            ? "Sent"
                            : "Pending"
                        }
                      </span>

                    </td>

                    <td>

                      <div class="actions">

                        <button
                          class="small-btn"
                          onclick="viewInvoice(
                            '${invoice.id}'
                          )"
                        >
                          View
                        </button>

                        <button
                          class="small-btn whatsapp"
                          onclick="openWhatsApp(
                            '${invoice.id}'
                          )"
                        >
                          ${
                            invoice.whatsappStatus ===
                            "sent"
                              ? "Send Again"
                              : "Send WhatsApp"
                          }
                        </button>

                        <button
                          class="small-btn"
                          onclick="togglePaid(
                            '${invoice.id}'
                          )"
                        >
                          ${
                            invoice.isPaid
                              ? "Undo Paid"
                              : "Mark Paid"
                          }
                        </button>

                      </div>

                    </td>

                  </tr>
                `
              )
              .join("")}

          </tbody>

        </table>
      `
      : `
        <div class="empty">

          <strong>
            No invoices found
          </strong>

          Generate this month's bills
          or adjust your filters.

        </div>
      `;
}

/* =========================================================
   PAST TENANTS
   ========================================================= */

function renderPastTenants() {

  const query =
    (
      document.getElementById(
        "pastSearch"
      )?.value ||
      ""
    )
      .toLowerCase()
      .trim();

  const rows =
    db.tenants
      .filter(
        (tenant) =>
          tenant.status ===
          "vacated"
      )
      .filter(
        (tenant) =>
          `${tenant.fullName} ${tenant.room} ${tenant.bedNumber} ${tenant.mobileNumber}`
            .toLowerCase()
            .includes(
              query
            )
      )
      .sort(
        (a, b) =>
          String(
            b.vacateDate ||
              ""
          ).localeCompare(
            String(
              a.vacateDate ||
                ""
            )
          )
      );

  const wrap =
    document.getElementById(
      "pastTableWrap"
    );

  if (!wrap) {
    return;
  }

  wrap.innerHTML =
    rows.length
      ? `
        <table class="data-table">

          <thead>

            <tr>

              <th>Name</th>
              <th>Previous Location</th>
              <th>WhatsApp</th>
              <th>Joining</th>
              <th>Vacated</th>
              <th>Invoices</th>

            </tr>

          </thead>

          <tbody>

            ${rows
              .map(
                (tenant) => `
                  <tr>

                    <td class="name-cell">

                      <strong>
                        ${escapeHtml(
                          tenant.fullName
                        )}
                      </strong>

                      <small>
                        Archived
                      </small>

                    </td>

                    <td>
                      F${
                        tenant.floor
                      }
                      ·
                      ${
                        tenant.room
                      }
                      · Bed
                      ${
                        tenant.bedNumber
                      }
                    </td>

                    <td>
                      ${escapeHtml(
                        tenant.mobileNumber
                      )}
                    </td>

                    <td>
                      ${formatDate(
                        tenant.joiningDate
                      )}
                    </td>

                    <td>
                      ${formatDate(
                        tenant.vacateDate
                      )}
                    </td>

                    <td>
                      ${
                        db.invoices.filter(
                          (invoice) =>
                            invoice.tenantId ===
                            tenant.id
                        ).length
                      }
                    </td>

                  </tr>
                `
              )
              .join("")}

          </tbody>

        </table>
      `
      : `
        <div class="empty">

          <strong>
            No past tenants
          </strong>

          Vacated tenant records
          will appear here.

        </div>
      `;
}

/* =========================================================
   SETTINGS
   ========================================================= */

function fillSettings() {

  const fields = {
    setPgName:
      db.settings.pgName,

    setOwnerName:
      db.settings.ownerName,

    setOwnerPhone:
      db.settings.ownerPhone,

    setUpi:
      db.settings.upi,

    setAddress:
      db.settings.address,

    setRent:
      db.settings.defaultRent,

    setMaintenance:
      db.settings.defaultMaintenance,

    setDueDay:
      db.settings.dueDay
  };

  Object.entries(
    fields
  ).forEach(
    ([id, value]) => {

      const element =
        document.getElementById(
          id
        );

      if (
        element &&
        document.activeElement !==
          element
      ) {
        element.value =
          value;
      }
    }
  );
}

function saveSettings(
  event
) {

  event.preventDefault();

  db.settings.pgName =
    document
      .getElementById(
        "setPgName"
      )
      .value.trim() ||
    "JS Men's PG";

  db.settings.ownerName =
    document
      .getElementById(
        "setOwnerName"
      )
      .value.trim() ||
    "Owner";

  db.settings.ownerPhone =
    document
      .getElementById(
        "setOwnerPhone"
      )
      .value.trim();

  db.settings.upi =
    document
      .getElementById(
        "setUpi"
      )
      .value.trim();

  db.settings.address =
    document
      .getElementById(
        "setAddress"
      )
      .value.trim();

  db.settings.defaultRent =
    Number(
      document.getElementById(
        "setRent"
      ).value
    ) || 0;

  db.settings.defaultMaintenance =
    Number(
      document.getElementById(
        "setMaintenance"
      ).value
    ) || 0;

  db.settings.dueDay =
    Math.max(
      1,
      Math.min(
        28,
        Number(
          document.getElementById(
            "setDueDay"
          ).value
        ) || 5
      )
    );

  saveData();

  renderAll();

  toast(
    "Settings saved"
  );
}

function renderStructureSummary() {

  const target =
    document.getElementById(
      "structureSummary"
    );

  if (!target) {
    return;
  }

  const totalRooms =
    db.structure.floors.reduce(
      (sum, floor) =>
        sum +
        floor.rooms.length,
      0
    );

  const c =
    counts();

  target.innerHTML = `
    <div class="structure-box">

      <strong>
        ${
          db.structure.floors.length
        }
        Floors
      </strong>

      <span>
        Floor 1 to Floor
        ${
          db.structure.floors.length
        }
      </span>

    </div>

    <div class="structure-box">

      <strong>
        ${totalRooms}
        Rooms
      </strong>

      <span>
        Rooms are grouped
        floor-wise.
      </span>

    </div>

    <div class="structure-box">

      <strong>
        ${c.total}
        Beds
      </strong>

      <span>
        ${c.vacant} vacant ·
        ${c.occupied} occupied ·
        ${c.notice} notice.
      </span>

    </div>

    <div class="structure-box">

      <strong>
        Normal Fee
      </strong>

      <span>
        ${money(
          db.settings.defaultRent
        )}
        rent +
        ${money(
          db.settings
            .defaultMaintenance
        )}
        maintenance.
      </span>

    </div>
  `;
}

/* =========================================================
   MODAL
   ========================================================= */

function openModal(
  html
) {

  const backdrop =
    document.getElementById(
      "modalBackdrop"
    );

  const modal =
    document.getElementById(
      "modal"
    );

  if (
    !backdrop ||
    !modal
  ) {
    return;
  }

  modal.innerHTML =
    html;

  backdrop.classList.remove(
    "hidden"
  );
}

function closeModal() {

  const backdrop =
    document.getElementById(
      "modalBackdrop"
    );

  const modal =
    document.getElementById(
      "modal"
    );

  if (backdrop) {
    backdrop.classList.add(
      "hidden"
    );
  }

  if (modal) {
    modal.innerHTML =
      "";
  }

  wizard.open =
    false;
}

/* =========================================================
   UI EVENT SETUP
   ========================================================= */

function setupUI() {

  document
    .getElementById(
      "logoutBtn"
    )
    ?.addEventListener(
      "click",
      firebaseLogout
    );

  document
    .getElementById(
      "mobileMenuBtn"
    )
    ?.addEventListener(
      "click",
      () => {
        document
          .getElementById(
            "sidebar"
          )
          ?.classList.toggle(
            "open"
          );
      }
    );

  document
    .querySelectorAll(
      ".nav-item"
    )
    .forEach(
      (button) => {

        button.addEventListener(
          "click",
          () => {

            switchSection(
              button.dataset.section
            );

            document
              .getElementById(
                "sidebar"
              )
              ?.classList.remove(
                "open"
              );
          }
        );
      }
    );

  document
    .getElementById(
      "topAddTenantBtn"
    )
    ?.addEventListener(
      "click",
      openAddTenantWizard
    );

  document
    .getElementById(
      "dashboardAddTenant"
    )
    ?.addEventListener(
      "click",
      openAddTenantWizard
    );

  document
    .getElementById(
      "tenantAddBtn"
    )
    ?.addEventListener(
      "click",
      openAddTenantWizard
    );

  document
    .getElementById(
      "quickInvoiceBtn"
    )
    ?.addEventListener(
      "click",
      () => {

        switchSection(
          "invoices"
        );

        generateMonthlyBills();
      }
    );

  document
    .getElementById(
      "dashboardGoInvoices"
    )
    ?.addEventListener(
      "click",
      () => {

        switchSection(
          "invoices"
        );
      }
    );

  document
    .getElementById(
      "dashboardGenerate"
    )
    ?.addEventListener(
      "click",
      () => {

        switchSection(
          "invoices"
        );

        generateMonthlyBills();
      }
    );

  document
    .getElementById(
      "generateBillsBtn"
    )
    ?.addEventListener(
      "click",
      generateMonthlyBills
    );

  document
    .getElementById(
      "sendAllBtn"
    )
    ?.addEventListener(
      "click",
      startSendAll
    );

  document
    .getElementById(
      "tenantSearch"
    )
    ?.addEventListener(
      "input",
      renderTenants
    );

  document
    .getElementById(
      "invoiceSearch"
    )
    ?.addEventListener(
      "input",
      renderInvoices
    );

  document
    .getElementById(
      "invoiceStatusFilter"
    )
    ?.addEventListener(
      "change",
      renderInvoices
    );

  document
    .getElementById(
      "invoiceWaFilter"
    )
    ?.addEventListener(
      "change",
      renderInvoices
    );

  document
    .getElementById(
      "pastSearch"
    )
    ?.addEventListener(
      "input",
      renderPastTenants
    );

  document
    .getElementById(
      "settingsForm"
    )
    ?.addEventListener(
      "submit",
      saveSettings
    );

  document
    .getElementById(
      "modalBackdrop"
    )
    ?.addEventListener(
      "click",
      (event) => {
        if (
          event.target.id ===
          "modalBackdrop"
        ) {
          closeModal();
        }
      }
    );

  window.addEventListener(
    "keydown",
    (event) => {
      if (
        event.key ===
        "Escape"
      ) {
        closeModal();
      }
    }
  );
}

/* =========================================================
   START
   ========================================================= */

setupUI();

showLogin();

initFirebaseFirestore();

initFirebaseAuth();

/* =========================================================
   GLOBAL FUNCTIONS
   Needed because some HTML buttons use onclick=""
   ========================================================= */

window.selectFloor =
  selectFloor;

window.openRoom =
  openRoom;

window.goFloorRoot =
  goFloorRoot;

window.goRoomList =
  goRoomList;

window.addBed =
  addBed;

window.removeBed =
  removeBed;

window.openBed =
  openBed;

window.openAddTenantWizard =
  openAddTenantWizard;

window.startTenantWizardAtBed =
  startTenantWizardAtBed;

window.closeTenantWizard =
  closeTenantWizard;

window.wizardSelectFloor =
  wizardSelectFloor;

window.wizardSelectRoom =
  wizardSelectRoom;

window.wizardSelectBed =
  wizardSelectBed;

window.wizardNext =
  wizardNext;

window.wizardBack =
  wizardBack;

window.openTenant =
  openTenant;

window.editTenant =
  editTenant;

window.giveNotice =
  giveNotice;

window.cancelNotice =
  cancelNotice;

window.markVacated =
  markVacated;

window.generateMonthlyBills =
  generateMonthlyBills;

window.openWhatsApp =
  openWhatsApp;

window.startSendAll =
  startSendAll;

window.showSendAllModal =
  showSendAllModal;

window.openWhatsAppAndNext =
  openWhatsAppAndNext;

window.togglePaid =
  togglePaid;

window.viewInvoice =
  viewInvoice;

window.closeModal =
  closeModal;