import express from 'express';
import readline from 'node:readline';
import {
  signIn,
  splashLogin,
  getJoinedGroups,
  searchJoinedGroups,
  getGroupMembers,
  getAggregatedMembers,
} from './yptService.js';

// Global state holding session and cached joined groups
const state = {
  token: null,
  user: null,
  joinedGroups: [],
};

/**
 * Interactive prompt for Email and Password in CLI
 */
async function promptCredentials() {
  if (process.env.YPT_EMAIL && process.env.YPT_PASSWORD) {
    return {
      email: process.env.YPT_EMAIL.trim(),
      password: process.env.YPT_PASSWORD.trim(),
    };
  }

  const isTTY = Boolean(process.stdin.isTTY);
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: isTTY,
  });

  const it = rl[Symbol.asyncIterator]();

  console.log('\n=============================================');
  console.log('       YPT Analytics Server Login Setup      ');
  console.log('=============================================\n');

  process.stdout.write('Enter YPT Email: ');
  const emailLine = (await it.next()).value || '';
  
  process.stdout.write('Enter YPT Password: ');
  const passwordLine = (await it.next()).value || '';
  
  rl.close();

  return {
    email: emailLine.trim(),
    password: passwordLine.trim(),
  };
}

/**
 * Log joined groups in a structured table in the terminal
 */
function displayJoinedGroups(groups) {
  if (!groups || groups.length === 0) {
    console.log('\n⚠️  No joined groups found for this account.');
    console.log('   Join a group on YPT, or use the join API to enter one.\n');
    return;
  }

  console.log(`\n📋 Joined Groups (${groups.length}):`);
  console.table(
    groups.map((g) => ({
      'Group ID': g.id,
      'Group Name': g.name,
      Category: g.category,
      Members: `${g.memberCount}/${g.maxCapacity}`,
      Role: g.role,
      Private: g.isPrivate ? '🔒 Yes' : '🌐 No',
      Owner: g.owner,
    }))
  );
}

/**
 * Log group members and their recorded study hours in a structured table
 */
function displayGroupMembers(group, members) {
  if (!members || members.length === 0) {
    console.log(`\n⚠️  No members found in "${group.name}".`);
    return;
  }

  console.log(`\n👥 Members & Study Hours for "${group.name}" (${members.length} members):`);
  console.table(
    members.map((m, index) => {
      const hoursDecimal = (m.liveStudyMs / (1000 * 60 * 60)).toFixed(2);
      const statusLabel = m.isStudying
        ? m.isPaused
          ? '⏸️ Paused'
          : '🔥 Studying'
        : '💤 Offline';

      return {
        Rank: `#${index + 1}`,
        Nickname: m.nickname,
        'Study Duration': m.liveStudyTime,
        'Hours (Dec)': `${hoursDecimal} hrs`,
        Status: statusLabel,
        Subject: m.currentSubject || '-',
        'User ID': m.userId,
      };
    })
  );
}

/**
 * Log unified group members in a single structured grid with duplicates removed
 */
function displayUnifiedMembers(members, totalGroupsCount = 1, duplicatesRemoved = 0) {
  if (!members || members.length === 0) {
    console.log('\n⚠️  No members found across joined groups.');
    return;
  }

  const groupText = totalGroupsCount === 1 ? '1 group/channel' : `${totalGroupsCount} groups/channels`;
  console.log(
    `\n👥 Unified Leaderboard (${members.length} unique members across ${groupText}${
      duplicatesRemoved > 0 ? `, ${duplicatesRemoved} duplicate(s) merged` : ''
    }):`
  );
  console.table(
    members.map((m, index) => {
      const hoursDecimal = (m.liveStudyMs / (1000 * 60 * 60)).toFixed(2);
      const statusLabel = m.isStudying
        ? m.isPaused
          ? '⏸️ Paused'
          : '🔥 Studying'
        : '💤 Offline';

      return {
        Rank: `#${index + 1}`,
        Nickname: m.nickname,
        'Study Duration': m.liveStudyTime,
        'Hours (Dec)': `${hoursDecimal} hrs`,
        Status: statusLabel,
        Subject: m.currentSubject || '-',
        'Group(s)': Array.isArray(m.groupNames) ? m.groupNames.join(', ') : m.groupName || '-',
        'User ID': m.userId,
      };
    })
  );
}


/**
 * Main application entrypoint
 */
async function startServer() {
  try {
    // 1. Prompt CLI for credentials
    const { email, password } = await promptCredentials();

    if (!email || !password) {
      console.error('❌ Error: Email and password cannot be empty.');
      process.exit(1);
    }

    // 2. Authenticate with YPT
    console.log('\n🔐 Authenticating with YPT API...');
    const authResult = await signIn(email, password);
    state.token = authResult.token;
    state.user = authResult.user;
    console.log(`✅ Logged in successfully as: ${state.user.nickname} (User ID: ${state.user.id})`);

    // 3. Handshake session
    await splashLogin(state.token);

    // 4. Fetch and log joined groups
    console.log('🔍 Fetching joined groups...');
    state.joinedGroups = await getJoinedGroups(state.token);
    displayJoinedGroups(state.joinedGroups);

    // 5. Fetch and log aggregated members across all joined groups in a single unified grid
    if (state.joinedGroups.length > 0) {
      console.log(`\n⏳ Fetching & aggregating members across ${state.joinedGroups.length} group(s)...`);
      try {
        const aggregated = await getAggregatedMembers(state.token, state.joinedGroups);
        displayUnifiedMembers(aggregated.members, aggregated.successfulGroups, aggregated.duplicatesRemoved);
      } catch (err) {
        console.error(`❌ Could not load aggregated members: ${err.message}`);
      }
    }

    // 6. Setup Express Server
    const app = express();
    app.use(express.json());

    // Middleware: logger
    app.use((req, res, next) => {
      console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
      next();
    });

    /**
     * GET /health - Server health & session status
     */
    app.get('/health', (req, res) => {
      res.json({
        status: 'ok',
        authenticatedUser: state.user,
        joinedGroupsCount: state.joinedGroups.length,
      });
    });

    /**
     * GET /groups - List or search joined groups
     * Query params:
     *   ?q=keyword  (Search within joined groups)
     *   ?refresh=true  (Force re-fetch from YPT servers)
     */
    app.get('/groups', async (req, res) => {
      try {
        const { q, refresh } = req.query;

        if (refresh === 'true') {
          state.joinedGroups = await getJoinedGroups(state.token);
          displayJoinedGroups(state.joinedGroups);
        }

        const results = searchJoinedGroups(state.joinedGroups, q);
        res.json({
          success: true,
          total: results.length,
          groups: results,
        });
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    });

    /**
     * GET /groups/:groupId - Get single joined group details
     */
    app.get('/groups/:groupId', (req, res) => {
      const groupId = Number(req.params.groupId);
      const group = state.joinedGroups.find((g) => g.id === groupId);

      if (!group) {
        return res.status(404).json({
          success: false,
          error: `Group ID ${groupId} is not found in your joined groups.`,
        });
      }

      res.json({ success: true, group });
    });

    /**
     * GET /groups/:groupId/members - Fetch real-time study times of all members
     * (Ideal for hourly cron/poller to collect analytics)
     */
    app.get('/groups/:groupId/members', async (req, res) => {
      try {
        const groupId = Number(req.params.groupId);
        const members = await getGroupMembers(state.token, groupId);

        if (req.query.log === 'true') {
          const group = state.joinedGroups.find((g) => g.id === groupId) || { id: groupId, name: `Group ${groupId}` };
          displayGroupMembers(group, members);
        }

        res.json({
          success: true,
          groupId,
          memberCount: members.length,
          members,
        });
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    });

    /**
     * GET /members (and /groups/members) - Fetch unified, deduplicated members across all joined groups
     * Query params:
     *   ?log=true   (Print unified table to console)
     *   ?q=keyword  (Search within members by nickname, subject, or group)
     */
    const handleUnifiedMembers = async (req, res) => {
      try {
        const { q, log } = req.query;
        const aggregated = await getAggregatedMembers(state.token, state.joinedGroups);

        let filteredMembers = aggregated.members;
        if (q) {
          const query = String(q).trim().toLowerCase();
          filteredMembers = filteredMembers.filter(
            (m) =>
              m.nickname.toLowerCase().includes(query) ||
              (m.currentSubject && m.currentSubject.toLowerCase().includes(query)) ||
              (m.groupNames && m.groupNames.some((gn) => gn.toLowerCase().includes(query))) ||
              String(m.userId) === query
          );
        }

        if (log === 'true') {
          displayUnifiedMembers(filteredMembers, aggregated.successfulGroups, aggregated.duplicatesRemoved);
        }

        res.json({
          success: true,
          totalGroups: state.joinedGroups.length,
          successfulGroups: aggregated.successfulGroups,
          uniqueMemberCount: filteredMembers.length,
          totalRawMembers: aggregated.totalRawCount,
          duplicatesRemoved: aggregated.duplicatesRemoved,
          members: filteredMembers,
        });
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    };

    app.get('/members', handleUnifiedMembers);
    app.get('/groups/members', handleUnifiedMembers);

    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
      console.log(`\n🚀 YPT Analytics Server listening on http://localhost:${PORT}`);
      console.log('   Available API Endpoints:');
      console.log(`   - GET  http://localhost:${PORT}/members             (Unified deduplicated members list)`);
      console.log(`   - GET  http://localhost:${PORT}/groups             (List all joined groups)`);
      console.log(`   - GET  http://localhost:${PORT}/groups?q=<keyword> (Search within joined groups)`);
      console.log(`   - GET  http://localhost:${PORT}/groups/:id/members (Get group member study times)`);
      console.log(`   - GET  http://localhost:${PORT}/health             (Status & Account info)\n`);

      // 7. Automatic periodic background logger (every hour by default)
      const intervalMinutes = parseInt(process.env.REFRESH_INTERVAL_MINUTES || '60', 10);
      if (intervalMinutes > 0 && state.joinedGroups.length > 0) {
        console.log(`⏱️  Auto-logger active: Refreshing & logging study hours every ${intervalMinutes} minute(s).\n`);
        setInterval(async () => {
          console.log(`\n======================================================`);
          console.log(`[${new Date().toLocaleTimeString()}] ⏰ Hourly Update: Unified Members & Study Hours`);
          console.log(`======================================================`);
          try {
            const aggregated = await getAggregatedMembers(state.token, state.joinedGroups);
            displayUnifiedMembers(aggregated.members, aggregated.successfulGroups, aggregated.duplicatesRemoved);
          } catch (err) {
            console.error(`❌ Hourly update error: ${err.message}`);
          }
        }, intervalMinutes * 60 * 1000);
      }
    });
  } catch (error) {
    console.error(`\n❌ Initialization Error: ${error.message}`);
    process.exit(1);
  }
}

startServer();
