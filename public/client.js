// VeriVote Frontend Client Application Logic - Multi-Tenant Version

// Global Application State
const state = {
  currentView: 'gateway-view',
  activeElection: null,
  voterCode: '',
  selectedSchool: '', // The school context (e.g. OAU, Veritas University)
  adminUser: null,    // Admin profile: { name, school, inviteCode }
  selectedCandidateIds: {}, // Key: role, Value: candidateId
  countdownInterval: null,
  serverTimeOffset: 0,
  candidatesList: [], // Active candidates in election
  positions: [],      // Dynamic list of positions for selected school
  allRegisteredCandidates: [], // Global candidate registry for selected school
  resultsElectionId: null
};

// DOM Views & Navigation
let views = {};
let nav = {};

// Toast Notification Helper
function showToast(message, type = 'info') {
  const toast = document.getElementById('toast');
  const icon = document.getElementById('toast-icon');
  const msg = document.getElementById('toast-message');
  
  toast.className = `toast show ${type}`;
  msg.innerText = message;
  
  if (type === 'success') {
    icon.innerHTML = '<i class="fa-solid fa-circle-check"></i>';
  } else if (type === 'error') {
    icon.innerHTML = '<i class="fa-solid fa-circle-exclamation"></i>';
  } else {
    icon.innerHTML = '<i class="fa-solid fa-circle-info"></i>';
  }

  setTimeout(() => {
    toast.className = 'toast';
  }, 4000);
}

// Router: Switch views smoothly
function switchView(viewId) {
  Object.keys(views).forEach(key => {
    if (views[key].id === viewId) {
      views[key].classList.add('active');
    } else {
      views[key].classList.remove('active');
    }
  });
  state.currentView = viewId;
  sessionStorage.setItem('currentView', viewId);
  window.scrollTo({ top: 0, behavior: 'smooth' });

  // Clean selections when leaving ballot
  if (viewId !== 'voter-ballot-view') {
    state.selectedCandidateIds = {};
  }
  
  // Stop confetti when not in results view
  if (viewId !== 'results-view') {
    stopConfetti();
  }

  // Toggle Header Navigation actions based on views
  const headerNav = document.getElementById('nav-actions');
  if (viewId === 'gateway-view' || viewId === 'voter-school-view' || viewId === 'admin-gate-view') {
    headerNav.style.display = 'none'; // Hide nav buttons on entrance screens
  } else {
    headerNav.style.display = 'flex';
  }

  // Toggle Footer visibility based on active view (hide on dashboard and ballot)
  const footerElement = document.querySelector('footer');
  if (footerElement) {
    if (viewId === 'admin-view' || viewId === 'super-admin-view' || viewId === 'voter-ballot-view') {
      footerElement.style.display = 'none';
    } else {
      footerElement.style.display = 'block';
    }
  }
}

// ==========================================
// TIMER & COUNTDOWN MANAGEMENT
// ==========================================

function getRemainingTime(endTime) {
  const now = Date.now() + state.serverTimeOffset;
  const diff = endTime - now;
  
  if (diff <= 0) return { expired: true, text: '00:00:00', secondsLeft: 0 };
  
  const seconds = Math.floor((diff / 1000) % 60);
  const minutes = Math.floor((diff / (1000 * 60)) % 60);
  const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
  
  const pad = num => String(num).padStart(2, '0');
  return {
    expired: false,
    text: `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`,
    secondsLeft: Math.floor(diff / 1000)
  };
}

function startCountdownTimer(endTime, onTick, onExpired) {
  if (state.countdownInterval) clearInterval(state.countdownInterval);
  
  const tick = () => {
    const time = getRemainingTime(endTime);
    onTick(time.text);
    
    if (time.expired) {
      clearInterval(state.countdownInterval);
      state.countdownInterval = null;
      if (onExpired) onExpired();
    }
  };
  
  tick(); // Run immediately
  state.countdownInterval = setInterval(tick, 1000);
}

// ==========================================
// GATEWAY & SCHOOL SELECTOR LOGIC
// ==========================================

async function loadSchoolsList() {
  try {
    const res = await fetch('/api/schools');
    const schools = await res.json();
    
    const select = document.getElementById('voter-school-select');
    select.innerHTML = '';
    
    if (schools.length === 0) {
      select.innerHTML = '<option value="">-- No schools registered yet --</option>';
      return;
    }
    
    schools.forEach(school => {
      const opt = document.createElement('option');
      opt.value = school;
      opt.innerText = school;
      select.appendChild(opt);
    });
  } catch (err) {
    showToast('Failed to fetch registered schools.', 'error');
  }
}

async function enterSchoolPortal() {
  const select = document.getElementById('voter-school-select');
  const school = select.value;
  
  if (!school) {
    showToast('Please select a school to continue.', 'error');
    return;
  }
  
  state.selectedSchool = school;
  sessionStorage.setItem('selectedSchool', school);
  
  // Update Portal view titles
  document.getElementById('school-landing-title').innerText = school;
  
  loadSchoolElections();
  switchView('landing-view');
}

// ==========================================
// ACTIVE ELECTION LISTINGS (SCOPED)
// ==========================================

let landingTimers = [];

function clearLandingTimers() {
  landingTimers.forEach(t => clearInterval(t.interval));
  landingTimers = [];
}

async function loadSchoolElections() {
  if (!state.selectedSchool) return;
  clearLandingTimers();
  
  try {
    const res = await fetch(`/api/elections?school=${encodeURIComponent(state.selectedSchool)}`);
    const elections = await res.json();
    
    const container = document.getElementById('landing-elections-list');
    container.innerHTML = '';
    
    if (elections.length === 0) {
      container.innerHTML = `
        <div class="glass text-center" style="padding: 40px; border-radius: var(--radius-md);">
          <i class="fa-solid fa-box-archive" style="font-size: 2.5rem; color: var(--text-muted); margin-bottom: 15px;"></i>
          <h3 class="mt-2">No Elections Configured</h3>
          <p class="small-muted mt-2">There are no active or concluded elections registered for ${state.selectedSchool}. Please check back later.</p>
        </div>
      `;
      return;
    }
    
    elections.forEach(e => {
      const card = document.createElement('div');
      card.className = 'election-card glass';
      
      const isEnded = e.status === 'ended' || Date.now() > e.end_time;
      const scopeStr = e.scope === 'School-Wide' ? 'School-Wide' : `${e.scope}: ${e.scope_name}`;
      
      if (!isEnded) {
        // Active Election Card
        const timerId = `timer-${e.id}`;
        card.innerHTML = `
          <div class="election-card-left">
            <div class="election-card-icon active-icon">
              <i class="fa-solid fa-check-to-slot"></i>
            </div>
            <div class="election-card-info">
              <h3>${e.title}</h3>
              <div style="display: flex; gap: 10px; align-items: center;">
                <span class="scope-tag"><i class="fa-solid fa-layer-group"></i> ${scopeStr}</span>
                <span class="badge" style="background: rgba(16,185,129,0.1); color: var(--color-emerald); border-color: rgba(16,185,129,0.3); margin-top: 0;">Active</span>
              </div>
              <div class="election-card-timer" id="${timerId}-container">
                <i class="fa-regular fa-clock"></i> Closes in: <span class="time-highlight" id="${timerId}">00:00:00</span>
              </div>
            </div>
          </div>
          <div class="election-card-right">
            <button class="btn btn-primary" id="btn-vote-${e.id}">Vote Now <i class="fa-solid fa-chevron-right"></i></button>
          </div>
        `;
        
        container.appendChild(card);
        
        const updateTimer = () => {
          const time = getRemainingTime(e.end_time);
          const span = document.getElementById(timerId);
          if (span) span.innerText = time.text;
          
          if (time.expired) {
            clearInterval(intervalId);
            loadSchoolElections();
          }
        };
        
        updateTimer();
        const intervalId = setInterval(updateTimer, 1000);
        landingTimers.push({ id: e.id, interval: intervalId });
        
        document.getElementById(`btn-vote-${e.id}`).addEventListener('click', () => {
          state.activeElection = e;
          sessionStorage.setItem('activeElection', JSON.stringify(e));
          const miniInfo = document.getElementById('auth-election-info');
          document.getElementById('auth-election-title').innerText = e.title;
          document.getElementById('auth-election-scope').innerText = e.scope;
          miniInfo.style.display = 'block';
          switchView('voter-auth-view');
        });
        
      } else {
        // Concluded Election Card
        card.innerHTML = `
          <div class="election-card-left">
            <div class="election-card-icon concluded-icon">
              <i class="fa-solid fa-square-poll-vertical"></i>
            </div>
            <div class="election-card-info">
              <h3>${e.title}</h3>
              <div style="display: flex; gap: 10px; align-items: center;">
                <span class="scope-tag"><i class="fa-solid fa-layer-group"></i> ${scopeStr}</span>
                <span class="badge" style="background: rgba(255,255,255,0.05); color: var(--text-muted); border-color: rgba(255,255,255,0.1); margin-top: 0;">Concluded</span>
              </div>
              <div class="election-card-timer" style="color: var(--text-muted);">
                <i class="fa-regular fa-calendar-check"></i> Voting period has closed.
              </div>
            </div>
          </div>
          <div class="election-card-right">
            <button class="btn btn-secondary" id="btn-results-${e.id}">View Results <i class="fa-solid fa-chart-column"></i></button>
          </div>
        `;
        
        container.appendChild(card);
        
        document.getElementById(`btn-results-${e.id}`).addEventListener('click', () => {
          loadResults(e.id);
        });
      }
    });
  } catch (err) {
    console.error('Error fetching elections:', err);
    showToast('Failed to load elections list.', 'error');
  }
}

// ==========================================
// VOTER LOGIN & BALOT GENERATOR
// ==========================================

async function handleVoterAuthSubmit(e) {
  e.preventDefault();
  const voterIdInput = document.getElementById('voter-id-input');
  const authError = document.getElementById('auth-error-msg');
  const code = voterIdInput.value.trim().toUpperCase();
  
  if (!state.activeElection) {
    showToast('There is no active election to vote in.', 'error');
    return;
  }
  
  try {
    const res = await fetch('/api/auth/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ voterCode: code, electionId: state.activeElection.id })
    });
    
    const data = await res.json();
    
    if (res.ok && data.valid) {
      state.voterCode = code;
      sessionStorage.setItem('voterCode', code);
      authError.style.display = 'none';
      voterIdInput.value = '';
      showToast('Authentication Successful!', 'success');
      loadBallot();
    } else {
      authError.innerText = data.error || 'Authentication failed.';
      authError.style.display = 'flex';
    }
  } catch (err) {
    showToast('Connection error.', 'error');
  }
}

async function loadBallot() {
  const ballotTitle = document.getElementById('ballot-title');
  const ballotScope = document.getElementById('ballot-scope');
  const ballotCountdown = document.getElementById('ballot-countdown');
  
  ballotTitle.innerText = state.activeElection.title;
  
  const scopeStr = state.activeElection.scope === 'School-Wide' 
    ? 'School-Wide' 
    : `${state.activeElection.scope}: ${state.activeElection.scope_name}`;
  ballotScope.innerText = scopeStr;
  
  startCountdownTimer(state.activeElection.end_time,
    (timeStr) => {
      ballotCountdown.innerText = timeStr;
    },
    () => {
      showToast('Voting period has expired.', 'error');
      switchView('landing-view');
      loadSchoolElections();
    }
  );
  
  try {
    const res = await fetch(`/api/election/${state.activeElection.id}/candidates`);
    const candidates = await res.json();
    state.candidatesList = candidates;
    state.selectedCandidateIds = {};
    
    const container = document.getElementById('ballot-dynamic-sections');
    container.innerHTML = '';
    
    // Group candidates by position/role dynamically
    const grouped = {};
    candidates.forEach(c => {
      if (!grouped[c.role]) {
        grouped[c.role] = [];
      }
      grouped[c.role].push(c);
    });
    
    const rolesList = Object.keys(grouped);
    if (rolesList.length === 0) {
      container.innerHTML = '<p class="text-center span-2 mt-4">No candidates registered for this election.</p>';
      switchView('voter-ballot-view');
      return;
    }
    
    rolesList.forEach((role, idx) => {
      const section = document.createElement('div');
      section.className = `ballot-section ${idx > 0 ? 'mt-5' : ''}`;
      
      section.innerHTML = `
        <div class="section-title-container">
          <span class="section-num">${idx + 1}</span>
          <h3>${role} Candidates</h3>
          <p class="section-instruction">Select exactly one (1) candidate for the ${role} seat.</p>
        </div>
        <div class="candidates-grid" id="grid-${role.replace(/\s+/g, '-')}-ballot"></div>
      `;
      
      container.appendChild(section);
      
      const grid = document.getElementById(`grid-${role.replace(/\s+/g, '-')}-ballot`);
      grouped[role].forEach(cand => {
        grid.appendChild(createCandidateCard(cand, role));
      });
    });
    
    switchView('voter-ballot-view');
  } catch (err) {
    showToast('Failed to load election ballot.', 'error');
  }
}

function createCandidateCard(cand, role) {
  const card = document.createElement('div');
  card.className = 'candidate-card glass';
  card.dataset.id = cand.id;
  
  const badge = document.createElement('div');
  badge.className = 'card-select-badge';
  badge.innerHTML = '<i class="fa-solid fa-check"></i>';
  card.appendChild(badge);
  
  const avatar = document.createElement('div');
  avatar.className = 'candidate-card-avatar';
  if (cand.image_data && cand.image_data.startsWith('data:image')) {
    avatar.style.backgroundImage = `url(${cand.image_data})`;
  } else if (cand.image_data) {
    avatar.classList.add(cand.image_data);
  } else {
    avatar.innerHTML = '<i class="fa-solid fa-user"></i>';
  }
  card.appendChild(avatar);
  
  const name = document.createElement('h4');
  name.innerText = cand.name;
  card.appendChild(name);
  
  const bio = document.createElement('p');
  bio.innerText = cand.bio || 'No campaign manifesto declared.';
  card.appendChild(bio);
  
  card.addEventListener('click', () => {
    const gridId = `grid-${role.replace(/\s+/g, '-')}-ballot`;
    const grid = document.getElementById(gridId);
    
    grid.querySelectorAll('.candidate-card').forEach(c => c.classList.remove('selected'));
    card.classList.add('selected');
    state.selectedCandidateIds[role] = cand.id;
  });
  
  return card;
}

function handleBallotSubmit() {
  const activeRoles = [...new Set(state.candidatesList.map(c => c.role))];
  
  for (const role of activeRoles) {
    if (!state.selectedCandidateIds[role]) {
      showToast(`Please select a candidate for the '${role}' seat.`, 'error');
      return;
    }
  }
  
  const summaryList = document.getElementById('modal-summary-list');
  summaryList.innerHTML = '';
  
  activeRoles.forEach(role => {
    const candId = state.selectedCandidateIds[role];
    const cand = state.candidatesList.find(c => c.id === candId);
    
    const item = document.createElement('div');
    item.className = 'summary-item';
    item.innerHTML = `
      <span class="label">${role}:</span>
      <span class="value">${cand.name}</span>
    `;
    summaryList.appendChild(item);
  });
  
  document.getElementById('confirm-modal').classList.add('active');
}

async function castSecureBallot() {
  document.getElementById('confirm-modal').classList.remove('active');
  const selectedIds = Object.values(state.selectedCandidateIds);
  
  try {
    const res = await fetch('/api/vote/cast', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        voterCode: state.voterCode,
        electionId: state.activeElection.id,
        candidateIds: selectedIds
      })
    });
    
    const data = await res.json();
    if (res.ok && data.success) {
      showToast('Vote successfully cast!', 'success');
      loadWaitingScreen();
    } else {
      showToast(data.error || 'Failed to submit ballot.', 'error');
    }
  } catch (err) {
    showToast('Network error while casting vote.', 'error');
  }
}

function loadWaitingScreen() {
  const waitingCountdown = document.getElementById('waiting-countdown');
  
  startCountdownTimer(state.activeElection.end_time,
    (timeStr) => {
      waitingCountdown.innerText = timeStr;
    },
    () => {
      showToast('Voting complete! Calculating results...', 'success');
      loadResults(state.activeElection.id);
    }
  );
  
  switchView('voter-waiting-view');
}

// ==========================================
// RESULTS VIEW LOGIC
// ==========================================

async function loadResults(electionId) {
  state.resultsElectionId = electionId;
  sessionStorage.setItem('resultsElectionId', electionId);
  try {
    const res = await fetch(`/api/election/${electionId}/results`);
    
    if (res.status === 403) {
      showToast('Results are locked until voting ends.', 'error');
      state.resultsElectionId = null;
      sessionStorage.removeItem('resultsElectionId');
      switchView('landing-view');
      return;
    }
    
    const data = await res.json();
    if (!res.ok || !data.success) {
      showToast('Failed to load election results.', 'error');
      state.resultsElectionId = null;
      sessionStorage.removeItem('resultsElectionId');
      switchView('landing-view');
      return;
    }
    
    document.getElementById('results-election-title').innerText = data.electionTitle;
    const scopeStr = data.scope === 'School-Wide' ? 'School-Wide' : `${data.scope}: ${data.scopeName}`;
    document.getElementById('results-election-meta').innerText = scopeStr;
    
    document.getElementById('stat-total-voters').innerText = data.stats.totalVoters;
    document.getElementById('stat-votes-cast').innerText = data.stats.votedCount;
    document.getElementById('stat-turnout').innerText = `${data.stats.turnoutPercentage}%`;
    
    const podium = document.getElementById('results-podium-dynamic');
    const breakdown = document.getElementById('results-breakdown-dynamic');
    
    podium.innerHTML = '';
    breakdown.innerHTML = '';
    
    const rolesList = Object.keys(data.resultsByRole);
    
    rolesList.forEach(role => {
      const candidates = data.resultsByRole[role];
      const winner = candidates[0];
      
      if (winner) {
        const winCard = document.createElement('div');
        winCard.className = 'winner-card glass';
        
        // Dynamic styling
        const isOdd = role.charCodeAt(0) % 2 === 0;
        winCard.classList.add(isOdd ? 'president-winner-card' : 'secretary-winner-card');
        
        winCard.innerHTML = `
          <div class="winner-badge"><i class="fa-solid fa-crown"></i> ${role} Winner</div>
          <div class="winner-profile">
            <div class="winner-avatar" id="win-avatar-${winner.id}"></div>
            <h2>${winner.name}</h2>
            <p class="winner-votes">${winner.votes} votes</p>
            <div class="winner-bio">${winner.bio || 'No campaign bio details.'}</div>
          </div>
        `;
        podium.appendChild(winCard);
        
        const avatarDiv = document.getElementById(`win-avatar-${winner.id}`);
        if (winner.image_data && winner.image_data.startsWith('data:image')) {
          avatarDiv.style.backgroundImage = `url(${winner.image_data})`;
        } else if (winner.image_data) {
          avatarDiv.classList.add(winner.image_data);
        } else {
          avatarDiv.innerHTML = '<i class="fa-solid fa-user"></i>';
        }
      }
      
      const breakCard = document.createElement('div');
      breakCard.className = 'breakdown-card glass';
      breakCard.innerHTML = `
        <h3>${role} Voting Details</h3>
        <div class="charts-container" id="chart-container-${role.replace(/\s+/g, '-')}"></div>
      `;
      breakdown.appendChild(breakCard);
      
      renderBreakdownChart(`chart-container-${role.replace(/\s+/g, '-')}`, candidates, data.stats.votedCount);
    });
    
    switchView('results-view');
    startConfetti();
    
  } catch (err) {
    showToast('Connection error fetching results.', 'error');
  }
}

function renderBreakdownChart(containerId, candidates, totalVotes) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';
  
  if (candidates.length === 0) {
    container.innerHTML = '<p class="text-center text-muted">No candidates registered.</p>';
    return;
  }
  
  const maxVotes = candidates[0].votes || 1;
  
  candidates.forEach(cand => {
    const item = document.createElement('div');
    item.className = 'chart-item';
    
    const pctOfTotal = totalVotes > 0 ? ((cand.votes / totalVotes) * 100).toFixed(1) : 0;
    const pctOfMax = ((cand.votes / maxVotes) * 100).toFixed(1);
    
    item.innerHTML = `
      <div class="chart-label-row">
        <span class="chart-cand-name">${cand.name}</span>
        <span class="chart-votes-num">${cand.votes} votes (${pctOfTotal}%)</span>
      </div>
      <div class="chart-bar-bg">
        <div class="chart-bar-fill" style="width: 0%"></div>
      </div>
    `;
    
    container.appendChild(item);
    
    setTimeout(() => {
      const fill = item.querySelector('.chart-bar-fill');
      if (fill) fill.style.width = `${pctOfMax}%`;
    }, 100);
  });
}

// ==========================================
// SCHOOL ADMIN AUTHENTICATION
// ==========================================

function setupAuthTabs() {
  const loginForm = document.getElementById('admin-login-form-box');
  const signupForm = document.getElementById('admin-signup-form-box');
  const superForm = document.getElementById('admin-super-form-box');
  
  const btnLogin = document.getElementById('btn-tab-login');
  const btnSignup = document.getElementById('btn-tab-signup');
  const btnSuper = document.getElementById('btn-tab-super');
  
  btnLogin.addEventListener('click', () => {
    btnLogin.classList.add('active');
    btnSignup.classList.remove('active');
    btnSuper.classList.remove('active');
    loginForm.style.display = 'block';
    signupForm.style.display = 'none';
    superForm.style.display = 'none';
  });

  btnSignup.addEventListener('click', () => {
    btnSignup.classList.add('active');
    btnLogin.classList.remove('active');
    btnSuper.classList.remove('active');
    signupForm.style.display = 'block';
    loginForm.style.display = 'none';
    superForm.style.display = 'none';
    loadAdminSignupSchools();
  });

  btnSuper.addEventListener('click', () => {
    btnSuper.classList.add('active');
    btnLogin.classList.remove('active');
    btnSignup.classList.remove('active');
    superForm.style.display = 'block';
    loginForm.style.display = 'none';
    signupForm.style.display = 'none';
  });
}

async function handleAdminSignup(e) {
  e.preventDefault();
  const name = document.getElementById('admin-signup-name').value.trim();
  const school = document.getElementById('admin-signup-school').value.trim();
  const inviteCode = document.getElementById('admin-signup-code').value.trim().toUpperCase();
  const password = document.getElementById('admin-signup-password').value;

  try {
    const res = await fetch('/api/auth/admin/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, school, inviteCode, password })
    });
    
    const data = await res.json();
    if (res.ok && data.success) {
      showToast(data.message, 'success');
      document.getElementById('admin-signup-form').reset();
      
      // Auto-switch to login tab and prefill details
      document.getElementById('btn-tab-login').click();
      document.getElementById('admin-login-name').value = name;
      showToast('Account registered! Enter your password to sign in.', 'info');
    } else {
      showToast(data.error || 'Registration failed.', 'error');
    }
  } catch (err) {
    showToast('Connection error during signup.', 'error');
  }
}

async function handleAdminLogin(e) {
  e.preventDefault();
  const name = document.getElementById('admin-login-name').value.trim();
  const password = document.getElementById('admin-login-password').value;

  // Super Admin Bypass Authentication
  if (name === 'SUPERADMIN' && password === 'SUPERADMIN') {
    showToast('Super Admin authenticated!', 'success');
    document.getElementById('admin-login-form').reset();
    state.adminUser = { name: 'SUPERADMIN', isSuperAdmin: true };
    sessionStorage.setItem('adminUser', JSON.stringify(state.adminUser));
    enterSuperAdminPortal();
    return;
  }

  try {
    const res = await fetch('/api/auth/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, password })
    });
    
    const data = await res.json();
    if (res.ok && data.success) {
      state.adminUser = { name: data.name, school: data.school };
      state.selectedSchool = data.school;
      sessionStorage.setItem('adminUser', JSON.stringify(state.adminUser));
      sessionStorage.setItem('selectedSchool', state.selectedSchool);
      
      showToast(`Welcome back, Admin of ${data.school}!`, 'success');
      document.getElementById('admin-login-form').reset();
      
      enterSchoolAdminDashboard();
    } else {
      showToast(data.error || 'Authentication failed.', 'error');
    }
  } catch (err) {
    showToast('Connection error during login.', 'error');
  }
}

async function handleSuperAdminLogin(e) {
  e.preventDefault();
  const name = document.getElementById('admin-super-name').value.trim();
  const inviteCode = document.getElementById('admin-super-code').value.trim().toUpperCase();

  if (name === 'SUPERADMIN' && inviteCode === 'SUPERADMIN') {
    showToast('Super Admin authenticated!', 'success');
    document.getElementById('admin-super-form').reset();
    state.adminUser = { name: 'SUPERADMIN', isSuperAdmin: true };
    sessionStorage.setItem('adminUser', JSON.stringify(state.adminUser));
    enterSuperAdminPortal();
  } else {
    showToast('Invalid Super Admin credentials.', 'error');
  }
}

// Switch to School Admin Panel
function enterSchoolAdminDashboard(savedTab) {
  document.getElementById('admin-school-label').innerText = state.adminUser.school;

  // Always start with a fresh form on login
  resetElectionCreationPage();
  
  // Reset active admin tabs back to default or saved tab
  const tabToClick = savedTab || 'tab-create-election';
  const defaultTab = document.querySelector(`#admin-view [data-tab="${tabToClick}"]`);
  if (defaultTab) {
    defaultTab.click();
  } else {
    const backupTab = document.querySelector('#admin-view [data-tab="tab-create-election"]');
    if (backupTab) backupTab.click();
  }
  
  switchView('admin-view');
  
  // Check if there's already an active election - lock form if so
  checkActiveElectionLock();
}

// ==========================================
// ACTIVE ELECTION LOCK (Create Election Tab)
// ==========================================

let lockoutCountdownInterval = null;
let lockoutWasActive = false; // tracks whether an election lock was previously shown

async function checkActiveElectionLock() {
  if (!state.selectedSchool) return;

  const lockPanel = document.getElementById('election-active-lockout');
  const form = document.getElementById('create-election-form');
  if (!lockPanel || !form) return;

  try {
    const adminParam = state.adminUser ? `&adminName=${encodeURIComponent(state.adminUser.name)}` : '';
    const res = await fetch(`/api/election/status?school=${encodeURIComponent(state.selectedSchool)}${adminParam}`);
    const data = await res.json();

    if (data.active && data.end_time > Date.now()) {
      // Sync server time offset
      if (data.server_time) {
        state.serverTimeOffset = data.server_time - Date.now();
      }

      // Mark that we entered the locked state
      lockoutWasActive = true;

      // Show lockout, hide form
      lockPanel.style.display = 'block';
      form.style.display = 'none';

      // Populate lock panel info
      document.getElementById('lockout-election-title').innerText = data.title;
      const scopeStr = data.scope === 'School-Wide'
        ? 'School-Wide Election'
        : `${data.scope}: ${data.scope_name || ''}`;
      document.getElementById('lockout-election-scope').innerText = scopeStr;

      // Clear previous countdown interval
      if (lockoutCountdownInterval) clearInterval(lockoutCountdownInterval);

      const tick = () => {
        const time = getRemainingTime(data.end_time);
        const el = document.getElementById('lockout-countdown');
        if (el) el.innerText = time.text;

        if (time.expired) {
          clearInterval(lockoutCountdownInterval);
          lockoutCountdownInterval = null;
          lockoutWasActive = false;
          // Election ended via live countdown — reset and unlock
          lockPanel.style.display = 'none';
          form.style.display = 'block';
          resetElectionCreationPage();
          showToast('Election concluded! Form has been reset — ready to launch a new one.', 'success');
        }
      };

      tick();
      lockoutCountdownInterval = setInterval(tick, 1000);

    } else {
      // No active election found.
      // If we previously showed the lockout (election ended while admin was away), reset the form.
      if (lockoutWasActive) {
        lockoutWasActive = false;
        resetElectionCreationPage();
        showToast('Election concluded! Form has been reset — ready to launch a new one.', 'success');
      }

      // Hide lockout, show form
      lockPanel.style.display = 'none';
      form.style.display = 'block';

      if (lockoutCountdownInterval) {
        clearInterval(lockoutCountdownInterval);
        lockoutCountdownInterval = null;
      }
    }
  } catch (err) {
    // On network error just show the form (fail open)
    lockPanel.style.display = 'none';
    form.style.display = 'block';
  }
}

// ==========================================
// FULL RESET: Create Election Page
// ==========================================

function resetElectionCreationPage() {
  // 1. Reset HTML form (clears native inputs)
  const form = document.getElementById('create-election-form');
  if (form) form.reset();

  // 2. Re-apply institution label (form.reset() wipes it)
  const instInput = document.getElementById('election-inst-input');
  if (instInput && state.adminUser) instInput.value = state.adminUser.school;

  // 3. Reset duration to default
  const durationInput = document.getElementById('election-duration-input');
  if (durationInput) durationInput.value = '5';

  // 4. Reset election title
  const titleInput = document.getElementById('election-title-input');
  if (titleInput) titleInput.value = '';

  // 5. Reset scope selection back to School-Wide
  const scopeSelect = document.getElementById('election-scope-select');
  if (scopeSelect) scopeSelect.value = 'School-Wide';
  const scopeNameContainer = document.getElementById('scope-name-container');
  if (scopeNameContainer) scopeNameContainer.style.display = 'none';
  const scopeNameInput = document.getElementById('election-scope-name-input');
  if (scopeNameInput) { scopeNameInput.value = ''; scopeNameInput.required = false; }

  // 6. Reset voter code method radios back to Random
  const randomRadio = document.querySelector('input[name="voter-code-method"][value="random"]');
  if (randomRadio) randomRadio.checked = true;
  const listRadio = document.querySelector('input[name="voter-code-method"][value="list"]');
  if (listRadio) listRadio.checked = false;

  const randomContainer = document.getElementById('method-random-container');
  if (randomContainer) randomContainer.style.display = 'block';
  const listContainer = document.getElementById('method-list-container');
  if (listContainer) listContainer.style.display = 'none';

  const votersInput = document.getElementById('election-voters-input');
  if (votersInput) { votersInput.value = '10'; votersInput.required = true; }
  const votersListInput = document.getElementById('election-voters-list-input');
  if (votersListInput) { votersListInput.value = ''; votersListInput.required = false; }

  // 7. Clear CSV state and file picker display
  state.csvOriginalRows = [];
  state.csvMatricColumnIndex = -1;
  state.csvNameColumnIndex = -1;
  state.csvParsedMapping = {};
  const csvFileInput = document.getElementById('election-voters-csv-file');
  if (csvFileInput) csvFileInput.value = '';
  const csvFileName = document.getElementById('csv-file-name');
  if (csvFileName) csvFileName.innerText = 'No file chosen';

  // 8. Reload the candidate selection list fresh
  loadCandidatesForCreationSelections();
}

// ==========================================
// SUPER ADMIN DASHBOARD
// ==========================================

function enterSuperAdminPortal(savedTab) {
  // Load Super Admin overview metrics
  loadSuperAdminOverview();
  
  // Reset active super admin tabs back to default or saved tab
  const tabToClick = savedTab || 'tab-sa-overview';
  const defaultTab = document.querySelector(`#super-admin-view [data-tab="${tabToClick}"]`);
  if (defaultTab) {
    defaultTab.click();
  } else {
    const backupTab = document.querySelector('#super-admin-view [data-tab="tab-sa-overview"]');
    if (backupTab) backupTab.click();
  }
  
  switchView('super-admin-view');
}

async function loadAdminSignupSchools() {
  try {
    const res = await fetch('/api/schools');
    const schools = await res.json();
    
    const select = document.getElementById('admin-signup-school');
    select.innerHTML = '';
    
    if (schools.length === 0) {
      select.innerHTML = '<option value="">-- No pre-approved schools --</option>';
      return;
    }
    
    schools.forEach(school => {
      const opt = document.createElement('option');
      opt.value = school;
      opt.innerText = school;
      select.appendChild(opt);
    });
  } catch (err) {
    showToast('Failed to load schools list for registration.', 'error');
  }
}

async function loadSuperAdminSchools() {
  try {
    const res = await fetch('/api/superadmin/schools/stats');
    const schools = await res.json();
    
    const tbody = document.getElementById('sa-schools-tbody');
    tbody.innerHTML = '';
    
    if (schools.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" class="text-center">No schools pre-approved yet. Add one above.</td></tr>';
      return;
    }
    
    schools.forEach(school => {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td style="font-weight: 700; color: #fff;">${school.name}</td>
        <td style="font-weight: 600;">${school.admins_count} admins</td>
        <td style="font-weight: 600; color: var(--color-purple);">${school.elections_count} elections</td>
        <td style="text-align: right;">
          <button class="btn btn-text btn-danger-action" style="padding: 6px 12px; font-size: 0.8rem;">
            <i class="fa-solid fa-trash-can"></i> Delete
          </button>
        </td>
      `;
      tbody.appendChild(row);
      
      row.querySelector('.btn-danger-action').addEventListener('click', () => deleteSchool(school.name));
    });
  } catch (err) {
    showToast('Failed to load pre-approved schools stats.', 'error');
  }
}

async function handleAddSchoolSubmit(e) {
  e.preventDefault();
  const input = document.getElementById('sa-school-name-input');
  const name = input.value.trim();
  if (!name) return;
  
  try {
    const res = await fetch('/api/superadmin/schools', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    
    const data = await res.json();
    if (res.ok && data.success) {
      showToast(data.message, 'success');
      input.value = '';
      loadSuperAdminSchools();
      loadSchoolsList(); // Refresh voter search dropdown
      loadAdminSignupSchools(); // Refresh admin registration dropdown
    } else {
      showToast(data.error || 'Failed to add school.', 'error');
    }
  } catch (err) {
    showToast('Connection error adding school.', 'error');
  }
}

async function loadSuperAdminOverview() {
  try {
    const res = await fetch('/api/superadmin/overview');
    const data = await res.json();
    
    if (!res.ok || !data.success) {
      showToast('Failed to load system overview statistics.', 'error');
      return;
    }
    
    // Populate stats cards
    document.getElementById('sa-stat-schools').innerText = data.stats.totalSchools;
    document.getElementById('sa-stat-admins').innerText = data.stats.totalAdmins;
    document.getElementById('sa-stat-elections').innerText = data.stats.totalElections;
    document.getElementById('sa-stat-active-elections').innerText = data.stats.activeElections;
    document.getElementById('sa-stat-votes').innerText = data.stats.totalVotesCast;
    
    // Populate Elections Monitor Table
    const electionsTbody = document.getElementById('sa-overview-elections-tbody');
    electionsTbody.innerHTML = '';
    
    if (data.elections.length === 0) {
      electionsTbody.innerHTML = '<tr><td colspan="6" class="text-center">No elections created yet.</td></tr>';
    } else {
      data.elections.forEach(e => {
        const row = document.createElement('tr');
        const turnoutPct = e.total_voters > 0 ? ((e.voted_count / e.total_voters) * 100).toFixed(0) : 0;
        const scopeText = e.scope === 'School-Wide' ? 'School-Wide' : `${e.scope}: ${e.scope_name}`;
        
        let statusBadge = '';
        const now = Date.now();
        
        if (e.status === 'ended' || now > e.end_time) {
          statusBadge = `<span class="badge" style="color: var(--text-muted); background: rgba(255,255,255,0.05); border-color: rgba(255,255,255,0.1);">Ended</span>`;
        } else if (e.status === 'active') {
          statusBadge = `<span class="badge" style="color: var(--color-emerald); background: rgba(16,185,129,0.1); border-color: rgba(16,185,129,0.3);"><i class="fa-solid fa-spinner animate-spin" style="font-size: 0.65rem; margin-right: 4px;"></i> Live</span>`;
        } else {
          statusBadge = `<span class="badge" style="color: var(--color-blue); background: rgba(59,130,246,0.1); border-color: rgba(59,130,246,0.3);">Scheduled</span>`;
        }
        
        row.innerHTML = `
          <td style="font-weight: 600;">${e.school}</td>
          <td style="font-weight: 600; color: #fff;">${e.title}</td>
          <td>${scopeText}</td>
          <td>${e.candidates_count} candidates</td>
          <td style="font-family: monospace;">${e.voted_count} / ${e.total_voters} (${turnoutPct}%)</td>
          <td>${statusBadge}</td>
        `;
        electionsTbody.appendChild(row);
      });
    }
    
    // Populate Registered Admins & Schools Table
    const schoolsTbody = document.getElementById('sa-overview-schools-tbody');
    schoolsTbody.innerHTML = '';
    
    if (data.schoolAdmins.length === 0) {
      schoolsTbody.innerHTML = '<tr><td colspan="4" class="text-center">No registered schools or administrators.</td></tr>';
    } else {
      data.schoolAdmins.forEach(sa => {
        const row = document.createElement('tr');
        const signupDate = new Date(sa.created_at).toLocaleDateString();
        
        row.innerHTML = `
          <td style="font-weight: 700; color: #fff;">${sa.school}</td>
          <td style="font-weight: 600;">${sa.admin_name}</td>
          <td>${signupDate}</td>
          <td style="font-weight: 600; color: var(--color-purple);">${sa.elections_count} elections</td>
          <td style="text-align: right;">
            <button class="btn btn-text btn-danger-action" style="padding: 6px 12px; font-size: 0.8rem;">
              <i class="fa-solid fa-trash-can"></i> Delete
            </button>
          </td>
        `;
        schoolsTbody.appendChild(row);
        
        row.querySelector('.btn-danger-action').addEventListener('click', () => deleteSchool(sa.school));
      });
    }
    
  } catch (err) {
    console.error('Error loading Super Admin overview:', err);
    showToast('Failed to load system overview details.', 'error');
  }
}

async function deleteSchool(schoolName) {
  if (schoolName === 'Veritas University') {
    showToast('Cannot delete the default demo school Veritas University.', 'error');
    return;
  }
  
  if (!confirm(`WARNING: Are you absolutely sure you want to delete '${schoolName}'? This will permanently delete the school administrator, all candidates, voter codes, active/past elections, and results for this school. This action is irreversible.`)) {
    return;
  }
  
  try {
    const res = await fetch(`/api/superadmin/schools/${encodeURIComponent(schoolName)}`, {
      method: 'DELETE'
    });
    
    const data = await res.json();
    if (res.ok && data.success) {
      showToast(data.message, 'success');
      loadSuperAdminOverview();
      loadSuperAdminSchools();
    } else {
      showToast(data.error || 'Failed to delete school.', 'error');
    }
  } catch (err) {
    showToast('Connection error deleting school.', 'error');
  }
}

async function loadSuperAdminCodes() {
  try {
    const res = await fetch('/api/superadmin/codes');
    const codes = await res.json();
    
    const tbody = document.getElementById('sa-codes-tbody');
    tbody.innerHTML = '';
    
    if (codes.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="text-center">No invitation codes generated yet. Click "Generate invite Code" to begin.</td></tr>';
      return;
    }
    
    codes.forEach(c => {
      const row = document.createElement('tr');
      const dateStr = new Date(c.created_at).toLocaleDateString();
      
      row.innerHTML = `
        <td style="font-family: monospace; font-weight: 700; font-size: 1rem;">${c.code}</td>
        <td>
          <span class="badge ${c.used === 1 ? 'scope-badge' : ''}" style="color: ${c.used === 1 ? 'var(--color-rose)' : 'var(--color-emerald)'}; background: ${c.used === 1 ? 'rgba(244,63,94,0.1)' : 'rgba(16,185,129,0.1)'};">
            ${c.used === 1 ? 'Used' : 'Unused'}
          </span>
        </td>
        <td>${c.used_by || '-'}</td>
        <td style="font-weight: 600;">${c.used_for_school || '-'}</td>
        <td>${dateStr}</td>
      `;
      tbody.appendChild(row);
    });
  } catch (err) {
    showToast('Failed to load Super Admin invite registry.', 'error');
  }
}

async function generateAdminCode() {
  try {
    const res = await fetch('/api/superadmin/codes/generate', { method: 'POST' });
    const data = await res.json();
    if (res.ok && data.success) {
      showToast(`Generated code: ${data.code}`, 'success');
      loadSuperAdminCodes();
    } else {
      showToast(data.error || 'Failed to generate code.', 'error');
    }
  } catch (err) {
    showToast('Connection error generating code.', 'error');
  }
}

async function wipePlatformDatabase() {
  if (!confirm('WARNING: THIS WILL WIPE ALL ELECTION RECORDS AND SCHOOLS FROM THE WHOLE SERVER! This action is irreversible.')) {
    return;
  }
  
  try {
    // Wipes everything by not passing a specific school parameter (or triggers special super reset)
    const res = await fetch('/api/admin/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ school: 'Veritas University' }) // Fallback reset for Veritas University
    });
    
    const data = await res.json();
    if (res.ok && data.success) {
      showToast('Platform wiped. Seeded Veritas University demo.', 'success');
      switchView('gateway-view');
      
      // Clear local states
      state.adminUser = null;
      state.selectedSchool = '';
      if (state.countdownInterval) clearInterval(state.countdownInterval);
      state.countdownInterval = null;
      state.activeElection = null;
    } else {
      showToast(data.error || 'Wipe failed.', 'error');
    }
  } catch (err) {
    showToast('Platform connection error.', 'error');
  }
}

// ==========================================
// SCOPED SCHOOL ADMIN PANEL LOGIC
// ==========================================

function setupAdminTabs() {
  const tabs = document.querySelectorAll('#admin-view ul li');
  const contents = document.querySelectorAll('#admin-view .admin-tab');
  
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab;
      
      tabs.forEach(t => t.classList.remove('active'));
      contents.forEach(c => c.classList.remove('active'));
      
      tab.classList.add('active');
      document.getElementById(target).classList.add('active');
      
      if (state.adminUser && !state.adminUser.isSuperAdmin) {
        sessionStorage.setItem('currentAdminTab', target);
      }
      
      if (target === 'tab-manage-candidates') {
        loadAllRegisteredCandidates();
        loadPositionsList();
      } else if (target === 'tab-manage-positions') {
        loadPositionsList();
      } else if (target === 'tab-voter-codes') {
        loadVoterCodesList();
      } else if (target === 'tab-create-election') {
        loadCandidatesForCreationSelections();
        checkActiveElectionLock();
      }
    });
  });
  
  // Custom scope selection visibility toggle
  const scopeSelect = document.getElementById('election-scope-select');
  const scopeNameContainer = document.getElementById('scope-name-container');
  
  scopeSelect.addEventListener('change', () => {
    if (scopeSelect.value === 'School-Wide') {
      scopeNameContainer.style.display = 'none';
      document.getElementById('election-scope-name-input').required = false;
    } else {
      scopeNameContainer.style.display = 'flex';
      document.getElementById('election-scope-name-input').placeholder = 
        scopeSelect.value === 'Faculty' ? 'e.g. Faculty of Science' : 'e.g. Computer Science Department';
      document.getElementById('election-scope-name-input').required = true;
    }
  });

  // Toggle add candidate form collapsible
  document.getElementById('btn-toggle-add-candidate').addEventListener('click', () => {
    const formBox = document.getElementById('add-candidate-form-container');
    const isHidden = formBox.style.display === 'none';
    formBox.style.display = isHidden ? 'block' : 'none';
  });

  document.getElementById('btn-cancel-candidate').addEventListener('click', () => {
    document.getElementById('add-candidate-form-container').style.display = 'none';
    document.getElementById('add-candidate-form').reset();
  });
  
  // Custom image file upload vs radio preset
  const avatarFileGroup = document.getElementById('avatar-file-group');
  document.querySelectorAll('input[name="candidate-avatar"]').forEach(radio => {
    radio.addEventListener('change', () => {
      if (radio.value === 'custom') {
        avatarFileGroup.style.display = 'flex';
        document.getElementById('candidate-image-file').required = true;
      } else {
        avatarFileGroup.style.display = 'none';
        document.getElementById('candidate-image-file').required = false;
      }
    });
  });
  // Custom voter code generation method toggle
  document.querySelectorAll('input[name="voter-code-method"]').forEach(radio => {
    radio.addEventListener('change', () => {
      const isRandom = radio.value === 'random';
      document.getElementById('method-random-container').style.display = isRandom ? 'block' : 'none';
      document.getElementById('method-list-container').style.display = isRandom ? 'none' : 'block';
      
      // Update required states
      document.getElementById('election-voters-input').required = isRandom;
      document.getElementById('election-voters-list-input').required = !isRandom;
    });
  });

  // CSV file upload: parse and populate textarea
  const csvFileInput = document.getElementById('election-voters-csv-file');
  const csvFileNameSpan = document.getElementById('csv-file-name');
  const matricTextarea = document.getElementById('election-voters-list-input');

  // Store original CSV rows for download later (header + data)
  state.csvOriginalRows = [];
  state.csvMatricColumnIndex = -1;
  state.csvNameColumnIndex = -1;
  state.csvParsedMapping = {};

  csvFileInput.addEventListener('change', () => {
    const file = csvFileInput.files[0];
    if (!file) {
      csvFileNameSpan.innerText = 'No file chosen';
      return;
    }
    csvFileNameSpan.innerText = file.name;

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target.result;
      // Support both \r\n and \n line endings
      const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
      if (lines.length === 0) {
        showToast('The CSV file appears to be empty.', 'error');
        return;
      }

      // Parse CSV - handle quoted fields
      const parseCSVLine = (line) => {
        const result = [];
        let inQuotes = false;
        let current = '';
        for (let i = 0; i < line.length; i++) {
          const ch = line[i];
          if (ch === '"') {
            inQuotes = !inQuotes;
          } else if (ch === ',' && !inQuotes) {
            result.push(current.trim());
            current = '';
          } else {
            current += ch;
          }
        }
        result.push(current.trim());
        return result;
      };

      const headerRow = parseCSVLine(lines[0]);
      const headerLower = headerRow.map(h => h.toLowerCase().replace(/[^a-z0-9_]/g, ''));

      // Detect matric column index
      let matricColIdx = -1;
      const matricKeywords = ['matric', 'matricnumber', 'matricno', 'studentid', 'id', 'studentno', 'regno', 'regnum'];
      for (const kw of matricKeywords) {
        const idx = headerLower.findIndex(h => h === kw || h.includes('matric') || h.includes('regn'));
        if (idx !== -1) {
          matricColIdx = idx;
          break;
        }
      }
      // Fallback: use first column
      if (matricColIdx === -1) matricColIdx = 0;

      // Detect name column index
      let nameColIdx = -1;
      const nameKeywords = ['name', 'fullname', 'studentname', 'surname', 'firstname', 'lastname'];
      for (const kw of nameKeywords) {
        const idx = headerLower.findIndex(h => h.includes('name') || h === kw);
        if (idx !== -1 && idx !== matricColIdx) {
          nameColIdx = idx;
          break;
        }
      }

      state.csvMatricColumnIndex = matricColIdx;
      state.csvNameColumnIndex = nameColIdx;
      state.csvOriginalRows = lines.map(l => parseCSVLine(l));
      state.csvHeader = headerRow;

      state.csvParsedMapping = {};
      const dataRows = lines.slice(1);
      const matricNumbers = [];

      dataRows.forEach(l => {
        const row = parseCSVLine(l);
        const matric = row[matricColIdx] ? row[matricColIdx].trim() : '';
        if (matric) {
          matricNumbers.push(matric);
          if (nameColIdx >= 0 && row[nameColIdx]) {
            state.csvParsedMapping[matric.toUpperCase()] = row[nameColIdx].trim();
          }
        }
      });

      if (matricNumbers.length === 0) {
        showToast('Could not find any matric numbers in the uploaded CSV.', 'error');
        return;
      }

      matricTextarea.value = matricNumbers.join('\n');
      const nameInfo = nameColIdx >= 0 ? ` (with names from "${headerRow[nameColIdx]}" column)` : '';
      showToast(`Parsed ${matricNumbers.length} students from "${file.name}"${nameInfo}.`, 'success');
    };
    reader.onerror = () => {
      showToast('Failed to read the CSV file.', 'error');
    };
    reader.readAsText(file);
  });
  
  
  // Setup Super Admin Sidebar tabs
  const saTabs = document.querySelectorAll('#super-admin-view ul li');
  const saContents = document.querySelectorAll('#super-admin-view .admin-tab');
  
  saTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab;
      
      saTabs.forEach(t => t.classList.remove('active'));
      saContents.forEach(c => c.classList.remove('active'));
      
      tab.classList.add('active');
      document.getElementById(target).classList.add('active');
      
      if (state.adminUser && state.adminUser.isSuperAdmin) {
        sessionStorage.setItem('currentSuperAdminTab', target);
      }
      
      if (target === 'tab-sa-codes') {
        loadSuperAdminCodes();
      } else if (target === 'tab-sa-overview') {
        loadSuperAdminOverview();
      } else if (target === 'tab-sa-schools') {
        loadSuperAdminSchools();
      }
    });
  });
}

// 1. Fetch Positions list (Scoped)
async function loadPositionsList() {
  if (!state.selectedSchool) return;
  try {
    const adminParam = state.adminUser ? `&adminName=${encodeURIComponent(state.adminUser.name)}` : '';
    const res = await fetch(`/api/positions?school=${encodeURIComponent(state.selectedSchool)}${adminParam}`);
    const positions = await res.json();
    state.positions = positions;
    
    // A. Populate dropdown select in Add Candidate Form
    const select = document.getElementById('candidate-role-select');
    if (select) {
      select.innerHTML = '';
      if (positions.length === 0) {
        select.innerHTML = '<option value="">-- Add a position first --</option>';
      } else {
        positions.forEach(pos => {
          const opt = document.createElement('option');
          opt.value = pos;
          opt.innerText = pos;
          select.appendChild(opt);
        });
      }
    }
    
    // B. Populate Positions table list
    const tbody = document.getElementById('positions-admin-tbody');
    if (tbody) {
      tbody.innerHTML = '';
      if (positions.length === 0) {
        tbody.innerHTML = '<tr><td colspan="2" class="text-center">No positions registered. Please add one.</td></tr>';
        return;
      }
      
      positions.forEach(pos => {
        const row = document.createElement('tr');
        row.innerHTML = `
          <td style="font-weight: 600;">${pos}</td>
          <td style="text-align: right;">
            <button class="btn btn-text btn-danger-action">
              <i class="fa-solid fa-trash-can"></i> Remove
            </button>
          </td>
        `;
        tbody.appendChild(row);
        
        row.querySelector('.btn-danger-action').addEventListener('click', () => deletePosition(pos));
      });
    }
  } catch (err) {
    showToast('Failed to load positions list.', 'error');
  }
}

// Add position
async function handleAddPositionSubmit(e) {
  e.preventDefault();
  const input = document.getElementById('position-name-input');
  const name = input.value.trim();
  
  try {
    const res = await fetch('/api/positions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        name, 
        school: state.selectedSchool,
        adminName: state.adminUser ? state.adminUser.name : null
      })
    });
    
    const data = await res.json();
    if (res.ok && data.success) {
      showToast(data.message, 'success');
      input.value = '';
      loadPositionsList();
    } else {
      showToast(data.error || 'Failed to add position.', 'error');
    }
  } catch (err) {
    showToast('Connection error.', 'error');
  }
}

// Delete position
async function deletePosition(name) {
  if (!confirm(`Are you sure you want to delete the '${name}' position? This will delete all candidates associated with it.`)) {
    return;
  }
  
  try {
    const adminParam = state.adminUser ? `&adminName=${encodeURIComponent(state.adminUser.name)}` : '';
    const res = await fetch(`/api/positions/${encodeURIComponent(name)}?school=${encodeURIComponent(state.selectedSchool)}${adminParam}`, {
      method: 'DELETE'
    });
    
    const data = await res.json();
    if (res.ok && data.success) {
      showToast(data.message, 'success');
      loadPositionsList();
    } else {
      showToast(data.error || 'Failed to delete position.', 'error');
    }
  } catch (err) {
    showToast('Connection error.', 'error');
  }
}

// 2. Fetch Candidates list (Scoped)
async function loadAllRegisteredCandidates() {
  if (!state.selectedSchool) return;
  try {
    const adminParam = state.adminUser ? `&adminName=${encodeURIComponent(state.adminUser.name)}` : '';
    const res = await fetch(`/api/admin/candidates?school=${encodeURIComponent(state.selectedSchool)}${adminParam}`);
    const candidates = await res.json();
    state.allRegisteredCandidates = candidates;
    
    const tbody = document.getElementById('candidates-admin-tbody');
    tbody.innerHTML = '';
    
    if (candidates.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="text-center">No candidates registered. Click "Add New Candidate" to create profiles.</td></tr>';
      return;
    }
    
    candidates.forEach(cand => {
      const row = document.createElement('tr');
      
      const avatarTd = document.createElement('td');
      const av = document.createElement('div');
      av.className = 'table-avatar';
      if (cand.image_data && cand.image_data.startsWith('data:image')) {
        av.style.backgroundImage = `url(${cand.image_data})`;
      } else if (cand.image_data) {
        av.classList.add(cand.image_data);
      } else {
        av.innerHTML = '<i class="fa-solid fa-user" style="display: flex; height: 100%; align-items: center; justify-content: center; color: var(--text-muted);"></i>';
        av.style.backgroundColor = 'rgba(255,255,255,0.05)';
      }
      avatarTd.appendChild(av);
      row.appendChild(avatarTd);
      
      const nameTd = document.createElement('td');
      nameTd.innerText = cand.name;
      nameTd.style.fontWeight = '700';
      row.appendChild(nameTd);
      
      const roleTd = document.createElement('td');
      roleTd.innerHTML = `<span class="badge scope-badge">${cand.role}</span>`;
      row.appendChild(roleTd);
      
      const bioTd = document.createElement('td');
      bioTd.innerText = cand.bio || '-';
      bioTd.style.fontSize = '0.85rem';
      row.appendChild(bioTd);
      
      const deleteTd = document.createElement('td');
      deleteTd.style.textAlign = 'right';
      deleteTd.innerHTML = `
        <button class="btn btn-text btn-danger-action">
          <i class="fa-solid fa-trash-can"></i> Delete
        </button>
      `;
      row.appendChild(deleteTd);
      tbody.appendChild(row);
      
      deleteTd.querySelector('.btn-danger-action').addEventListener('click', () => deleteCandidate(cand.id, cand.name));
    });
  } catch (err) {
    showToast('Failed to load candidate registry.', 'error');
  }
}

// Add Candidate
async function handleAddCandidateSubmit(e) {
  e.preventDefault();
  
  const name = document.getElementById('candidate-name-input').value.trim();
  const role = document.getElementById('candidate-role-select').value;
  const bio = document.getElementById('candidate-bio-input').value.trim();
  
  if (!role) {
    showToast('Please select a position.', 'error');
    return;
  }
  
  const avatarRadio = document.querySelector('input[name="candidate-avatar"]:checked').value;
  let imageData = avatarRadio;
  
  if (avatarRadio === 'custom') {
    const fileInput = document.getElementById('candidate-image-file');
    if (fileInput.files.length > 0) {
      const file = fileInput.files[0];
      try {
        imageData = await convertFileToBase64(file);
      } catch (err) {
        showToast('Image processing failed. Using default avatar.', 'error');
        imageData = 'avatar_alice';
      }
    } else {
      showToast('Please select a file for custom upload.', 'error');
      return;
    }
  }

  try {
    const res = await fetch('/api/admin/candidates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        name, 
        role, 
        school: state.selectedSchool, 
        bio, 
        image_data: imageData,
        adminName: state.adminUser ? state.adminUser.name : null
      })
    });
    
    const data = await res.json();
    if (res.ok && data.success) {
      showToast(`Candidate ${name} registered successfully!`, 'success');
      document.getElementById('add-candidate-form').reset();
      document.getElementById('add-candidate-form-container').style.display = 'none';
      document.getElementById('avatar-file-group').style.display = 'none';
      loadAllRegisteredCandidates();
    } else {
      showToast(data.error || 'Failed to save candidate.', 'error');
    }
  } catch (err) {
    showToast('Network error saving candidate.', 'error');
  }
}

// Delete Candidate
async function deleteCandidate(id, name) {
  if (!confirm(`Are you sure you want to delete '${name}' from the registry?`)) {
    return;
  }
  
  try {
    const res = await fetch(`/api/admin/candidates/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (res.ok && data.success) {
      showToast(data.message, 'success');
      loadAllRegisteredCandidates();
    } else {
      showToast(data.error || 'Failed to remove candidate.', 'error');
    }
  } catch (err) {
    showToast('Connection error deleting candidate.', 'error');
  }
}

function convertFileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result);
    reader.onerror = error => reject(error);
  });
}

// 3. Render Candidate Checkboxes Grouped dynamically (Create Election tab)
async function loadCandidatesForCreationSelections() {
  const container = document.getElementById('admin-candidates-by-position-container');
  container.innerHTML = '';
  
  await loadPositionsList();
  await loadAllRegisteredCandidates();
  
  if (state.positions.length === 0) {
    container.innerHTML = '<p class="small-muted">Please configure positions under the "Positions" tab first.</p>';
    return;
  }
  if (state.allRegisteredCandidates.length === 0) {
    container.innerHTML = '<p class="small-muted">Please add candidate profiles under the "Candidates" tab first.</p>';
    return;
  }
  
  const grouped = {};
  state.allRegisteredCandidates.forEach(c => {
    if (!grouped[c.role]) {
      grouped[c.role] = [];
    }
    grouped[c.role].push(c);
  });
  
  state.positions.forEach(pos => {
    const section = document.createElement('div');
    section.className = 'role-selection-group mt-3';
    
    const candidates = grouped[pos] || [];
    let checkboxListHTML = '';
    
    if (candidates.length === 0) {
      checkboxListHTML = `<p class="small-muted" style="padding: 10px 0;">No candidates registered for ${pos}.</p>`;
    } else {
      checkboxListHTML = '<div class="checkbox-list">';
      candidates.forEach(c => {
        checkboxListHTML += `
          <label>
            <input type="checkbox" name="admin-create-election-cands" value="${c.id}" checked> ${c.name}
          </label>
        `;
      });
      checkboxListHTML += '</div>';
    }
    
    section.innerHTML = `
      <h4>${pos} Candidates</h4>
      ${checkboxListHTML}
    `;
    container.appendChild(section);
  });
}

// 4. Create Election Form Submit (Scoped)
async function handleCreateElectionSubmit(e) {
  e.preventDefault();
  
  const title = document.getElementById('election-title-input').value.trim();
  const institution = document.getElementById('election-inst-input').value.trim();
  const scope = document.getElementById('election-scope-select').value;
  const scopeName = document.getElementById('election-scope-name-input').value.trim();
  const durationMinutes = document.getElementById('election-duration-input').value;
  const votersCount = document.getElementById('election-voters-input').value;
  
  const methodRadio = document.querySelector('input[name="voter-code-method"]:checked');
  const voterCodeMethod = methodRadio ? methodRadio.value : 'random';
  
  let matricNumbers = [];
  let studentNames = [];
  if (voterCodeMethod === 'list') {
    const listText = document.getElementById('election-voters-list-input').value.trim();
    if (!listText) {
      showToast('Please provide a list of student matriculation numbers.', 'error');
      return;
    }
    const lines = listText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    
    lines.forEach((line) => {
      const parts = line.split(/[\t,;]/);
      if (parts.length > 1) {
        matricNumbers.push(parts[0].trim());
        studentNames.push(parts.slice(1).join(' ').trim());
      } else {
        const matric = line.trim();
        matricNumbers.push(matric);
        const nameFromCsv = state.csvParsedMapping && state.csvParsedMapping[matric.toUpperCase()];
        studentNames.push(nameFromCsv || '');
      }
    });

    if (matricNumbers.length === 0) {
      showToast('Eligible student matric numbers list cannot be empty.', 'error');
      return;
    }
  }

  const checkboxes = Array.from(document.querySelectorAll('input[name="admin-create-election-cands"]:checked'));
  const checkedIds = checkboxes.map(cb => parseInt(cb.value));
  
  if (checkedIds.length === 0) {
    showToast('You must select at least one candidate to start an election.', 'error');
    return;
  }
  
  const selectedCandidates = [];
  checkedIds.forEach(id => {
    const match = state.allRegisteredCandidates.find(c => c.id === id);
    if (match) {
      selectedCandidates.push({
        name: match.name,
        role: match.role,
        bio: match.bio,
        image_data: match.image_data
      });
    }
  });
  
  const positionsInElection = [...new Set(selectedCandidates.map(c => c.role))];
  if (positionsInElection.length === 0) {
    showToast('Election has no candidates.', 'error');
    return;
  }
  
  try {
    const res = await fetch('/api/admin/election/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title,
        institution,
        scope,
        scopeName: scope === 'School-Wide' ? null : scopeName,
        durationMinutes,
        voterIdCount: voterCodeMethod === 'random' ? votersCount : matricNumbers.length,
        candidates: selectedCandidates,
        school: state.selectedSchool,
        voterCodeMethod,
        matricNumbers,
        studentNames: voterCodeMethod === 'list' ? studentNames : [],
        adminName: state.adminUser ? state.adminUser.name : null
      })
    });
    
    const data = await res.json();
    if (res.ok && data.success) {
      showToast('🎉 Election launched successfully!', 'success');
      
      // Prime the lockout flag so the form resets when this election ends
      lockoutWasActive = true;

      // Immediately lock the create form since an election is now active
      checkActiveElectionLock();
      
      loadSchoolElections();
    } else {
      showToast(data.error || 'Failed to create election.', 'error');
    }
  } catch (err) {
    showToast('Network error while launching election.', 'error');
  }
}

// Fetch Generated Voter Codes list (Scoped)
async function loadVoterCodesList() {
  if (!state.selectedSchool) return;
  try {
    const adminParam = state.adminUser ? `&adminName=${encodeURIComponent(state.adminUser.name)}` : '';
    const res = await fetch(`/api/admin/voters?school=${encodeURIComponent(state.selectedSchool)}${adminParam}`);
    const data = await res.json();
    
    const grid = document.getElementById('voters-admin-grid');
    const tableContainer = document.getElementById('voters-table-container');
    const tbody = document.getElementById('voters-admin-tbody');
    const copyMappingBtn = document.getElementById('btn-copy-mapping');
    
    grid.innerHTML = '';
    tbody.innerHTML = '';
    
    if (!data.voterIds || data.voterIds.length === 0) {
      grid.style.display = 'grid';
      tableContainer.style.display = 'none';
      copyMappingBtn.style.display = 'none';
      grid.innerHTML = '<p class="text-center text-muted span-2" style="grid-column: 1 / -1; padding: 20px;">No voter codes generated yet. Launch an election to see codes.</p>';
      return;
    }
    
    // Check if at least one voter has a matric number
    const hasMatricNumbers = data.voterIds.some(v => v.matric_number);
    
    if (hasMatricNumbers) {
      grid.style.display = 'none';
      tableContainer.style.display = 'block';
      copyMappingBtn.style.display = 'block';
      
      data.voterIds.forEach((v, idx) => {
        const row = document.createElement('tr');
        const statusText = v.voted === 1 ? 'Voted' : 'Unused';
        const badgeStyle = v.voted === 1 
          ? 'color: var(--color-rose); background: rgba(244,63,94,0.1); border: 1px solid rgba(244,63,94,0.2);' 
          : 'color: var(--color-emerald); background: rgba(16,185,129,0.1); border: 1px solid rgba(16,185,129,0.2);';
        
        const nameCellVal = v.student_name 
          ? `<span style="font-weight: 600; color: #fff;">${v.student_name}</span>`
          : `<span style="color: var(--text-muted); font-style: italic;">—</span>`;

        row.innerHTML = `
          <td style="color: var(--text-muted); font-size: 0.8rem; width: 40px;">${idx + 1}</td>
          <td>${nameCellVal}</td>
          <td style="font-family: monospace; font-size: 0.9rem; color: var(--text-secondary);">${v.matric_number || '—'}</td>
          <td style="font-family: monospace; font-weight: 700; font-size: 0.95rem; color: #fff; letter-spacing: 1px;">${v.voter_code}</td>
          <td>
            <span class="badge" style="${badgeStyle}">${statusText}</span>
          </td>
        `;
        tbody.appendChild(row);
      });
    } else {
      grid.style.display = 'grid';
      tableContainer.style.display = 'none';
      copyMappingBtn.style.display = 'none';
      
      data.voterIds.forEach(v => {
        const tag = document.createElement('div');
        tag.className = `voter-tag ${v.voted === 1 ? 'used' : 'unused'}`;
        tag.innerHTML = `
          <span>${v.voter_code}</span>
          <span class="tag-status">${v.voted === 1 ? 'voted' : 'unused'}</span>
        `;
        grid.appendChild(tag);
      });
    }
  } catch (err) {
    showToast('Failed to fetch Voter ID list.', 'error');
  }
}

// Download Voter Code CSV Mapping (Scoped)
async function downloadVoterCodeCSV() {
  if (!state.selectedSchool) return;
  try {
    const adminParam = state.adminUser ? `&adminName=${encodeURIComponent(state.adminUser.name)}` : '';
    const res = await fetch(`/api/admin/voters?school=${encodeURIComponent(state.selectedSchool)}${adminParam}`);
    const data = await res.json();
    
    if (!data.voterIds || data.voterIds.length === 0) {
      showToast('No voter codes generated yet.', 'error');
      return;
    }
    
    const voterIds = data.voterIds.filter(v => v.matric_number);
    if (voterIds.length === 0) {
      showToast('No matriculation number mappings found.', 'error');
      return;
    }

    let csvContent = '';

    // If we have original CSV rows cached (from an upload in this session), merge them
    if (state.csvOriginalRows && state.csvOriginalRows.length > 1 && state.csvMatricColumnIndex >= 0) {
      const header = state.csvOriginalRows[0];
      const dataRows = state.csvOriginalRows.slice(1);

      // Build a lookup map: matric number -> voter code & status
      const codeMap = {};
      voterIds.forEach(v => {
        codeMap[v.matric_number.trim().toUpperCase()] = {
          code: v.voter_code,
          status: v.voted === 1 ? 'voted' : 'unused'
        };
      });

      // Build enhanced header
      const newHeader = [...header, 'Voter Code', 'Status'];
      const escapeCsv = (val) => {
        const str = String(val ?? '');
        return str.includes(',') || str.includes('"') || str.includes('\n')
          ? `"${str.replace(/"/g, '""')}"`
          : str;
      };

      const rows = [newHeader.map(escapeCsv).join(',')];
      dataRows.forEach(row => {
        const matric = (row[state.csvMatricColumnIndex] || '').trim().toUpperCase();
        const mapping = codeMap[matric] || { code: '', status: '' };
        const newRow = [...row, mapping.code, mapping.status];
        rows.push(newRow.map(escapeCsv).join(','));
      });
      csvContent = rows.join('\n');
    } else {
      // Fallback: generate basic CSV with name + matric + code + status
      const escapeCsv = (val) => {
        const str = String(val ?? '');
        return str.includes(',') || str.includes('"') || str.includes('\n')
          ? `"${str.replace(/"/g, '""')}"`
          : str;
      };
      const rows = [['Student Name', 'Matric Number', 'Voter Code', 'Status'].join(',')];
      voterIds.forEach(v => {
        rows.push([v.student_name || '', v.matric_number || '', v.voter_code, v.voted === 1 ? 'voted' : 'unused'].map(escapeCsv).join(','));
      });
      csvContent = rows.join('\n');
    }

    // Trigger download
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `verivote_voter_codes_${state.selectedSchool.replace(/\s+/g, '_')}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    showToast('Voter code spreadsheet downloaded successfully!', 'success');
  } catch (err) {
    showToast('Failed to generate CSV download.', 'error');
  }
}

// Copy Unused Voter Codes Helper (Scoped)
async function copyUnusedVoterCodes() {
  if (!state.selectedSchool) return;
  try {
    const adminParam = state.adminUser ? `&adminName=${encodeURIComponent(state.adminUser.name)}` : '';
    const res = await fetch(`/api/admin/voters?school=${encodeURIComponent(state.selectedSchool)}${adminParam}`);
    const data = await res.json();
    
    if (!data.voterIds || data.voterIds.length === 0) {
      showToast('No voter codes generated yet.', 'error');
      return;
    }
    
    const unusedCodes = data.voterIds.filter(v => v.voted === 0).map(v => v.voter_code).join('\n');
    if (!unusedCodes) {
      showToast('All voter codes have already been used!', 'error');
      return;
    }
    
    await navigator.clipboard.writeText(unusedCodes);
    showToast('Unused Voter Codes copied to clipboard!', 'success');
  } catch (err) {
    showToast('Failed to copy to clipboard.', 'error');
  }
}

// Reset Scoped School Data (Danger Zone)
async function resetEntireSystem() {
  if (!confirm(`Are you absolutely sure? This will delete ALL past and present election records, voter IDs, global registry candidates, and dynamic positions for ${state.selectedSchool}!`)) {
    return;
  }
  
  try {
    const res = await fetch('/api/admin/reset', { 
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ school: state.selectedSchool })
    });
    const data = await res.json();
    
    if (res.ok && data.success) {
      showToast(data.message, 'success');
      
      if (state.countdownInterval) clearInterval(state.countdownInterval);
      state.countdownInterval = null;
      state.activeElection = null;
      sessionStorage.removeItem('activeElection');
      
      switchView('landing-view');
      loadSchoolElections();
      
      const defaultTab = document.querySelector('#admin-view [data-tab="tab-create-election"]');
      if (defaultTab) defaultTab.click();
    } else {
      showToast(data.error || 'System reset failed.', 'error');
    }
  } catch (err) {
    showToast('Network error during reset.', 'error');
  }
}

// ==========================================
// CONFETTI CELEBRATION ENGINE
// ==========================================

let confettiActive = false;
let confettiAnimationId = null;
const confettiColors = ['#3b82f6', '#8b5cf6', '#10b981', '#fbbf24', '#ec4899', '#f59e0b'];
let particles = [];

function startConfetti() {
  const canvas = document.getElementById('confetti-canvas');
  if (!canvas) return;
  
  const ctx = canvas.getContext('2d');
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  
  window.addEventListener('resize', () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  });
  
  particles = [];
  for (let i = 0; i < 150; i++) {
    particles.push({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height - canvas.height,
      r: Math.random() * 6 + 4,
      d: Math.random() * canvas.height,
      color: confettiColors[Math.floor(Math.random() * confettiColors.length)],
      tilt: Math.random() * 10 - 5,
      tiltAngleIncremental: Math.random() * 0.07 + 0.02,
      tiltAngle: 0
    });
  }
  
  confettiActive = true;
  
  function draw() {
    if (!confettiActive) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    particles.forEach((p, index) => {
      p.tiltAngle += p.tiltAngleIncremental;
      p.y += (Math.cos(p.d) + 3 + p.r / 2) / 2;
      p.x += Math.sin(p.tiltAngle);
      p.tilt = Math.sin(p.tiltAngle - index / 3) * 15;
      
      ctx.beginPath();
      ctx.lineWidth = p.r;
      ctx.strokeStyle = p.color;
      ctx.moveTo(p.x + p.tilt + p.r / 2, p.y);
      ctx.lineTo(p.x + p.tilt, p.y + p.tilt + p.r / 2);
      ctx.stroke();
      
      if (p.y > canvas.height) {
        particles[index] = {
          x: Math.random() * canvas.width,
          y: -20,
          r: p.r,
          d: p.d,
          color: p.color,
          tilt: p.tilt,
          tiltAngleIncremental: p.tiltAngleIncremental,
          tiltAngle: p.tiltAngle
        };
      }
    });
    
    confettiAnimationId = requestAnimationFrame(draw);
  }
  
  draw();
}

function stopConfetti() {
  confettiActive = false;
  if (confettiAnimationId) {
    cancelAnimationFrame(confettiAnimationId);
    confettiAnimationId = null;
  }
  const canvas = document.getElementById('confetti-canvas');
  if (canvas) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
}

// ==========================================
// INITIALIZATION & LISTENERS
// ==========================================

function initApp() {
  // Check local file protocol block
  if (window.location.protocol === 'file:') {
    showToast('Backend Disconnected! Open http://localhost:3000 in your browser.', 'error');
    document.getElementById('status-text').innerText = 'Open http://localhost:3000 to connect';
    document.getElementById('status-title').innerText = 'You opened the local file directly. To run securely, the website must be accessed via the local server host.';
    return;
  }

  // Initialize DOM views
  views = {
    gateway: document.getElementById('gateway-view'),
    voterSchool: document.getElementById('voter-school-view'),
    landing: document.getElementById('landing-view'),
    voterAuth: document.getElementById('voter-auth-view'),
    voterBallot: document.getElementById('voter-ballot-view'),
    voterWaiting: document.getElementById('voter-waiting-view'),
    results: document.getElementById('results-view'),
    adminGate: document.getElementById('admin-gate-view'),
    admin: document.getElementById('admin-view'),
    superAdmin: document.getElementById('super-admin-view')
  };

  // Initialize DOM nav elements
  nav = {
    logo: document.getElementById('nav-logo'),
    home: document.getElementById('nav-home-btn'),
    admin: document.getElementById('nav-admin-btn')
  };

  // Setup Auth tabs Signin vs Signup
  setupAuthTabs();
  
  // Setup Admin panels Sidebar Tabs
  setupAdminTabs();
  
  // Top Navigation clicks
  nav.logo.addEventListener('click', () => {
    if (state.adminUser) {
      switchView('admin-view');
    } else if (state.selectedSchool) {
      switchView('landing-view');
      loadSchoolElections();
    } else {
      switchView('gateway-view');
    }
  });

  nav.home.addEventListener('click', () => {
    if (state.countdownInterval) clearInterval(state.countdownInterval);
    state.countdownInterval = null;
    state.selectedSchool = '';
    state.adminUser = null;
    sessionStorage.clear();
    switchView('gateway-view');
  });

  nav.admin.addEventListener('click', () => {
    if (state.adminUser) {
      switchView('admin-view');
    } else {
      switchView('admin-gate-view');
    }
  });
  
  // 1. Gateway view action buttons
  document.getElementById('btn-gateway-voter').addEventListener('click', () => {
    loadSchoolsList();
    switchView('voter-school-view');
  });

  document.getElementById('btn-gateway-admin').addEventListener('click', () => {
    switchView('admin-gate-view');
  });

  // 2. Voter School search
  document.getElementById('btn-enter-school-portal').addEventListener('click', enterSchoolPortal);
  document.getElementById('btn-school-back').addEventListener('click', () => switchView('gateway-view'));

  // 3. School Landing View
  document.getElementById('btn-landing-back').addEventListener('click', () => {
    if (state.countdownInterval) clearInterval(state.countdownInterval);
    state.countdownInterval = null;
    state.selectedSchool = '';
    sessionStorage.removeItem('selectedSchool');
    loadSchoolsList();
    switchView('voter-school-view');
  });

  // 4. Voter Authentication back button
  document.getElementById('btn-auth-back').addEventListener('click', () => switchView('landing-view'));
  
  // Submit handlers
  document.getElementById('voter-login-form').addEventListener('submit', handleVoterAuthSubmit);
  document.getElementById('btn-submit-ballot').addEventListener('click', handleBallotSubmit);
  
  // Confirm modal voting confirmation actions
  document.getElementById('btn-confirm-vote-yes').addEventListener('click', castSecureBallot);
  document.getElementById('btn-confirm-vote-no').addEventListener('click', () => {
    document.getElementById('confirm-modal').classList.remove('active');
  });
  
  // Waiting screen logout
  document.getElementById('btn-waiting-logout').addEventListener('click', () => {
    state.voterCode = '';
    state.activeElection = null;
    sessionStorage.removeItem('voterCode');
    sessionStorage.removeItem('activeElection');
    switchView('landing-view');
    loadSchoolElections();
  });
  
  // Results page back home
  document.getElementById('btn-results-home').addEventListener('click', () => {
    state.voterCode = '';
    state.activeElection = null;
    state.resultsElectionId = null;
    sessionStorage.removeItem('voterCode');
    sessionStorage.removeItem('activeElection');
    sessionStorage.removeItem('resultsElectionId');
    switchView('landing-view');
    loadSchoolElections();
  });
  
  // Admin Sign in and Sign up form submissions
  document.getElementById('admin-signup-form').addEventListener('submit', handleAdminSignup);
  document.getElementById('admin-login-form').addEventListener('submit', handleAdminLogin);

  // Password show/hide toggles
  document.querySelectorAll('.btn-toggle-pw').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.dataset.target;
      const input = document.getElementById(targetId);
      if (!input) return;
      const isPassword = input.type === 'password';
      input.type = isPassword ? 'text' : 'password';
      btn.innerHTML = isPassword
        ? '<i class="fa-solid fa-eye-slash"></i>'
        : '<i class="fa-solid fa-eye"></i>';
    });
  });
  document.getElementById('admin-super-form').addEventListener('submit', handleSuperAdminLogin);
  document.getElementById('btn-admin-gate-back').addEventListener('click', () => switchView('gateway-view'));

  // Super Admin Control Panel Buttons
  document.getElementById('btn-sa-generate-code').addEventListener('click', generateAdminCode);
  document.getElementById('btn-sa-reset-system').addEventListener('click', wipePlatformDatabase);
  document.getElementById('sa-add-school-form').addEventListener('submit', handleAddSchoolSubmit);

  // School Admin Panel Action Buttons
  document.getElementById('add-candidate-form').addEventListener('submit', handleAddCandidateSubmit);
  document.getElementById('add-position-form').addEventListener('submit', handleAddPositionSubmit);
  document.getElementById('create-election-form').addEventListener('submit', handleCreateElectionSubmit);
  document.getElementById('btn-copy-all-voters').addEventListener('click', copyUnusedVoterCodes);
  document.getElementById('btn-copy-mapping').addEventListener('click', downloadVoterCodeCSV);
  document.getElementById('btn-reset-system').addEventListener('click', resetEntireSystem);

  // New Back/Logout and Footer click handlers
  document.getElementById('btn-ballot-back').addEventListener('click', () => {
    if (confirm('Are you sure you want to exit the ballot? Your votes will not be cast.')) {
      if (state.countdownInterval) clearInterval(state.countdownInterval);
      state.countdownInterval = null;
      state.voterCode = '';
      state.activeElection = null;
      sessionStorage.removeItem('voterCode');
      sessionStorage.removeItem('activeElection');
      switchView('landing-view');
      loadSchoolElections();
    }
  });

  document.getElementById('btn-sa-logout').addEventListener('click', () => {
    state.adminUser = null;
    sessionStorage.clear();
    switchView('gateway-view');
    showToast('Super Admin logged out.', 'info');
  });

  document.getElementById('btn-admin-logout').addEventListener('click', () => {
    state.adminUser = null;
    state.selectedSchool = '';
    sessionStorage.clear();
    switchView('gateway-view');
    showToast('School Administrator logged out.', 'info');
  });

  // Mobile Admin Sidebar Toggle
  const adminMenuToggle = document.getElementById('admin-menu-toggle');
  const adminMenu = document.querySelector('.admin-menu');
  if (adminMenuToggle && adminMenu) {
    adminMenuToggle.addEventListener('click', () => {
      adminMenu.classList.toggle('active');
    });

    // Close menu when clicking any menu item
    adminMenu.querySelectorAll('li').forEach(item => {
      item.addEventListener('click', () => {
        adminMenu.classList.remove('active');
      });
    });
  }

  document.getElementById('foot-home-link').addEventListener('click', (e) => {
    e.preventDefault();
    switchView('gateway-view');
  });

  document.getElementById('foot-admin-link').addEventListener('click', (e) => {
    e.preventDefault();
    switchView('admin-gate-view');
  });

  // ==========================================
  // SESSION REHYDRATION
  // ==========================================
  const savedAdminUser = sessionStorage.getItem('adminUser');
  const savedSelectedSchool = sessionStorage.getItem('selectedSchool');
  const savedCurrentView = sessionStorage.getItem('currentView');
  const savedVoterCode = sessionStorage.getItem('voterCode');
  const savedActiveElection = sessionStorage.getItem('activeElection');
  const savedResultsElectionId = sessionStorage.getItem('resultsElectionId');
  const savedAdminTab = sessionStorage.getItem('currentAdminTab');
  const savedSuperAdminTab = sessionStorage.getItem('currentSuperAdminTab');

  if (savedAdminUser) {
    try {
      state.adminUser = JSON.parse(savedAdminUser);
      if (state.adminUser.isSuperAdmin) {
        enterSuperAdminPortal(savedSuperAdminTab);
      } else {
        state.selectedSchool = state.adminUser.school;
        enterSchoolAdminDashboard(savedAdminTab);
      }
    } catch (e) {
      console.error('Failed to parse saved admin user session', e);
      sessionStorage.clear();
      switchView('gateway-view');
    }
  } else if (savedSelectedSchool) {
    state.selectedSchool = savedSelectedSchool;
    // Update Portal view titles
    const titleElem = document.getElementById('school-landing-title');
    if (titleElem) titleElem.innerText = savedSelectedSchool;

    if (savedCurrentView === 'landing-view') {
      loadSchoolElections();
      switchView('landing-view');
    } else if (savedCurrentView === 'voter-auth-view' && savedActiveElection) {
      try {
        state.activeElection = JSON.parse(savedActiveElection);
        const miniInfo = document.getElementById('auth-election-info');
        if (miniInfo) {
          document.getElementById('auth-election-title').innerText = state.activeElection.title;
          document.getElementById('auth-election-scope').innerText = state.activeElection.scope;
          miniInfo.style.display = 'block';
        }
        loadSchoolElections();
        switchView('voter-auth-view');
      } catch (e) {
        loadSchoolElections();
        switchView('landing-view');
      }
    } else if (savedCurrentView === 'voter-ballot-view' && savedActiveElection && savedVoterCode) {
      try {
        state.activeElection = JSON.parse(savedActiveElection);
        state.voterCode = savedVoterCode;
        loadBallot();
        switchView('voter-ballot-view');
      } catch (e) {
        loadSchoolElections();
        switchView('landing-view');
      }
    } else if (savedCurrentView === 'voter-waiting-view' && savedActiveElection && savedVoterCode) {
      try {
        state.activeElection = JSON.parse(savedActiveElection);
        state.voterCode = savedVoterCode;
        loadWaitingScreen();
      } catch (e) {
        loadSchoolElections();
        switchView('landing-view');
      }
    } else if (savedCurrentView === 'results-view' && savedResultsElectionId) {
      loadResults(savedResultsElectionId);
    } else {
      loadSchoolElections();
      switchView('landing-view');
    }
  } else {
    // No logged in admin or selected school
    if (savedCurrentView === 'admin-gate-view') {
      switchView('admin-gate-view');
    } else if (savedCurrentView === 'voter-school-view') {
      loadSchoolsList();
      switchView('voter-school-view');
    } else {
      switchView('gateway-view');
    }
  }
}

// Start application
document.addEventListener('DOMContentLoaded', initApp);
