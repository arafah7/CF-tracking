const storageKey = "cfTrackerState.v1";

const statusLabels = {
  solved: "Solved",
  attempting: "Attempting",
  not_solved: "Not solved",
  understood: "Understood",
  intuition: "Understood with intuition",
};

const statusOrder = ["solved", "attempting", "not_solved", "understood", "intuition"];

function createId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

const sample1045 = {
  title: "Codeforces Round 1045 (Div. 2)",
  contestId: "2134",
  date: "2025-08-26",
  duration: "02:00",
  problems: [
    "A. Painting With Two Colors",
    "B. Add 0 or K",
    "C. Even Larger",
    "D. Sliding Tree",
    "E. Power Boxes",
    "F. Permutation Oddness",
  ],
};

let state = loadState();
let currentUser = state.sessionEmail ? state.users[state.sessionEmail] : null;
let authMode = "signin";
let activeSection = "overview";

const $ = (id) => document.getElementById(id);

const elements = {
  authView: $("authView"),
  dashboardView: $("dashboardView"),
  authForm: $("authForm"),
  authTitle: $("authTitle"),
  authError: $("authError"),
  emailInput: $("emailInput"),
  passwordInput: $("passwordInput"),
  toggleAuthMode: $("toggleAuthMode"),
  userEmail: $("userEmail"),
  signOutButton: $("signOutButton"),
  sectionTitle: $("sectionTitle"),
  navButtons: Array.from(document.querySelectorAll(".nav-button")),
  openContestModal: $("openContestModal"),
  closeContestModal: $("closeContestModal"),
  contestModal: $("contestModal"),
  contestForm: $("contestForm"),
  seed1045Button: $("seed1045Button"),
  problemSearch: $("problemSearch"),
  statusFilter: $("statusFilter"),
  roundInput: $("roundInput"),
  divisionInput: $("divisionInput"),
  importContestButton: $("importContestButton"),
  importStatus: $("importStatus"),
};

init();

function init() {
  bindEvents();
  renderApp();
}

function bindEvents() {
  elements.authForm.addEventListener("submit", handleAuth);
  elements.toggleAuthMode.addEventListener("click", toggleAuth);
  elements.signOutButton.addEventListener("click", signOut);
  elements.openContestModal.addEventListener("click", () => elements.contestModal.showModal());
  elements.closeContestModal.addEventListener("click", () => elements.contestModal.close());
  elements.contestForm.addEventListener("submit", handleContestSubmit);
  elements.seed1045Button.addEventListener("click", fillSample1045);
  elements.importContestButton.addEventListener("click", importCodeforcesContest);
  elements.problemSearch.addEventListener("input", renderProblems);
  elements.statusFilter.addEventListener("change", renderProblems);

  elements.navButtons.forEach((button) => {
    button.addEventListener("click", () => {
      activeSection = button.dataset.section;
      renderSections();
    });
  });
}

function loadState() {
  const fallback = { sessionEmail: "", users: {} };
  try {
    return JSON.parse(localStorage.getItem(storageKey)) || fallback;
  } catch {
    return fallback;
  }
}

function saveState() {
  localStorage.setItem(storageKey, JSON.stringify(state));
}

function handleAuth(event) {
  event.preventDefault();
  const email = elements.emailInput.value.trim().toLowerCase();
  const password = elements.passwordInput.value;
  elements.authError.textContent = "";

  if (password.length < 6) {
    elements.authError.textContent = "Password must be at least 6 characters.";
    return;
  }

  if (authMode === "signup") {
    if (state.users[email]) {
      elements.authError.textContent = "An account already exists for this email.";
      return;
    }
    state.users[email] = {
      email,
      password,
      contests: [],
      createdAt: new Date().toISOString(),
    };
  } else if (!state.users[email] || state.users[email].password !== password) {
    elements.authError.textContent = "Email or password does not match.";
    return;
  }

  state.sessionEmail = email;
  currentUser = state.users[email];
  saveState();
  elements.authForm.reset();
  renderApp();
}

function toggleAuth() {
  authMode = authMode === "signin" ? "signup" : "signin";
  elements.authTitle.textContent = authMode === "signin" ? "Sign in" : "Create account";
  elements.toggleAuthMode.textContent = authMode === "signin" ? "Create a new account" : "Use existing account";
  elements.authError.textContent = "";
}

function signOut() {
  state.sessionEmail = "";
  currentUser = null;
  saveState();
  renderApp();
}

function renderApp() {
  const signedIn = Boolean(currentUser);
  elements.authView.classList.toggle("hidden", signedIn);
  elements.dashboardView.classList.toggle("hidden", !signedIn);
  if (!signedIn) return;

  elements.userEmail.textContent = currentUser.email;
  $("profileEmail").textContent = currentUser.email;
  $("profileInitial").textContent = currentUser.email[0].toUpperCase();
  renderSections();
}

function renderSections() {
  const sectionNames = {
    overview: "Overview",
    contests: "Contests",
    problems: "Problems",
    profile: "Profile",
  };

  elements.sectionTitle.textContent = sectionNames[activeSection];
  elements.navButtons.forEach((button) => button.classList.toggle("active", button.dataset.section === activeSection));
  ["overview", "contests", "problems", "profile"].forEach((section) => {
    $(`${section}Section`).classList.toggle("hidden", section !== activeSection);
  });

  renderAnalytics();
  renderContests();
  renderProblems();
  renderProfile();
}

function handleContestSubmit(event) {
  event.preventDefault();
  const problemLines = $("problemsInput").value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const contest = {
    id: createId(),
    title: $("contestTitleInput").value.trim(),
    contestId: $("contestIdInput").value.trim(),
    date: $("contestDateInput").value,
    duration: $("contestDurationInput").value.trim(),
    addedAt: new Date().toISOString(),
    problems: problemLines.map(parseProblemLine),
  };

  currentUser.contests.unshift(contest);
  saveState();
  elements.contestForm.reset();
  elements.contestModal.close();
  activeSection = "contests";
  renderSections();
}

function parseProblemLine(line) {
  const match = line.match(/^([A-Z][0-9]?)\.?\s+(.+)$/i);
  return {
    id: createId(),
    index: match ? match[1].toUpperCase() : "",
    name: match ? match[2] : line,
    status: "not_solved",
    minutes: "",
    notes: "",
    updatedAt: new Date().toISOString(),
  };
}

function fillSample1045() {
  $("contestTitleInput").value = sample1045.title;
  $("contestIdInput").value = sample1045.contestId;
  $("contestDateInput").value = sample1045.date;
  $("contestDurationInput").value = sample1045.duration;
  $("problemsInput").value = sample1045.problems.join("\n");
}

async function importCodeforcesContest() {
  const roundText = elements.roundInput.value.trim();
  const roundNumber = roundText.match(/\d+/)?.[0] || "";
  const parsedDivision = parseDivision(roundText) || elements.divisionInput.value;

  if (!roundNumber) {
    setImportStatus("Enter a Codeforces round number first.", true);
    return;
  }

  setImportStatus(`Fetching Codeforces Round ${roundNumber} (${parsedDivision})...`);
  elements.importContestButton.disabled = true;

  try {
    const contestList = await fetchCodeforcesApi("contest.list");
    const contest = findContest(contestList.result, roundNumber, parsedDivision);

    if (!contest) {
      setImportStatus(`No contest matched Round ${roundNumber} (${parsedDivision}). Try another division.`, true);
      return;
    }

    const problemset = await fetchCodeforcesApi("problemset.problems");
    const problems = problemset.result.problems
      .filter((problem) => problem.contestId === contest.id)
      .sort((a, b) => a.index.localeCompare(b.index, undefined, { numeric: true }))
      .map((problem) => ({
        id: createId(),
        index: problem.index,
        name: problem.name,
        status: "not_solved",
        minutes: "",
        notes: problem.tags?.length ? problem.tags.join(", ") : "",
        updatedAt: new Date().toISOString(),
      }));

    if (!problems.length) {
      setImportStatus(`Found ${contest.name}, but no problems were returned by Codeforces.`, true);
      return;
    }

    currentUser.contests.unshift({
      id: createId(),
      title: contest.name,
      contestId: String(contest.id),
      date: contest.startTimeSeconds ? new Date(contest.startTimeSeconds * 1000).toISOString().slice(0, 10) : "",
      duration: formatDuration(contest.durationSeconds),
      addedAt: new Date().toISOString(),
      problems,
    });

    saveState();
    elements.roundInput.value = "";
    setImportStatus(`Imported ${contest.name} with ${problems.length} problems.`);
    renderSections();
  } catch (error) {
    setImportStatus(`Could not fetch from Codeforces. ${error.message}`, true);
  } finally {
    elements.importContestButton.disabled = false;
  }
}

async function fetchCodeforcesApi(method) {
  const response = await fetch(`https://codeforces.com/api/${method}`);
  if (!response.ok) throw new Error(`Request failed with HTTP ${response.status}.`);
  const payload = await response.json();
  if (payload.status !== "OK") throw new Error(payload.comment || "Codeforces API returned an error.");
  return payload;
}

function parseDivision(text) {
  const normalized = text.toLowerCase().replace(/\s+/g, " ");
  const match = normalized.match(/div\.?\s*([1-4])/);
  if (!match) return "";
  return `Div. ${match[1]}`;
}

function findContest(contests, roundNumber, division) {
  const roundNeedle = `codeforces round ${roundNumber}`;
  const divisionNeedle = division.toLowerCase();

  return contests.find((contest) => {
    const name = contest.name.toLowerCase().replace("#", "");
    return name.includes(roundNeedle) && name.includes(divisionNeedle);
  });
}

function formatDuration(seconds = 0) {
  if (!seconds) return "";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function setImportStatus(message, isError = false) {
  elements.importStatus.textContent = message;
  elements.importStatus.classList.toggle("error", isError);
}

function allProblems() {
  if (!currentUser) return [];
  return currentUser.contests.flatMap((contest) =>
    contest.problems.map((problem) => ({
      ...problem,
      contestTitle: contest.title,
      contestId: contest.contestId,
      contestDate: contest.date,
      contestLocalId: contest.id,
    })),
  );
}

function getAnalytics() {
  const problems = allProblems();
  const solved = problems.filter((problem) => problem.status === "solved");
  const timed = solved.filter((problem) => Number(problem.minutes) > 0);
  const avg = timed.length ? timed.reduce((sum, problem) => sum + Number(problem.minutes), 0) / timed.length : 0;
  const intuitionCount = problems.filter((problem) => problem.status === "intuition").length;
  const counts = Object.fromEntries(statusOrder.map((status) => [status, 0]));
  problems.forEach((problem) => {
    counts[problem.status] = (counts[problem.status] || 0) + 1;
  });

  return {
    problems,
    total: problems.length,
    solved: solved.length,
    avg,
    intuitionRate: problems.length ? Math.round((intuitionCount / problems.length) * 100) : 0,
    active: counts.attempting,
    counts,
  };
}

function renderAnalytics() {
  const analytics = getAnalytics();
  $("metricSolved").textContent = analytics.solved;
  $("metricAvgTime").textContent = analytics.avg ? `${Math.round(analytics.avg)}m` : "0m";
  $("metricIntuition").textContent = `${analytics.intuitionRate}%`;
  $("metricActive").textContent = analytics.active;
  $("statusTotal").textContent = `${analytics.total} problems`;
  $("contestCount").textContent = `${currentUser.contests.length} logged`;

  $("statusBars").innerHTML = statusOrder
    .map((status) => renderBar(statusLabels[status], analytics.counts[status], analytics.total, statusClass(status)))
    .join("") || emptyState("Add a contest to see your status mix.");

  $("recentContests").innerHTML = currentUser.contests
    .slice(0, 4)
    .map((contest) => {
      const solved = contest.problems.filter((problem) => problem.status === "solved").length;
      return `<div class="problem-main"><strong>${escapeHtml(contest.title)}</strong><span class="problem-meta">${solved}/${contest.problems.length} solved</span></div>`;
    })
    .join("") || emptyState("Your recent contest list will appear here.");
}

function renderBar(label, value, total, className) {
  const width = total ? Math.round((value / total) * 100) : 0;
  return `
    <div class="bar-row">
      <div class="bar-meta"><span>${label}</span><span>${value}</span></div>
      <div class="bar-track"><div class="bar-fill ${className}" style="width: ${width}%"></div></div>
    </div>
  `;
}

function renderContests() {
  $("contestList").innerHTML = currentUser.contests
    .map((contest) => {
      const solved = contest.problems.filter((problem) => problem.status === "solved").length;
      return `
        <article class="contest-card">
          <header>
            <div>
              <h3>${escapeHtml(contest.title)}</h3>
              <div class="contest-meta">${contest.contestId ? `Contest ${escapeHtml(contest.contestId)} - ` : ""}${contest.date || "No date"} - ${contest.duration || "No duration"}</div>
            </div>
            <div class="contest-actions">
              <span class="status-pill status-solved">${solved}/${contest.problems.length} solved</span>
              <button class="danger-button" type="button" data-delete-contest="${contest.id}">Delete</button>
            </div>
          </header>
          <div class="problem-list">
            ${contest.problems.map((problem) => renderProblemRow(contest, problem)).join("")}
          </div>
        </article>
      `;
    })
    .join("") || emptyState("Add your first Codeforces contest to start tracking.");
}

function renderProblems() {
  const query = elements.problemSearch.value.trim().toLowerCase();
  const filter = elements.statusFilter.value;
  const problems = allProblems().filter((problem) => {
    const haystack = `${problem.index} ${problem.name} ${problem.contestTitle} ${problem.notes}`.toLowerCase();
    return (!query || haystack.includes(query)) && (filter === "all" || problem.status === filter);
  });

  $("problemTable").innerHTML = problems
    .map((problem) => {
      const contest = currentUser.contests.find((item) => item.id === problem.contestLocalId);
      const sourceProblem = contest.problems.find((item) => item.id === problem.id);
      return renderProblemRow(contest, sourceProblem, true);
    })
    .join("") || emptyState("No problems match this view.");
}

function renderProblemRow(contest, problem, showContest = false) {
  return `
    <div class="problem-row">
      <div class="problem-main">
        <div>
          <strong>${problem.index ? `${escapeHtml(problem.index)}. ` : ""}${escapeHtml(problem.name)}</strong>
          <div class="problem-meta">${showContest ? escapeHtml(contest.title) : escapeHtml(problem.notes || "No notes yet")}</div>
        </div>
        <span class="status-pill ${statusClass(problem.status)}">${statusLabels[problem.status]}</span>
      </div>
      <div class="problem-controls">
        <select data-contest-id="${contest.id}" data-problem-id="${problem.id}" data-field="status">
          ${statusOrder.map((status) => `<option value="${status}" ${problem.status === status ? "selected" : ""}>${statusLabels[status]}</option>`).join("")}
        </select>
        <input data-contest-id="${contest.id}" data-problem-id="${problem.id}" data-field="minutes" type="number" min="0" step="1" value="${escapeHtml(problem.minutes)}" placeholder="Minutes" />
        <input data-contest-id="${contest.id}" data-problem-id="${problem.id}" data-field="notes" value="${escapeHtml(problem.notes)}" placeholder="Notes, trick, topic, mistake" />
      </div>
    </div>
  `;
}

document.addEventListener("change", handleProblemEdit);
document.addEventListener("input", (event) => {
  if (event.target.matches("[data-field='minutes'], [data-field='notes']")) {
    handleProblemEdit(event);
  }
});
document.addEventListener("click", handleContestDelete);

function handleContestDelete(event) {
  const contestId = event.target.dataset?.deleteContest;
  if (!contestId) return;

  const contest = currentUser.contests.find((item) => item.id === contestId);
  if (!contest) return;

  const confirmed = confirm(`Delete "${contest.title}" and all tracked problem data for it?`);
  if (!confirmed) return;

  currentUser.contests = currentUser.contests.filter((item) => item.id !== contestId);
  saveState();
  renderSections();
}

function handleProblemEdit(event) {
  const target = event.target;
  if (!target.dataset || !target.dataset.problemId) return;

  const contest = currentUser.contests.find((item) => item.id === target.dataset.contestId);
  const problem = contest?.problems.find((item) => item.id === target.dataset.problemId);
  if (!problem) return;

  problem[target.dataset.field] = target.value;
  problem.updatedAt = new Date().toISOString();
  saveState();
  renderAnalytics();
  renderProfile();

  if (target.dataset.field === "status") {
    renderContests();
    renderProblems();
  }
}

function renderProfile() {
  const analytics = getAnalytics();
  $("profileSummary").textContent = analytics.total
    ? `${analytics.solved} solved from ${analytics.total} logged problems. Average solved-problem time is ${analytics.avg ? `${Math.round(analytics.avg)} minutes` : "not available yet"}.`
    : "No contests logged yet.";

  const indexCounts = {};
  analytics.problems.forEach((problem) => {
    const index = problem.index || "?";
    if (!indexCounts[index]) indexCounts[index] = { total: 0, solved: 0 };
    indexCounts[index].total += 1;
    if (problem.status === "solved") indexCounts[index].solved += 1;
  });

  $("indexBreakdown").innerHTML = Object.entries(indexCounts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([index, data]) => renderBar(`Problem ${escapeHtml(index)}`, data.solved, data.total, "status-solved"))
    .join("") || emptyState("Index breakdown appears after you log problems.");
}

function statusClass(status) {
  return `status-${status}`;
}

function emptyState(text) {
  return `<div class="empty-state">${text}</div>`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
