const ROSTER_URL = "./attendancelist.csv";
const STORAGE_KEY = "jamboree-attendance-local";
const RESULT_LIMIT = 60;

const state = {
  roster: [],
  attendance: new Map(),
  division: "All",
  team: "All",
  role: "All",
  search: "",
  mode: "local",
  eventId: window.ATTENDANCE_APP_CONFIG?.eventId || "2026-jamboree",
  attendanceService: null,
};

const elements = {
  syncBanner: document.querySelector("#syncBanner"),
  searchInput: document.querySelector("#searchInput"),
  divisionFilters: document.querySelector("#divisionFilters"),
  teamFilterGroup: document.querySelector("#teamFilterGroup"),
  teamFilters: document.querySelector("#teamFilters"),
  roleFilters: document.querySelector("#roleFilters"),
  presentCount: document.querySelector("#presentCount"),
  remainingCount: document.querySelector("#remainingCount"),
  totalCount: document.querySelector("#totalCount"),
  resultsSummary: document.querySelector("#resultsSummary"),
  clearSearchButton: document.querySelector("#clearSearchButton"),
  rosterList: document.querySelector("#rosterList"),
  rosterCardTemplate: document.querySelector("#rosterCardTemplate"),
};

initialize().catch((error) => {
  console.error(error);
  state.mode = "local";
  state.attendanceService = createLocalAttendanceService();
  showBanner(
    "local",
    "The roster loaded, but live syncing could not start. This device is using local storage only."
  );
  render();
});

async function initialize() {
  bindEvents();
  state.roster = await loadRoster();
  state.attendance = loadLocalAttendance();
  state.attendanceService = createLocalAttendanceService();
  renderFilters();
  render();
  await setupAttendanceSync();
  render();
}

function bindEvents() {
  elements.searchInput.addEventListener("input", (event) => {
    state.search = normalizeText(event.target.value);
    render();
  });

  elements.clearSearchButton.addEventListener("click", () => {
    state.search = "";
    state.division = "All";
    state.team = "All";
    state.role = "All";
    elements.searchInput.value = "";
    renderFilters();
    render();
    elements.searchInput.focus();
  });

  elements.rosterList.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-roster-id]");
    if (!button) {
      return;
    }

    const rosterId = button.dataset.rosterId;
    const isPresent = state.attendance.has(rosterId);

    button.disabled = true;
    try {
      if (isPresent) {
        await state.attendanceService.clear(rosterId);
      } else {
        const person = state.roster.find((entry) => entry.id === rosterId);
        await state.attendanceService.markPresent(person);
      }
      navigator.vibrate?.(30);
    } catch (error) {
      console.error(error);
      window.alert("Attendance could not be updated. Please try again.");
    } finally {
      button.disabled = false;
    }
  });
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
      const fullName = [first, last].filter(Boolean).join(" ");

      return {
        id: createRosterId(index, division, team, first, last, role),
        division,
        team,
        first,
        last,
        fullName,
        role,
        shirtSize,
        searchIndex: normalizeText(`${division} ${team} ${first} ${last} ${fullName} ${role}`),
      };
    })
    .sort(compareRosterEntries);
}

async function setupAttendanceSync() {
  const firebaseConfig = window.ATTENDANCE_APP_CONFIG?.firebase;
  if (!firebaseConfig) {
    enableLocalMode(
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
  state.attendanceService = {
    markPresent: async (person) => {
      await firestoreModules.setDoc(
        firestoreModules.doc(attendanceCollection, person.id),
        {
          rosterId: person.id,
          division: person.division,
          team: person.team,
          first: person.first,
          last: person.last,
          role: person.role,
          checkedInAt: firestoreModules.serverTimestamp(),
        },
        { merge: true }
      );
    },
    clear: async (rosterId) => {
      await firestoreModules.deleteDoc(firestoreModules.doc(attendanceCollection, rosterId));
    },
  };

  firestoreModules.onSnapshot(attendanceCollection, (snapshot) => {
    const nextAttendance = new Map();
    snapshot.forEach((documentSnapshot) => {
      nextAttendance.set(documentSnapshot.id, documentSnapshot.data());
    });
    state.attendance = nextAttendance;
    persistLocalAttendance(state.attendance);
    render();
  });

  state.mode = "firebase";
  showBanner("firebase", "Live sync is on. Check-ins on one phone will appear on the others.");
}

function enableLocalMode(message) {
  state.mode = "local";
  state.attendanceService = createLocalAttendanceService();
  showBanner("local", message);
}

function createLocalAttendanceService() {
  return {
    markPresent: async (person) => {
      state.attendance.set(person.id, {
        rosterId: person.id,
        division: person.division,
        team: person.team,
        first: person.first,
        last: person.last,
        role: person.role,
        checkedInAt: new Date().toISOString(),
      });
      persistLocalAttendance(state.attendance);
      render();
    },
    clear: async (rosterId) => {
      state.attendance.delete(rosterId);
      persistLocalAttendance(state.attendance);
      render();
    },
  };
}

function renderFilters() {
  renderChipGroup(elements.divisionFilters, ["All", ...new Set(state.roster.map((entry) => entry.division))], state.division, (value) => {
    state.division = value;
    state.team = "All";
    renderFilters();
    render();
  });

  const divisionTeams = state.division === "All"
    ? []
    : [...new Set(state.roster.filter((entry) => entry.division === state.division).map((entry) => entry.team))];

  if (divisionTeams.length > 1) {
    elements.teamFilterGroup.hidden = false;
    renderChipGroup(elements.teamFilters, ["All", ...divisionTeams], state.team, (value) => {
      state.team = value;
      renderFilters();
      render();
    });
  } else {
    elements.teamFilterGroup.hidden = true;
  }

  renderChipGroup(elements.roleFilters, ["All", "Player", "Coach"], state.role, (value) => {
    state.role = value;
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
  const presentCount = state.attendance.size;

  elements.presentCount.textContent = String(presentCount);
  elements.totalCount.textContent = String(state.roster.length);
  elements.remainingCount.textContent = String(Math.max(state.roster.length - presentCount, 0));
  elements.resultsSummary.textContent = `${filteredRoster.length} match${filteredRoster.length === 1 ? "" : "es"}`;

  elements.rosterList.replaceChildren();

  if (filteredRoster.length === 0) {
    const emptyState = document.createElement("div");
    emptyState.className = "empty-state";
    emptyState.textContent = "No one matches that search yet. Try a different name, team, or division.";
    elements.rosterList.appendChild(emptyState);
    return;
  }

  filteredRoster.slice(0, RESULT_LIMIT).forEach((entry) => {
    const card = elements.rosterCardTemplate.content.firstElementChild.cloneNode(true);
    const isPresent = state.attendance.has(entry.id);
    card.dataset.present = String(isPresent);
    card.querySelector(".person-name").textContent = entry.fullName;
    card.querySelector(".person-meta").textContent = `${entry.team} • ${entry.role}`;
    card.querySelector(".status-pill").textContent = isPresent ? "Present" : "Not here yet";
    card.querySelector(".detail-division").textContent = entry.division;
    card.querySelector(".detail-team").textContent = entry.team;
    card.querySelector(".detail-role").textContent = entry.role;
    card.querySelector(".detail-shirt").textContent = entry.shirtSize;

    const actionButton = card.querySelector(".checkin-button");
    actionButton.dataset.rosterId = entry.id;
    actionButton.textContent = isPresent ? "Undo check-in" : "Mark present";

    elements.rosterList.appendChild(card);
  });

  if (filteredRoster.length > RESULT_LIMIT) {
    const note = document.createElement("div");
    note.className = "empty-state";
    note.textContent = `Showing the first ${RESULT_LIMIT} matches. Keep typing to narrow the list faster.`;
    elements.rosterList.appendChild(note);
  }
}

function getFilteredRoster() {
  return state.roster
    .filter((entry) => state.division === "All" || entry.division === state.division)
    .filter((entry) => state.team === "All" || entry.team === state.team)
    .filter((entry) => state.role === "All" || entry.role === state.role)
    .filter((entry) => state.search === "" || entry.searchIndex.includes(state.search))
    .sort((left, right) => {
      const leftPresent = state.attendance.has(left.id) ? 1 : 0;
      const rightPresent = state.attendance.has(right.id) ? 1 : 0;
      if (leftPresent !== rightPresent) {
        return leftPresent - rightPresent;
      }

      const leftSearchScore = scoreEntry(left, state.search);
      const rightSearchScore = scoreEntry(right, state.search);
      if (leftSearchScore !== rightSearchScore) {
        return rightSearchScore - leftSearchScore;
      }

      return compareRosterEntries(left, right);
    });
}

function scoreEntry(entry, query) {
  if (!query) {
    return 0;
  }

  if (normalizeText(entry.fullName) === query) {
    return 5;
  }

  if (normalizeText(entry.last).startsWith(query) || normalizeText(entry.first).startsWith(query)) {
    return 4;
  }

  if (normalizeText(entry.team).includes(query)) {
    return 3;
  }

  if (entry.searchIndex.includes(query)) {
    return 2;
  }

  return 1;
}

function compareRosterEntries(left, right) {
  return (
    left.division.localeCompare(right.division) ||
    left.team.localeCompare(right.team) ||
    left.last.localeCompare(right.last) ||
    left.first.localeCompare(right.first)
  );
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