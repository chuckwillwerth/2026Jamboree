const ROSTER_URL = "./attendancelist.csv";
const STORAGE_KEY = "jamboree-attendance-local";

const state = {
  roster: [],
  attendance: new Map(),
  division: "",
  team: "",
  eventId: window.ATTENDANCE_APP_CONFIG?.eventId || "2026-jamboree",
};

const elements = {
  syncBanner: document.querySelector("#syncBanner"),
  divisionFilters: document.querySelector("#divisionFilters"),
  teamFilters: document.querySelector("#teamFilters"),
  resultsSummary: document.querySelector("#resultsSummary"),
  shirtList: document.querySelector("#shirtList"),
  shirtListTemplate: document.querySelector("#shirtListTemplate"),
};

initialize().catch((error) => {
  console.error(error);
  showBanner(
    "local",
    "The shirt handout list loaded, but live syncing could not start. This device is using local storage only."
  );
  render();
});

async function initialize() {
  state.roster = await loadRoster();
  state.attendance = loadLocalAttendance();
  setDefaultSelection();
  renderFilters();
  render();
  await setupAttendanceSync();
  render();
}

async function loadRoster() {
  const response = await fetch(ROSTER_URL, { cache: "no-store" });
  if (!response.ok) {
    throw new Error("Could not load roster CSV.");
  }

  const csvText = await response.text();
  const rows = parseCsv(csvText);
  const [headerRow, ...dataRows] = rows;

  if (!headerRow) {
    throw new Error("Roster CSV is empty.");
  }

  const headers = headerRow.map((value) => normalizeHeader(value));

  return dataRows
    .filter((row) => row.some((cell) => cell.trim() !== ""))
    .map((row, index) => {
      const entry = Object.fromEntries(headers.map((header, columnIndex) => [header, row[columnIndex] || ""]));
      const division = entry.division?.trim() || "Unknown";
      const team = entry.teamCoach?.trim() || "Unknown";
      const first = entry.first?.trim() || "";
      const last = entry.last?.trim() || "";
      const role = entry.playerOrCoach?.trim() || "Unknown";
      const shirtSize = entry.shirtSize?.trim() || "Not listed";
      const fullName = [first, last].filter(Boolean).join(" ") || "Unknown";

      return {
        id: createRosterId(index, division, team, first, last, role),
        division,
        team,
        role,
        shirtSize,
        fullName,
        last,
        first,
      };
    })
    .filter((entry) => normalizeText(entry.role) === "player");
}

function setDefaultSelection() {
  const divisions = getDivisions();
  state.division = divisions[0] || "";
  const teams = getTeamsForDivision(state.division);
  state.team = teams[0] || "";
}

async function setupAttendanceSync() {
  const firebaseConfig = window.ATTENDANCE_APP_CONFIG?.firebase;
  if (!firebaseConfig) {
    showBanner(
      "local",
      "Using this device only. Add Firebase config in firebase-config.js to sync attendance across multiple phones."
    );
    return;
  }

  const firebaseModules = await import("https://www.gstatic.com/firebasejs/11.9.1/firebase-app.js");
  const authModules = await import("https://www.gstatic.com/firebasejs/11.9.1/firebase-auth.js");
  const firestoreModules = await import("https://www.gstatic.com/firebasejs/11.9.1/firebase-firestore.js");

  const app = firebaseModules.initializeApp(firebaseConfig);
  const auth = authModules.getAuth(app);
  const db = firestoreModules.getFirestore(app);

  await authModules.signInAnonymously(auth);

  const attendanceCollection = firestoreModules.collection(db, "events", state.eventId, "attendance");
  const syncStoppedMessage =
    "Live syncing stopped. This device is using local storage only until Firebase access is working again.";

  firestoreModules.onSnapshot(attendanceCollection, (snapshot) => {
    const nextAttendance = new Map();
    snapshot.forEach((documentSnapshot) => {
      nextAttendance.set(documentSnapshot.id, documentSnapshot.data());
    });
    state.attendance = nextAttendance;
    persistLocalAttendance(state.attendance);
    showBanner("firebase", "Live sync is on. Check-ins on one phone will appear on the others.");
    render();
  }, (error) => {
    console.error("Firebase snapshot sync failed, switching to local mode.", error);
    showBanner("local", syncStoppedMessage);
    render();
  });
}

function renderFilters() {
  const divisions = getDivisions();
  renderChipGroup(elements.divisionFilters, divisions, state.division, (value) => {
    state.division = value;
    const teams = getTeamsForDivision(state.division);
    state.team = teams[0] || "";
    renderFilters();
    render();
  });

  const teams = getTeamsForDivision(state.division);
  renderChipGroup(elements.teamFilters, teams, state.team, (value) => {
    state.team = value;
    renderFilters();
    render();
  });
}

function renderChipGroup(container, values, selectedValue, onSelect) {
  container.replaceChildren();

  values.forEach((value) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "chip";
    button.textContent = value;
    button.setAttribute("aria-pressed", String(value === selectedValue));
    button.addEventListener("click", () => onSelect(value));
    container.appendChild(button);
  });
}

function render() {
  const filteredRoster = getFilteredRoster();
  elements.resultsSummary.textContent = `${filteredRoster.length} player${filteredRoster.length === 1 ? "" : "s"}`;
  elements.shirtList.replaceChildren();

  if (!state.division || !state.team) {
    const emptyState = document.createElement("div");
    emptyState.className = "empty-state";
    emptyState.textContent = "No division and team data are available yet.";
    elements.shirtList.appendChild(emptyState);
    return;
  }

  if (filteredRoster.length === 0) {
    const emptyState = document.createElement("div");
    emptyState.className = "empty-state";
    emptyState.textContent = "No players found for this team.";
    elements.shirtList.appendChild(emptyState);
    return;
  }

  filteredRoster.forEach((entry) => {
    const row = elements.shirtListTemplate.content.firstElementChild.cloneNode(true);
    const isPresent = state.attendance.has(entry.id);
    row.dataset.present = String(isPresent);
    row.querySelector(".shirt-row-name").textContent = entry.fullName;
    row.querySelector(".shirt-row-meta").textContent = isPresent ? "Present" : "Not here yet";
    row.querySelector(".shirt-size-pill").textContent = entry.shirtSize;
    elements.shirtList.appendChild(row);
  });
}

function getDivisions() {
  return [...new Set(state.roster.map((entry) => entry.division))];
}

function getTeamsForDivision(division) {
  if (!division) {
    return [];
  }

  return [...new Set(state.roster.filter((entry) => entry.division === division).map((entry) => entry.team))];
}

function getFilteredRoster() {
  return state.roster
    .filter((entry) => entry.division === state.division)
    .filter((entry) => entry.team === state.team)
    .sort((left, right) => {
      const leftPresent = state.attendance.has(left.id) ? 1 : 0;
      const rightPresent = state.attendance.has(right.id) ? 1 : 0;

      if (leftPresent !== rightPresent) {
        return rightPresent - leftPresent;
      }

      return left.last.localeCompare(right.last) || left.first.localeCompare(right.first);
    });
}

function normalizeHeader(value) {
  return value
    .trim()
    .replace(/-([a-z])/gi, (_, letter) => letter.toUpperCase())
    .replace(/[^a-zA-Z0-9]/g, "");
}

function createRosterId(index, division, team, first, last, role) {
  return [index, division, team, first, last, role]
    .join("-")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function normalizeText(value) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function parseCsv(text) {
  const rows = [];
  let currentValue = "";
  let currentRow = [];
  let insideQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const nextCharacter = text[index + 1];

    if (character === '"') {
      if (insideQuotes && nextCharacter === '"') {
        currentValue += '"';
        index += 1;
      } else {
        insideQuotes = !insideQuotes;
      }
      continue;
    }

    if (character === "," && !insideQuotes) {
      currentRow.push(currentValue);
      currentValue = "";
      continue;
    }

    if ((character === "\n" || character === "\r") && !insideQuotes) {
      if (character === "\r" && nextCharacter === "\n") {
        index += 1;
      }
      currentRow.push(currentValue);
      rows.push(currentRow);
      currentRow = [];
      currentValue = "";
      continue;
    }

    currentValue += character;
  }

  if (currentValue !== "" || currentRow.length > 0) {
    currentRow.push(currentValue);
    rows.push(currentRow);
  }

  return rows;
}

function loadLocalAttendance() {
  try {
    const rawValue = window.localStorage.getItem(STORAGE_KEY);
    if (!rawValue) {
      return new Map();
    }

    return new Map(JSON.parse(rawValue));
  } catch (error) {
    console.error(error);
    return new Map();
  }
}

function persistLocalAttendance(attendanceMap) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(attendanceMap.entries())));
}

function showBanner(stateName, message) {
  elements.syncBanner.dataset.state = stateName;
  elements.syncBanner.textContent = message;
}
