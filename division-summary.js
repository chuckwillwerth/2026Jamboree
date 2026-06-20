const ROSTER_URL = "./attendancelist.csv";
const STORAGE_KEY = "jamboree-attendance-local";

const state = {
  roster: [],
  attendance: new Map(),
  eventId: window.ATTENDANCE_APP_CONFIG?.eventId || "2026-jamboree",
};

const elements = {
  syncBanner: document.querySelector("#syncBanner"),
  summaryDescription: document.querySelector("#summaryDescription"),
  divisionSummary: document.querySelector("#divisionSummary"),
  divisionSummaryTemplate: document.querySelector("#divisionSummaryTemplate"),
};

initialize().catch((error) => {
  console.error(error);
  showBanner(
    "local",
    "The division summary loaded, but live syncing could not start. This device is using local storage only."
  );
  render();
});

async function initialize() {
  state.roster = await loadRoster();
  state.attendance = loadLocalAttendance();
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

      return {
        id: createRosterId(index, division, team, first, last, role),
        division,
        role,
      };
    })
    .sort((left, right) => left.division.localeCompare(right.division, undefined, { numeric: true }));
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
    render();
  }, (error) => {
    console.error("Firebase snapshot sync failed, switching to local mode.", error);
    showBanner("local", syncStoppedMessage);
    render();
  });
}

function render() {
  const divisionSummaries = summarizeByDivision();
  elements.summaryDescription.textContent = `${divisionSummaries.length} division${divisionSummaries.length === 1 ? "" : "s"}`;
  elements.divisionSummary.replaceChildren();

  if (divisionSummaries.length === 0) {
    const emptyState = document.createElement("div");
    emptyState.className = "empty-state";
    emptyState.textContent = "No divisions are available yet.";
    elements.divisionSummary.appendChild(emptyState);
    return;
  }

  divisionSummaries.forEach((summary) => {
    const card = elements.divisionSummaryTemplate.content.firstElementChild.cloneNode(true);
    card.querySelector(".summary-title").textContent = summary.division;
    card.querySelector(".division-player-present-count").textContent = String(summary.playerPresentCount);
    card.querySelector(".division-player-remaining-count").textContent = String(summary.playerRemainingCount);
    card.querySelector(".division-player-total-count").textContent = String(summary.playerTotalCount);
    card.querySelector(".division-coach-present-count").textContent = String(summary.coachPresentCount);
    card.querySelector(".division-coach-remaining-count").textContent = String(summary.coachRemainingCount);
    card.querySelector(".division-coach-total-count").textContent = String(summary.coachTotalCount);
    elements.divisionSummary.appendChild(card);
  });
}

function summarizeByDivision() {
  const summaries = new Map();

  state.roster.forEach((entry) => {
    if (!summaries.has(entry.division)) {
      summaries.set(entry.division, {
        division: entry.division,
        totalCount: 0,
        presentCount: 0,
        playerTotalCount: 0,
        playerPresentCount: 0,
        coachTotalCount: 0,
        coachPresentCount: 0,
      });
    }

    const summary = summaries.get(entry.division);
    const isPresent = state.attendance.has(entry.id);
    const isCoach = entry.role?.toLowerCase() === "coach";

    summary.totalCount += 1;
    if (isPresent) {
      summary.presentCount += 1;
    }

    if (isCoach) {
      summary.coachTotalCount += 1;
      if (isPresent) {
        summary.coachPresentCount += 1;
      }
    } else {
      summary.playerTotalCount += 1;
      if (isPresent) {
        summary.playerPresentCount += 1;
      }
    }
  });

  return Array.from(summaries.values()).map((summary) => ({
    ...summary,
    remainingCount: Math.max(summary.totalCount - summary.presentCount, 0),
    playerRemainingCount: Math.max(summary.playerTotalCount - summary.playerPresentCount, 0),
    coachRemainingCount: Math.max(summary.coachTotalCount - summary.coachPresentCount, 0),
  }));
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
