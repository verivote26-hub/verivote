const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Initialize DB tables
db.initDatabase().then(() => {
  seedDemoElectionIfNeeded();
});

// Helper: Seed demo active election for Veritas University if empty
async function seedDemoElectionIfNeeded() {
  try {
    const school = 'Veritas University';
    
    // Check if elections exist for Veritas University
    const existingElection = await db.get('SELECT * FROM elections WHERE school = ? LIMIT 1', [school]);
    if (existingElection) {
      console.log('Veritas University already has election data. Skipping demo seed.');
      return;
    }

    console.log('Seeding demo active election for Veritas University...');
    
    // Check if we need to seed global candidate registry for Veritas University
    const testRegistry = await db.get('SELECT id FROM candidate_registry WHERE school = ? LIMIT 1', [school]);
    if (!testRegistry) {
      const defaultCandidates = [
        {
          name: 'Alice Vance',
          role: 'President',
          bio: 'Empowering students through technology, advocacy, and direct transparency.',
          image_data: 'avatar_alice'
        },
        {
          name: 'Bob Harrison',
          role: 'President',
          bio: 'Dedicated to student welfare, upgrading sports facilities, and union support.',
          image_data: 'avatar_bob'
        },
        {
          name: 'Charlie Smith',
          role: 'Secretary',
          bio: 'Organized and transparent records. Streamlining communications across departments.',
          image_data: 'avatar_charlie'
        },
        {
          name: 'Diana Prince',
          role: 'Secretary',
          bio: 'Advocating for academic excellence and student welfare committees.',
          image_data: 'avatar_diana'
        }
      ];
      for (const cand of defaultCandidates) {
        await db.run(
          `INSERT INTO candidate_registry (name, role, school, bio, image_data, created_by) VALUES (?, ?, ?, ?, ?, ?)`,
          [cand.name, cand.role, school, cand.bio, cand.image_data, 'Dean Engineering']
        );
      }
      console.log('Seeded global candidate registry for Veritas University.');
    }

    const startTime = Date.now();
    const endTime = startTime + 5 * 60 * 1000; // 5 minutes from now

    const electionResult = await db.run(
      `INSERT INTO elections (school, title, institution, scope, scope_name, start_time, end_time, status) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        school,
        'Student Union Council Election',
        'Veritas University',
        'School-Wide',
        null,
        startTime,
        endTime,
        'active'
      ]
    );
    const electionId = electionResult.id;

    // Load candidates from candidate_registry for Veritas University and copy into active candidates
    const registryCandidates = await db.all('SELECT * FROM candidate_registry WHERE school = ?', [school]);
    for (const cand of registryCandidates) {
      await db.run(
        `INSERT INTO candidates (election_id, name, role, bio, image_data, votes) VALUES (?, ?, ?, ?, ?, ?)`,
        [electionId, cand.name, cand.role, cand.bio, cand.image_data, 0]
      );
    }

    // Seed Voter IDs (5 unused, 2 already used for realism)
    const voterIds = [
      { code: 'VV-102-M5D', voted: 0 },
      { code: 'VV-884-R9T', voted: 0 },
      { code: 'VV-661-K2P', voted: 0 },
      { code: 'VV-490-X1W', voted: 0 },
      { code: 'VV-305-L7J', voted: 0 },
      { code: 'VV-777-VOT', voted: 1, voted_at: startTime - 60000 },
      { code: 'VV-999-DUM', voted: 1, voted_at: startTime - 30000 }
    ];

    for (const voter of voterIds) {
      await db.run(
        `INSERT INTO voter_ids (election_id, voter_code, voted, voted_at) VALUES (?, ?, ?, ?)`,
        [electionId, voter.code, voter.voted, voter.voted_at || null]
      );
    }

    console.log('Demo election for Veritas University seeded successfully!');
  } catch (error) {
    console.error('Error seeding demo active election:', error);
  }
}

// ==========================================
// API ROUTES
// ==========================================

// --- SUPER ADMIN: SECURITY INVITE CODES ---

// 1. Generate invitation code (Super Admin)
app.post('/api/superadmin/codes/generate', async (req, res) => {
  try {
    // Generate secure random ID: VV-INV-XXXX
    const charPool = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No confusing 1, I, 0, O characters
    let suffix = '';
    for (let i = 0; i < 5; i++) {
      suffix += charPool.charAt(Math.floor(Math.random() * charPool.length));
    }
    const code = `VV-INV-${suffix}`;
    
    await db.run(
      'INSERT INTO admin_codes (code, used, used_by, used_for_school, created_at) VALUES (?, ?, ?, ?, ?)',
      [code, 0, null, null, Date.now()]
    );
    
    res.json({ success: true, code });
  } catch (error) {
    console.error('Failed to generate admin code:', error);
    res.status(500).json({ error: 'Failed to generate invitation code.' });
  }
});

// 2. Fetch all invite codes (Super Admin)
app.get('/api/superadmin/codes', async (req, res) => {
  try {
    const codes = await db.all('SELECT * FROM admin_codes ORDER BY id DESC');
    res.json(codes);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch invite codes.' });
  }
});

// 2b. System-wide overview metrics (Super Admin)
app.get('/api/superadmin/overview', async (req, res) => {
  try {
    const schoolsCountRow = await db.get('SELECT COUNT(DISTINCT school) as total FROM school_admins');
    const adminsCountRow = await db.get('SELECT COUNT(*) as total FROM school_admins');
    const electionsCountRow = await db.get('SELECT COUNT(*) as total FROM elections');
    const votesCountRow = await db.get('SELECT COUNT(*) as total FROM voter_ids WHERE voted = 1');
    const activeElectionsRow = await db.get("SELECT COUNT(*) as total FROM elections WHERE status = 'active'");
    
    const stats = {
      totalSchools: schoolsCountRow.total || 0,
      totalAdmins: adminsCountRow.total || 0,
      totalElections: electionsCountRow.total || 0,
      totalVotesCast: votesCountRow.total || 0,
      activeElections: activeElectionsRow.total || 0
    };

    const elections = await db.all(`
      SELECT 
        e.id,
        e.school,
        e.title,
        e.scope,
        e.scope_name,
        e.start_time,
        e.end_time,
        e.status,
        (SELECT COUNT(*) FROM candidates c WHERE c.election_id = e.id) as candidates_count,
        (SELECT COUNT(*) FROM voter_ids v WHERE v.election_id = e.id) as total_voters,
        (SELECT COUNT(*) FROM voter_ids v WHERE v.election_id = e.id AND v.voted = 1) as voted_count
      FROM elections e
      ORDER BY e.start_time DESC
    `);

    const schoolAdmins = await db.all(`
      SELECT 
        sa.school,
        sa.name as admin_name,
        sa.created_at,
        (SELECT COUNT(*) FROM elections e WHERE e.school = sa.school) as elections_count
      FROM school_admins sa
      ORDER BY sa.created_at DESC
    `);

    res.json({
      success: true,
      stats,
      elections,
      schoolAdmins
    });
  } catch (error) {
    console.error('Failed to retrieve system overview:', error);
    res.status(500).json({ error: 'Failed to retrieve system overview.' });
  }
});

// 2c. Delete school and associated records (Super Admin)
app.delete('/api/superadmin/schools/:schoolName', async (req, res) => {
  const schoolName = req.params.schoolName;

  try {
    const admin = await db.get('SELECT invite_code FROM school_admins WHERE school = ?', [schoolName]);
    
    const queries = [];
    
    // Clean all sub-tables related to this school's elections
    queries.push({
      sql: `DELETE FROM voter_ids WHERE election_id IN (SELECT id FROM elections WHERE school = ?)`,
      params: [schoolName]
    });
    queries.push({
      sql: `DELETE FROM candidates WHERE election_id IN (SELECT id FROM elections WHERE school = ?)`,
      params: [schoolName]
    });
    
    // Clean elections, candidate registry, and positions
    queries.push({
      sql: `DELETE FROM elections WHERE school = ?`,
      params: [schoolName]
    });
    queries.push({
      sql: `DELETE FROM candidate_registry WHERE school = ?`,
      params: [schoolName]
    });
    queries.push({
      sql: `DELETE FROM positions WHERE school = ?`,
      params: [schoolName]
    });
    
    // Delete the administrator
    queries.push({
      sql: `DELETE FROM school_admins WHERE school = ?`,
      params: [schoolName]
    });
    
    // Delete corresponding invitation code
    if (admin && admin.invite_code) {
      queries.push({
        sql: `DELETE FROM admin_codes WHERE code = ?`,
        params: [admin.invite_code]
      });
    }

    // Delete from pre-approved schools list
    queries.push({
      sql: `DELETE FROM registered_schools WHERE name = ?`,
      params: [schoolName]
    });

    await db.transaction(queries);
    res.json({ success: true, message: `School '${schoolName}' and all associated records deleted.` });
  } catch (error) {
    console.error('Failed to delete school:', error);
    res.status(500).json({ error: 'Failed to delete school.' });
  }
});

// 2d. Add new pre-approved school (Super Admin)
app.post('/api/superadmin/schools', async (req, res) => {
  const { name } = req.body;
  if (!name) {
    return res.status(400).json({ error: 'School name is required.' });
  }
  const cleanName = name.trim();
  try {
    await db.run('INSERT INTO registered_schools (name, created_at) VALUES (?, ?)', [cleanName, Date.now()]);
    res.json({ success: true, message: `School '${cleanName}' added to pre-approved list.` });
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT') {
      res.status(400).json({ error: 'School already exists in the pre-approved list.' });
    } else {
      res.status(500).json({ error: 'Failed to add school.' });
    }
  }
});

// 2e. Fetch pre-approved schools stats (Super Admin)
app.get('/api/superadmin/schools/stats', async (req, res) => {
  try {
    const stats = await db.all(`
      SELECT 
        rs.name,
        (SELECT COUNT(*) FROM school_admins sa WHERE sa.school = rs.name) as admins_count,
        (SELECT COUNT(*) FROM elections e WHERE e.school = rs.name) as elections_count
      FROM registered_schools rs
      ORDER BY rs.name ASC
    `);
    res.json(stats);
  } catch (error) {
    console.error('Failed to retrieve schools stats:', error);
    res.status(500).json({ error: 'Failed to retrieve schools stats.' });
  }
});


// --- SCHOOL ADMIN AUTHENTICATION ---

// 3. School Admin Sign Up
app.post('/api/auth/admin/signup', async (req, res) => {
  const { name, school, inviteCode, password } = req.body;
  
  if (!name || !school || !inviteCode || !password) {
    return res.status(400).json({ error: 'Name, School, Invite Code, and Password are required.' });
  }
  
  const cleanName = name.trim();
  const cleanSchool = school.trim();
  const cleanCode = inviteCode.trim().toUpperCase();
  const cleanPassword = password.trim();

  if (cleanPassword.length < 4) {
    return res.status(400).json({ error: 'Password must be at least 4 characters long.' });
  }

  try {
    // Verify school exists in pre-approved list
    const schoolRow = await db.get('SELECT name FROM registered_schools WHERE name = ?', [cleanSchool]);
    if (!schoolRow) {
      return res.status(400).json({ error: `School '${cleanSchool}' is not in the pre-approved schools registry. Please contact Super Admin.` });
    }

    // Verify code exists and is unused
    const codeRow = await db.get('SELECT * FROM admin_codes WHERE code = ?', [cleanCode]);
    if (!codeRow) {
      return res.status(400).json({ error: 'Invalid invitation code / Security ID.' });
    }
    if (codeRow.used === 1) {
      return res.status(400).json({ error: 'This invitation code has already been used.' });
    }

    // Check if admin name already exists for this school
    const existingAdmin = await db.get('SELECT id FROM school_admins WHERE name = ? AND school = ?', [cleanName, cleanSchool]);
    if (existingAdmin) {
      return res.status(400).json({ error: `An administrator named '${cleanName}' is already registered for '${cleanSchool}'.` });
    }

    // Execute atomic signup transaction
    const queries = [
      {
        sql: 'INSERT INTO school_admins (name, school, password, invite_code, created_at) VALUES (?, ?, ?, ?, ?)',
        params: [cleanName, cleanSchool, db.hashPassword(cleanPassword), cleanCode, Date.now()]
      },
      {
        sql: 'UPDATE admin_codes SET used = 1, used_by = ?, used_for_school = ? WHERE code = ?',
        params: [cleanName, cleanSchool, cleanCode]
      },
      // Automatically seed default positions (President, Secretary) for this school
      {
        sql: 'INSERT OR IGNORE INTO positions (name, school, created_by) VALUES (?, ?, ?)',
        params: ['President', cleanSchool, cleanName]
      },
      {
        sql: 'INSERT OR IGNORE INTO positions (name, school, created_by) VALUES (?, ?, ?)',
        params: ['Secretary', cleanSchool, cleanName]
      }
    ];

    await db.transaction(queries);
    res.json({ success: true, message: 'Administrator registered successfully! You can now log in.' });

  } catch (error) {
    console.error('Sign up transaction failed:', error);
    res.status(500).json({ error: 'Registration failed. Database error.' });
  }
});

// 4. School Admin Login (Password authentication)
app.post('/api/auth/admin/login', async (req, res) => {
  const { name, password } = req.body;
  if (!name || !password) {
    return res.status(400).json({ error: 'Username and Password are required.' });
  }
  
  const cleanName = name.trim();
  const cleanPassword = password.trim();

  try {
    const admin = await db.get(
      'SELECT * FROM school_admins WHERE name = ? AND password = ?',
      [cleanName, db.hashPassword(cleanPassword)]
    );

    if (!admin) {
      return res.status(401).json({ error: 'Invalid username or password.' });
    }

    res.json({
      success: true,
      name: admin.name,
      school: admin.school
    });
  } catch (error) {
    res.status(500).json({ error: 'Authentication failed.' });
  }
});


// --- PUBLIC SCHOOLS DIRECTORY ---

// 5. Get list of pre-approved schools
app.get('/api/schools', async (req, res) => {
  try {
    const rows = await db.all('SELECT name FROM registered_schools ORDER BY name ASC');
    res.json(rows.map(r => r.name));
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve schools list.' });
  }
});


// --- STUDENT PORTAL (MULTI-TENANT SUPPORT) ---

// 5b. Get list of all elections (active and past) scoped by school
app.get('/api/elections', async (req, res) => {
  const { school } = req.query;
  if (!school) {
    return res.status(400).json({ error: 'School name is required.' });
  }

  try {
    const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000; // 7 days in ms
    const elections = await db.all(
      'SELECT * FROM elections WHERE school = ? AND end_time >= ? ORDER BY id DESC',
      [school.trim(), oneWeekAgo]
    );
    res.json(elections);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch elections.' });
  }
});

// 6. Get active election scoped by school
app.get('/api/election/status', async (req, res) => {
  const { school, adminName } = req.query;
  if (!school) {
    return res.status(400).json({ error: 'School name is required' });
  }

  try {
    let election;
    if (adminName) {
      election = await db.get(
        `SELECT * FROM elections WHERE school = ? AND created_by = ? AND status = 'active' ORDER BY id DESC LIMIT 1`,
        [school.trim(), adminName.trim()]
      );
    } else {
      election = await db.get(
        `SELECT * FROM elections WHERE school = ? AND status = 'active' ORDER BY id DESC LIMIT 1`,
        [school.trim()]
      );
    }
    if (!election) {
      return res.json({ active: false });
    }

    res.json({
      active: true,
      id: election.id,
      title: election.title,
      institution: election.institution,
      scope: election.scope,
      scope_name: election.scope_name,
      start_time: election.start_time,
      end_time: election.end_time,
      server_time: Date.now()
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch election status' });
  }
});

// 7. Validate Voter ID (Self-contained within election)
app.post('/api/auth/verify', async (req, res) => {
  const { voterCode, electionId } = req.body;
  if (!voterCode || !electionId) {
    return res.status(400).json({ error: 'Voter Code and Election ID are required' });
  }

  try {
    const voter = await db.get(
      'SELECT * FROM voter_ids WHERE voter_code = ? AND election_id = ?',
      [voterCode.trim().toUpperCase(), electionId]
    );

    if (!voter) {
      return res.status(404).json({ valid: false, error: 'Invalid Voter ID. Please verify.' });
    }

    if (voter.voted === 1) {
      return res.status(400).json({ valid: false, error: 'This Voter ID has already been used to cast a vote.' });
    }

    res.json({ valid: true, message: 'Voter ID is valid.' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to verify Voter ID.' });
  }
});

// 8. Get candidates for active election
app.get('/api/election/:id/candidates', async (req, res) => {
  const electionId = req.params.id;
  try {
    const candidates = await db.all(
      'SELECT id, name, role, bio, image_data FROM candidates WHERE election_id = ?',
      [electionId]
    );
    res.json(candidates);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch candidates' });
  }
});

// 9. Secure Vote Casting (Atomic Transaction)
app.post('/api/vote/cast', async (req, res) => {
  const { voterCode, electionId, candidateIds } = req.body;

  if (!voterCode || !electionId) {
    return res.status(400).json({ error: 'Missing voter details or election ID' });
  }
  if (!candidateIds || !Array.isArray(candidateIds) || candidateIds.length === 0) {
    return res.status(400).json({ error: 'No candidate selections received.' });
  }

  const cleanCode = voterCode.trim().toUpperCase();

  try {
    const election = await db.get('SELECT * FROM elections WHERE id = ?', [electionId]);
    if (!election || election.status !== 'active') {
      return res.status(400).json({ error: 'This election is not active.' });
    }

    const currentTime = Date.now();
    if (currentTime > election.end_time) {
      return res.status(400).json({ error: 'Voting has closed for this election.' });
    }

    const voter = await db.get(
      'SELECT * FROM voter_ids WHERE voter_code = ? AND election_id = ?',
      [cleanCode, electionId]
    );

    if (!voter) {
      return res.status(404).json({ error: 'Invalid Voter ID' });
    }
    if (voter.voted === 1) {
      return res.status(400).json({ error: 'This Voter ID has already voted.' });
    }

    // Verify candidateIds match candidates in this election
    const placeholders = candidateIds.map(() => '?').join(',');
    const selectedCands = await db.all(
      `SELECT id, role FROM candidates WHERE id IN (${placeholders}) AND election_id = ?`,
      [...candidateIds, electionId]
    );

    if (selectedCands.length !== candidateIds.length) {
      return res.status(400).json({ error: 'Invalid candidate selections.' });
    }

    // Check for duplicate votes per position
    const roles = selectedCands.map(c => c.role);
    const uniqueRoles = new Set(roles);
    if (roles.length !== uniqueRoles.size) {
      return res.status(400).json({ error: 'Double-voting for a single position is prohibited.' });
    }

    // Execute transaction
    const queries = [
      {
        sql: 'UPDATE voter_ids SET voted = 1, voted_at = ? WHERE id = ?',
        params: [currentTime, voter.id]
      }
    ];

    for (const candId of candidateIds) {
      queries.push({
        sql: 'UPDATE candidates SET votes = votes + 1 WHERE id = ?',
        params: [candId]
      });
    }

    await db.transaction(queries);
    res.json({ success: true, message: 'Your vote has been cast successfully!' });

  } catch (error) {
    console.error('Vote transaction error:', error);
    res.status(500).json({ error: 'Database transaction failed. Please retry.' });
  }
});

// 10. Secure Results (Blocked until countdown expires)
app.get('/api/election/:id/results', async (req, res) => {
  const electionId = req.params.id;

  try {
    const election = await db.get('SELECT * FROM elections WHERE id = ?', [electionId]);
    if (!election) {
      return res.status(404).json({ error: 'Election not found' });
    }

    const currentTime = Date.now();
    if (currentTime < election.end_time && election.status === 'active') {
      const remainingSeconds = Math.ceil((election.end_time - currentTime) / 1000);
      return res.status(403).json({
        success: false,
        error: 'Results locked! Voting is still in progress.',
        remaining_seconds: remainingSeconds
      });
    }

    const candidates = await db.all(
      'SELECT id, name, role, bio, image_data, votes FROM candidates WHERE election_id = ? ORDER BY votes DESC',
      [electionId]
    );

    // Group dynamically by position
    const resultsByRole = {};
    candidates.forEach(cand => {
      if (!resultsByRole[cand.role]) {
        resultsByRole[cand.role] = [];
      }
      resultsByRole[cand.role].push(cand);
    });

    const totalVoterCount = await db.get(
      'SELECT COUNT(*) as total, SUM(voted) as voted FROM voter_ids WHERE election_id = ?',
      [electionId]
    );

    res.json({
      success: true,
      electionTitle: election.title,
      scope: election.scope,
      scopeName: election.scope_name,
      stats: {
        totalVoters: totalVoterCount.total,
        votedCount: totalVoterCount.voted,
        turnoutPercentage: totalVoterCount.total > 0 ? ((totalVoterCount.voted / totalVoterCount.total) * 100).toFixed(1) : 0
      },
      resultsByRole
    });

  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve results' });
  }
});


// --- SCOPED ADMIN CONTROL ENDPOINTS ---

// 11. Scoped Positions API
app.get('/api/positions', async (req, res) => {
  const { school, adminName } = req.query;
  if (!school) return res.status(400).json({ error: 'School name is required.' });
  
  try {
    let positions;
    if (adminName) {
      positions = await db.all(
        'SELECT name FROM positions WHERE school = ? AND (created_by = ? OR created_by IS NULL) ORDER BY name ASC',
        [school.trim(), adminName.trim()]
      );
    } else {
      positions = await db.all('SELECT name FROM positions WHERE school = ? ORDER BY name ASC', [school.trim()]);
    }
    res.json(positions.map(p => p.name));
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch positions.' });
  }
});

app.post('/api/positions', async (req, res) => {
  const { name, school, adminName } = req.body;
  if (!name || !school) {
    return res.status(400).json({ error: 'Position name and school are required.' });
  }
  const cleanName = name.trim();
  const cleanSchool = school.trim();
  const cleanAdmin = adminName ? adminName.trim() : null;
  try {
    await db.run('INSERT INTO positions (name, school, created_by) VALUES (?, ?, ?)', [cleanName, cleanSchool, cleanAdmin]);
    res.json({ success: true, message: `Position '${cleanName}' added.` });
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT') {
      try {
        // If it exists but is unassigned, assign to this admin
        const updated = await db.run('UPDATE positions SET created_by = ? WHERE name = ? AND school = ? AND created_by IS NULL', [cleanAdmin, cleanName, cleanSchool]);
        if (updated.changes > 0) {
          return res.json({ success: true, message: `Position '${cleanName}' added.` });
        }
      } catch (e) {}
      res.status(400).json({ error: 'Position already exists.' });
    } else {
      res.status(500).json({ error: 'Failed to add position.' });
    }
  }
});

app.delete('/api/positions/:name', async (req, res) => {
  const name = req.params.name;
  const { school, adminName } = req.query;
  if (!school) return res.status(400).json({ error: 'School name is required.' });

  try {
    let countRow;
    if (adminName) {
      countRow = await db.get(
        'SELECT COUNT(*) as count FROM positions WHERE school = ? AND (created_by = ? OR created_by IS NULL)',
        [school, adminName]
      );
    } else {
      countRow = await db.get('SELECT COUNT(*) as count FROM positions WHERE school = ?', [school]);
    }

    if (countRow.count <= 1) {
      return res.status(400).json({ error: 'Cannot delete the only remaining position.' });
    }
    
    if (adminName) {
      await db.run(
        'DELETE FROM positions WHERE name = ? AND school = ? AND (created_by = ? OR created_by IS NULL)',
        [name, school, adminName]
      );
    } else {
      await db.run('DELETE FROM positions WHERE name = ? AND school = ?', [name, school]);
    }
    res.json({ success: true, message: `Position '${name}' deleted.` });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete position.' });
  }
});

// 12. Scoped Candidate Registry API
app.get('/api/admin/candidates', async (req, res) => {
  const { school, adminName } = req.query;
  if (!school) return res.status(400).json({ error: 'School name is required.' });
  
  try {
    let candidates;
    if (adminName) {
      candidates = await db.all(
        'SELECT * FROM candidate_registry WHERE school = ? AND (created_by = ? OR created_by IS NULL) ORDER BY name ASC',
        [school.trim(), adminName.trim()]
      );
    } else {
      candidates = await db.all(
        'SELECT * FROM candidate_registry WHERE school = ? ORDER BY name ASC',
        [school.trim()]
      );
    }
    res.json(candidates);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch registry candidates.' });
  }
});

app.post('/api/admin/candidates', async (req, res) => {
  const { name, role, school, bio, image_data, adminName } = req.body;
  if (!name || !role || !school) {
    return res.status(400).json({ error: 'Name, position, and school are required.' });
  }
  const cleanAdmin = adminName ? adminName.trim() : null;
  try {
    const pos = await db.get(
      'SELECT name FROM positions WHERE name = ? AND school = ? AND (created_by = ? OR created_by IS NULL)',
      [role, school, cleanAdmin]
    );
    if (!pos) {
      return res.status(400).json({ error: `Selected position '${role}' does not exist.` });
    }
    
    const result = await db.run(
      'INSERT INTO candidate_registry (name, role, school, bio, image_data, created_by) VALUES (?, ?, ?, ?, ?, ?)',
      [name.trim(), role, school, bio ? bio.trim() : '', image_data || null, cleanAdmin]
    );
    res.json({ success: true, id: result.id, message: 'Candidate registered successfully.' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to register candidate.' });
  }
});

app.delete('/api/admin/candidates/:id', async (req, res) => {
  const id = req.params.id;
  try {
    await db.run('DELETE FROM candidate_registry WHERE id = ?', [id]);
    res.json({ success: true, message: 'Candidate removed from registry.' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete candidate.' });
  }
});

// 13. Scoped Create Election
app.post('/api/admin/election/create', async (req, res) => {
  const { title, institution, scope, scopeName, durationMinutes, candidates, voterIdCount, school, voterCodeMethod, matricNumbers, studentNames, adminName } = req.body;

  if (!title || !institution || !scope || !durationMinutes || !candidates || candidates.length < 1 || !school) {
    return res.status(400).json({ error: 'Invalid configuration parameters.' });
  }

  try {
    const startTime = Date.now();
    const endTime = startTime + parseInt(durationMinutes) * 60 * 1000;

    // Stop any other active elections FOR THIS ADMIN ONLY and set their end time to now
    if (adminName) {
      await db.run(
        "UPDATE elections SET status = 'ended', end_time = ? WHERE status = 'active' AND school = ? AND created_by = ?",
        [startTime, school, adminName]
      );
    } else {
      await db.run(
        "UPDATE elections SET status = 'ended', end_time = ? WHERE status = 'active' AND school = ? AND created_by IS NULL",
        [startTime, school]
      );
    }

    const electionResult = await db.run(
      `INSERT INTO elections (school, title, institution, scope, scope_name, start_time, end_time, status, created_by) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [school, title, institution, scope, scopeName || null, startTime, endTime, 'active', adminName || null]
    );
    const electionId = electionResult.id;

    // Add candidates to the active list for this election
    for (const cand of candidates) {
      await db.run(
        `INSERT INTO candidates (election_id, name, role, bio, image_data, votes) VALUES (?, ?, ?, ?, ?, ?)`,
        [electionId, cand.name, cand.role, cand.bio, cand.image_data || null, 0]
      );
    }

    // Immediately delete setup registry candidates & positions for this admin
    if (adminName) {
      await db.run("DELETE FROM candidate_registry WHERE school = ? AND (created_by = ? OR created_by IS NULL)", [school, adminName]);
      await db.run("DELETE FROM positions WHERE school = ? AND (created_by = ? OR created_by IS NULL)", [school, adminName]);
    } else {
      await db.run("DELETE FROM candidate_registry WHERE school = ? AND created_by IS NULL", [school]);
      await db.run("DELETE FROM positions WHERE school = ? AND created_by IS NULL", [school]);
    }

    // Helper to generate secure code
    const generateVoterCode = () => {
      const part1 = Math.floor(100 + Math.random() * 900);
      const part2 = Math.random().toString(36).substring(2, 5).toUpperCase();
      return `VV-${part1}-${part2}`;
    };

    const codes = [];

    if (voterCodeMethod === 'list' && Array.isArray(matricNumbers) && matricNumbers.length > 0) {
      // Generate Voter IDs from matric list
      for (let i = 0; i < matricNumbers.length; i++) {
        const cleanMatric = matricNumbers[i].trim();
        if (!cleanMatric) continue;
        
        const studentName = (Array.isArray(studentNames) && studentNames[i]) ? studentNames[i].trim() : null;
        const code = generateVoterCode();
        await db.run(
          `INSERT INTO voter_ids (election_id, voter_code, voted, matric_number, student_name) VALUES (?, ?, ?, ?, ?)`,
          [electionId, code, 0, cleanMatric, studentName]
        );
        codes.push(code);
      }
    } else {
      // Generate Voter IDs randomly
      const count = parseInt(voterIdCount) || 10;
      for (let i = 0; i < count; i++) {
        const code = generateVoterCode();
        await db.run(
          `INSERT INTO voter_ids (election_id, voter_code, voted, matric_number) VALUES (?, ?, ?, ?)`,
          [electionId, code, 0, null]
        );
        codes.push(code);
      }
    }

    res.json({
      success: true,
      electionId,
      voterIds: codes,
      end_time: endTime
    });

  } catch (error) {
    console.error('Error creating election:', error);
    res.status(500).json({ error: 'Failed to create election.' });
  }
});

// 14. Get active voter codes list scoped by school
app.get('/api/admin/voters', async (req, res) => {
  const { school, adminName } = req.query;
  if (!school) return res.status(400).json({ error: 'School name is required.' });

  try {
    let election;
    if (adminName) {
      election = await db.get(
        `SELECT id FROM elections WHERE school = ? AND created_by = ? AND status = 'active' ORDER BY id DESC LIMIT 1`,
        [school, adminName]
      );
    } else {
      election = await db.get(
        `SELECT id FROM elections WHERE school = ? AND status = 'active' ORDER BY id DESC LIMIT 1`,
        [school]
      );
    }
    if (!election) {
      return res.json({ voterIds: [] });
    }

    const voters = await db.all(
      `SELECT voter_code, voted, matric_number, student_name 
       FROM voter_ids WHERE election_id = ? 
       ORDER BY 
         CASE WHEN student_name IS NOT NULL AND student_name != '' THEN 0 ELSE 1 END,
         student_name COLLATE NOCASE ASC,
         matric_number COLLATE NOCASE ASC`,
      [election.id]
    );

    res.json({ voterIds: voters });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch voter list' });
  }
});

// 15. Reset Admin's Scoped School Data
app.post('/api/admin/reset', async (req, res) => {
  const { school } = req.body;
  if (!school) return res.status(400).json({ error: 'School context is required for reset.' });

  try {
    // Delete data scoped to this school
    await db.run(
      `DELETE FROM voter_ids WHERE election_id IN (SELECT id FROM elections WHERE school = ?)`,
      [school]
    );
    await db.run(
      `DELETE FROM candidates WHERE election_id IN (SELECT id FROM elections WHERE school = ?)`,
      [school]
    );
    await db.run('DELETE FROM elections WHERE school = ?', [school]);
    await db.run('DELETE FROM candidate_registry WHERE school = ?', [school]);
    await db.run('DELETE FROM positions WHERE school = ?', [school]);
    
    console.log(`Database cleared for school admin: ${school}.`);
    
    // Seed default structures again if school was Veritas University
    if (school === 'Veritas University') {
      await db.run("INSERT OR IGNORE INTO positions (name, school) VALUES ('President', 'Veritas University')");
      await db.run("INSERT OR IGNORE INTO positions (name, school) VALUES ('Secretary', 'Veritas University')");
      await seedDemoActiveElection();
    }
    
    res.json({ success: true, message: `All records deleted for school: ${school}.` });
  } catch (error) {
    console.error('Reset school failed:', error);
    res.status(500).json({ error: `Failed to reset records for ${school}.` });
  }
});

// Catch-all to serve index.html for SPA routing
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start listening
app.listen(PORT, () => {
  console.log(`VeriVote server is running securely at http://localhost:${PORT}`);
});
