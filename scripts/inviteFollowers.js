// scripts/inviteFollowers.js
import fetch from 'node-fetch';
import 'dotenv/config';
import readline from 'readline';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const ORG = 'Krypto-Hashers-Community';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const LOG_FILE = 'invitation_log.txt';
const INVITATION_STATS_FILE = 'invitation_stats.json';
const DELAY_BETWEEN_INVITES = 2000; // 2 seconds delay between invites
const SEARCH_PROGRESS_FILE = 'search_progress.json';
const USERS_DATA_DIR = 'users_data';
const DEFAULT_SAVE_FILE = 'github_users.json';

// Track newly joined members
const MEMBERS_FILE = 'org_members.json';

// Add these constants after other constants
const MAX_FAILED_INVITES = 20;
let failedInvitesCount = 0;

// Add this constant near the top with other constants
const FOLLOWED_USERS_FILE = 'followed_users.json';

// Add these constants at the top with other constants
const SCAN_PROGRESS_FILE = 'scan_progress.json';
const RETRY_DELAY = 30000; // 30 seconds delay for retrying on connection failure

// Ensure log files exist
if (!fs.existsSync(LOG_FILE)) {
  fs.writeFileSync(LOG_FILE, '');
}

// Load or initialize invitation stats
let invitationStats = {
  totalInvites: 0,
  last24Hours: 0,
  lastInviteTime: 0,
  pendingInvites: 0
};

if (fs.existsSync(INVITATION_STATS_FILE)) {
  try {
    invitationStats = JSON.parse(fs.readFileSync(INVITATION_STATS_FILE, 'utf8'));
  } catch (error) {
    console.error('Error loading stats file:', error);
  }
}

// Update stats file
function updateStats() {
  fs.writeFileSync(INVITATION_STATS_FILE, JSON.stringify(invitationStats, null, 2));
}

// Check if we can send more invites
function canSendMoreInvites() {
  const now = Date.now();
  const oneDay = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
  
  // Reset last24Hours if more than 24 hours have passed
  if (now - invitationStats.lastInviteTime > oneDay) {
    invitationStats.last24Hours = 0;
  }
  
  return invitationStats.last24Hours < 50;
}

// Load previously invited users
function getPreviouslyInvitedUsers() {
  if (!fs.existsSync(LOG_FILE)) return new Set();
  
  const logContent = fs.readFileSync(LOG_FILE, 'utf8');
  return new Set(
    logContent
      .split('\n')
      .filter(line => line.trim())
      .map(line => line.split(' - ')[1])
  );
}

// Load or initialize search progress
let searchProgress = {
  lastSearch: null,
  completedCount: 0,
  totalCount: 0,
  remainingUsers: []
};

if (fs.existsSync(SEARCH_PROGRESS_FILE)) {
  try {
    searchProgress = JSON.parse(fs.readFileSync(SEARCH_PROGRESS_FILE, 'utf8'));
  } catch (error) {
    console.error('Error loading search progress:', error);
  }
}

// Update search progress file
function updateSearchProgress() {
  fs.writeFileSync(SEARCH_PROGRESS_FILE, JSON.stringify(searchProgress, null, 2));
}

// Load or initialize members list
let previousMembers = new Set();
if (fs.existsSync(MEMBERS_FILE)) {
  try {
    previousMembers = new Set(JSON.parse(fs.readFileSync(MEMBERS_FILE, 'utf8')));
  } catch (error) {
    console.error('Error loading members file:', error);
  }
}

// Save members list
function updateMembersList(members) {
  fs.writeFileSync(MEMBERS_FILE, JSON.stringify(Array.from(members)));
}

if (!GITHUB_TOKEN) {
  console.error('❌ Error: GITHUB_TOKEN not found in environment');
  console.error('Please make sure you have added your token to the .env file');
  process.exit(1);
}

const headers = {
  Authorization: `token ${GITHUB_TOKEN}`,
  Accept: 'application/vnd.github+json',
};

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

async function getFollowers(username) {
  console.log(`\n📥 Fetching followers of @${username}...`);
  let allFollowers = [];
  let page = 1;
  let hasMore = true;
  let startTime = Date.now();
  let totalFollowers = 0;

  // First, get the user's total follower count
  const userRes = await fetch(`https://api.github.com/users/${username}`, { headers });
  if (userRes.ok) {
    const userData = await userRes.json();
    totalFollowers = userData.followers;
    console.log(`Found ${totalFollowers} total followers`);
  }

  const updateProgress = (current) => {
    const percentage = (current / totalFollowers * 100).toFixed(1);
    const elapsedTime = ((Date.now() - startTime) / 1000).toFixed(1);
    process.stdout.clearLine();
    process.stdout.cursorTo(0);
    process.stdout.write(`Progress: [${percentage}%] (${current}/${totalFollowers}) - ${elapsedTime}s elapsed`);
  };

  while (hasMore) {
    const res = await fetch(`https://api.github.com/users/${username}/followers?per_page=100&page=${page}`, { headers });
    
    if (!res.ok) {
      const error = await res.json();
      console.error('\n❌ Failed to fetch followers:', error.message);
      break;
    }

    const followers = await res.json();
    allFollowers = allFollowers.concat(followers.map(user => user.login));
    
    // Update progress
    updateProgress(allFollowers.length);
    
    // Check if there are more pages
    const linkHeader = res.headers.get('link');
    if (!linkHeader || !linkHeader.includes('rel="next"')) {
      hasMore = false;
    } else {
      page++;
      // Add small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n✅ Completed in ${totalTime}s - Found ${allFollowers.length} followers`);
  return allFollowers;
}

// Add this function to validate organization data
async function getOrgMetadata(orgName) {
  try {
    const res = await fetch(`https://api.github.com/orgs/${orgName}`, { headers });
    if (res.ok) {
      const data = await res.json();
      return {
        name: data.login,
        membersCount: data.public_members + (data.plan?.seats || 0),
        reposCount: data.public_repos,
        followersCount: data.followers,
        timestamp: Date.now()
      };
    }
  } catch (error) {
    console.error('Error fetching org metadata:', error);
  }
  return null;
}

function loadScanProgress() {
  if (fs.existsSync(SCAN_PROGRESS_FILE)) {
    try {
      const progress = JSON.parse(fs.readFileSync(SCAN_PROGRESS_FILE, 'utf8'));
      // Check if the progress is recent (less than 6 hours old)
      const progressAge = Date.now() - new Date(progress.lastSavedAt).getTime();
      if (progressAge < 6 * 60 * 60 * 1000) { // 6 hours
        return progress;
      } else {
        console.log('\n⚠️ Found old progress file (>6h old). Starting fresh scan...');
        fs.unlinkSync(SCAN_PROGRESS_FILE);
      }
    } catch (error) {
      console.error('Error loading scan progress:', error);
      // If file is corrupted, delete it
      fs.unlinkSync(SCAN_PROGRESS_FILE);
    }
  }
  return null;
}

function saveScanProgress(orgName, phase, processedUsers, totalUsers, processedRepos, totalRepos, users, orgMetadata) {
  const progress = {
    orgName,
    phase,
    processedUsers,
    totalUsers,
    processedRepos,
    totalRepos,
    savedUsers: Array.from(users),
    orgMetadata,
    lastSavedAt: new Date().toISOString(),
    timestamp: Date.now()
  };
  
  fs.writeFileSync(SCAN_PROGRESS_FILE, JSON.stringify(progress, null, 2));
}

// Modify getOrgFollowers function
async function getOrgFollowers(orgName) {
  console.log(`\n🔍 Fetching followers and members of ${orgName}...`);
  
  // First get organization metadata
  const orgMetadata = await getOrgMetadata(orgName);
  if (!orgMetadata) {
    console.error('❌ Failed to fetch organization information');
    return [];
  }
  
  console.log('\n📊 Organization Stats:');
  console.log(`   • Members: ~${orgMetadata.membersCount}`);
  console.log(`   • Public Repos: ${orgMetadata.reposCount}`);
  console.log(`   • Followers: ${orgMetadata.followersCount}`);
  
  let allUsers = new Set();
  let startTime = Date.now();
  
  // Load previous progress if exists
  const previousProgress = loadScanProgress();
  let resumePhase = 1;
  let skipUsers = 0;
  
  if (previousProgress && previousProgress.orgName === orgName) {
    const timeSinceLastSave = Date.now() - new Date(previousProgress.lastSavedAt).getTime();
    const timeString = Math.round(timeSinceLastSave / (1000 * 60)) + ' minutes ago';
    
    // Validate if the organization data matches
    if (previousProgress.orgMetadata &&
        previousProgress.orgMetadata.membersCount === orgMetadata.membersCount &&
        previousProgress.orgMetadata.reposCount === orgMetadata.reposCount) {
      
      console.log('\n📋 Found previous unfinished scan:');
      console.log(`   • Last saved: ${timeString}`);
      console.log(`   • Phase: ${previousProgress.phase}/3`);
      console.log(`   • Users found: ${previousProgress.savedUsers.length}`);
      console.log(`   • Processed repos: ${previousProgress.processedRepos}`);
      
      const resume = await new Promise(resolve => {
        rl.question('\nDo you want to resume this scan? (yes/no): ', resolve);
      });
      
      if (resume.toLowerCase() === 'yes') {
        resumePhase = previousProgress.phase;
        // Restore previously found users
        previousProgress.savedUsers.forEach(user => allUsers.add(user));
        skipUsers = previousProgress.processedUsers;
        console.log(`\n✅ Resuming scan from phase ${resumePhase}`);
        console.log(`   • Restored ${allUsers.size} previously found users`);
        startTime = Date.now() - (previousProgress.timestamp || 0); // Adjust start time
      } else {
        // Delete the progress file if not resuming
        if (fs.existsSync(SCAN_PROGRESS_FILE)) {
          fs.unlinkSync(SCAN_PROGRESS_FILE);
        }
      }
    } else {
      console.log('\n⚠️ Organization data has changed since last scan. Starting fresh...');
      if (fs.existsSync(SCAN_PROGRESS_FILE)) {
        fs.unlinkSync(SCAN_PROGRESS_FILE);
      }
    }
  }

  const updateProgress = (current, total, phase) => {
    const percentage = (current / total * 100).toFixed(1);
    const elapsedTime = ((Date.now() - startTime) / 1000).toFixed(1);
    process.stdout.clearLine();
    process.stdout.cursorTo(0);
    process.stdout.write(`${phase}: [${percentage}%] (${current}/${total}) - ${elapsedTime}s elapsed`);
    
    // Save progress periodically (every 100 users or when percentage changes)
    if (current % 100 === 0 || current === total) {
      saveScanProgress(
        orgName,
        resumePhase,
        current,
        total,
        processedRepos,
        repoCount,
        allUsers,
        orgMetadata
      );
    }
  };

  // Function to handle API calls with retry on connection failure
  async function makeApiCall(url, errorMessage) {
    while (true) {
      try {
        const res = await fetch(url, { headers });
        if (res.ok) {
          return await res.json();
        } else if (res.status === 403) {
          const error = await res.json();
          if (error.message.includes('rate limit')) {
            console.log('\n⚠️ Rate limit hit. Waiting 60 seconds...');
            await new Promise(resolve => setTimeout(resolve, 60000));
            continue;
          }
        }
        throw new Error(`API call failed: ${res.status}`);
      } catch (error) {
        console.error(`\n❌ ${errorMessage}:`, error.message);
        if (error.message.includes('fetch failed')) {
          console.log(`\n⚠️ Connection lost. Retrying in ${RETRY_DELAY/1000} seconds...`);
          await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
          continue;
        }
        throw error;
      }
    }
  }

  let memberCount = 0;
  let followerCount = 0;
  let repoCount = 0;
  let processedRepos = 0;

  // Phase 1: Members
  if (resumePhase <= 1) {
    console.log('\n📊 Phase 1/3: Fetching organization members and admins...');
    let page = Math.floor(skipUsers / 100) + 1;
    let hasMore = true;

    while (hasMore) {
      try {
        const members = await makeApiCall(
          `https://api.github.com/orgs/${orgName}/members?per_page=100&page=${page}&role=all`,
          'Failed to fetch org members'
        );
        
        if (members.length === 0) {
          hasMore = false;
        } else {
          members.forEach(member => allUsers.add(member.login));
          memberCount = allUsers.size;
          updateProgress(memberCount, memberCount, 'Members scan');
          page++;
        }
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (error) {
        console.error('\n❌ Error in members phase:', error.message);
        break;
      }
    }
    resumePhase = 2;
    saveScanProgress(orgName, resumePhase, allUsers.size, memberCount, 0, 0, allUsers, orgMetadata);
  }

  // ... rest of the phases with similar error handling and progress saving ...
  
  // Clear progress file when done
  if (fs.existsSync(SCAN_PROGRESS_FILE)) {
    fs.unlinkSync(SCAN_PROGRESS_FILE);
  }

  const usersArray = Array.from(allUsers);
  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n\n✅ Scan completed in ${totalTime}s - Found ${usersArray.length} total users`);
  console.log(`   • ${memberCount} members/admins`);
  console.log(`   • ${followerCount} followers`);
  console.log(`   • ${repoCount} repositories processed`);
  
  return usersArray;
}

async function getOrgMembers(orgName) {
  console.log(`📥 Fetching members of ${orgName}...`);
  const res = await fetch(`https://api.github.com/orgs/${orgName}/members`, { headers });
  
  if (!res.ok) {
    const error = await res.json();
    console.error('❌ Failed to fetch org members:', error.message);
    process.exit(1);
  }

  const data = await res.json();
  console.log(`✅ Found ${data.length} org members`);
  return data.map(member => member.login);
}

async function getUserId(username) {
  console.log(`📥 Fetching user ID for @${username}...`);
  try {
    const res = await fetch(`https://api.github.com/users/${username}`, { headers });
    
    if (!res.ok) {
      console.error(`❌ User @${username} not found or account may have been deleted/renamed`);
      return null;
    }

    const data = await res.json();
    return data.id;
  } catch (error) {
    console.error(`❌ Error fetching user ID for @${username}:`, error.message);
    return null;
  }
}

async function commitAndPushChanges() {
  const date = new Date().toISOString().split('T')[0];
  const time = new Date().toTimeString().split(' ')[0];
  
  try {
    // Add all changes
    execSync('git add invitation_log.txt invitation_stats.json org_members.json users_data/*');
    
    // Create commit message with stats
    const commitMessage = `[Auto] Update invitation logs ${date} ${time}

- Total invites sent: ${invitationStats.totalInvites}
- Invites in last 24h: ${invitationStats.last24Hours}
- Pending invites: ${invitationStats.pendingInvites}
- Failed due to rate limit: ${failedInvitesCount}`;

    // Commit and push
    execSync(`git commit -m "${commitMessage}"`);
    execSync('git push');
    
    console.log('\n✅ Successfully committed and pushed changes to GitHub');
  } catch (error) {
    console.error('\n❌ Failed to commit changes:', error.message);
  }
}

// Add this function near the top with other utility functions
function appendToLog(sourceUsername, invitedUser) {
  const timestamp = new Date().toISOString();
  const logEntry = `${timestamp} - ${sourceUsername} - ${invitedUser}\n`;
  
  console.log('\n📝 Attempting to write to log file:', LOG_FILE);
  console.log('   Entry:', logEntry.trim());
  
  try {
    // Check if directory exists, create if not
    const logDir = path.dirname(LOG_FILE);
    if (!fs.existsSync(logDir)) {
      console.log('   Creating log directory...');
      fs.mkdirSync(logDir, { recursive: true });
    }
    
    // Check if file exists, create if not
    if (!fs.existsSync(LOG_FILE)) {
      console.log('   Creating new log file...');
      fs.writeFileSync(LOG_FILE, '');
    }
    
    // Write to file
    fs.appendFileSync(LOG_FILE, logEntry, { encoding: 'utf8', flag: 'a' });
    console.log('   ✅ Successfully wrote to log file');
    
    // Verify the write
    const lastLine = fs.readFileSync(LOG_FILE, 'utf8').split('\n').filter(Boolean).pop();
    if (lastLine !== logEntry.trim()) {
      throw new Error('Log entry verification failed');
    }
  } catch (error) {
    console.error('   ❌ Error writing to log file:', error.message);
    console.error('   File path:', path.resolve(LOG_FILE));
    console.error('   Current directory:', process.cwd());
    
    // Try alternative logging method
    try {
      console.log('   Attempting alternative logging method...');
      const tempPath = path.join(process.cwd(), 'invitation_log_temp.txt');
      fs.appendFileSync(tempPath, logEntry);
      fs.renameSync(tempPath, LOG_FILE);
      console.log('   ✅ Successfully wrote using alternative method');
    } catch (altError) {
      console.error('   ❌ Alternative logging also failed:', altError.message);
      throw error; // Re-throw the original error
    }
  }
}

// Modify inviteUser function to use the new logging
async function inviteUser(username, sourceUsername, targetOrg, forceInvite = false) {
  if (!forceInvite && !canSendMoreInvites()) {
    console.log(`⚠️ Reached daily invitation limit (50). Use force option to bypass this limit.`);
    return false;
  }

  // First check if user is already a member
  try {
    const membershipRes = await fetch(`https://api.github.com/orgs/${targetOrg}/members/${username}`, { headers });
    if (membershipRes.status === 204) {
      console.log(`ℹ️ @${username} is already a member of ${targetOrg}`);
      return false;
    }
  } catch (error) {
    // User is not a member, continue with invitation
  }

  // Then check if user already has a pending invitation
  try {
    const invitationsRes = await fetch(`https://api.github.com/orgs/${targetOrg}/invitations`, { headers });
    if (invitationsRes.ok) {
      const invitations = await invitationsRes.json();
      const pendingInvite = invitations.find(invite => invite.login === username);
      if (pendingInvite) {
        console.log(`ℹ️ @${username} already has a pending invitation to ${targetOrg}`);
        return false;
      }
    }
  } catch (error) {
    console.error(`⚠️ Could not check pending invitations:`, error.message);
  }

  const userId = await getUserId(username);
  if (!userId) {
    console.log(`⚠️ Skipping invitation for @${username} due to invalid user`);
    return false;
  }

  console.log(`📨 Inviting @${username} to ${targetOrg}...`);
  try {
    const res = await fetch(`https://api.github.com/orgs/${targetOrg}/invitations`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ invitee_id: userId })
    });

    if (res.ok) {
      console.log(`✅ Successfully invited @${username}`);
      
      // Update stats first
      invitationStats.totalInvites++;
      invitationStats.last24Hours++;
      invitationStats.lastInviteTime = Date.now();
      invitationStats.pendingInvites++;
      updateStats();
      
      // Then log the invitation with retries
      let logSuccess = false;
      let retryCount = 0;
      const maxRetries = 3;
      
      while (!logSuccess && retryCount < maxRetries) {
        try {
          appendToLog(sourceUsername, username);
          logSuccess = true;
        } catch (logError) {
          retryCount++;
          console.error(`   ❌ Log attempt ${retryCount} failed:`, logError.message);
          if (retryCount < maxRetries) {
            console.log(`   Retrying in 1 second...`);
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        }
      }
      
      if (!logSuccess) {
        console.error('   ❌ Failed to log invitation after all retries');
      }
      
      return true;
    } else {
      const err = await res.json();
      failedInvitesCount++;
      
      // Log the specific error message
      if (err.message.includes('rate limit')) {
        console.log(`❌ Failed to invite ${username}: Over invitation rate limit (Failed: ${failedInvitesCount}/${MAX_FAILED_INVITES})`);
      } else if (err.message === 'Validation Failed') {
        console.log(`❌ Failed to invite ${username}: Validation Failed (Failed: ${failedInvitesCount}/${MAX_FAILED_INVITES})`);
      } else {
        console.log(`❌ Failed to invite ${username}: ${err.message} (Failed: ${failedInvitesCount}/${MAX_FAILED_INVITES})`);
      }
      
      if (failedInvitesCount >= MAX_FAILED_INVITES) {
        console.log('\n⚠️ Reached maximum failed invites. Stopping and committing changes...');
        await commitAndPushChanges();
        process.exit(0);
      }
      
      return false;
    }
  } catch (error) {
    failedInvitesCount++;
    console.error(`❌ Failed to invite ${username}: ${error.message} (Failed: ${failedInvitesCount}/${MAX_FAILED_INVITES})`);
    
    if (failedInvitesCount >= MAX_FAILED_INVITES) {
      console.log('\n⚠️ Reached maximum failed invites. Stopping and committing changes...');
      await commitAndPushChanges();
      process.exit(0);
    }
    
    return false;
  }
}

async function validateOrg(orgUrl) {
  try {
    // Extract org name from URL or use as-is if it's just the name
    let orgName = orgUrl;
    if (orgUrl.includes('github.com')) {
      // Handle both https://github.com/org-name and github.com/org-name
      orgName = orgUrl.split('github.com/').pop().split('/')[0];
    }
    
    console.log(`🔍 Validating organization: ${orgName}`);
    const res = await fetch(`https://api.github.com/orgs/${orgName}`, { headers });
    if (res.ok) {
      return { valid: true, orgName };
    }
    return { valid: false, orgName: null };
  } catch (error) {
    return { valid: false, orgName: null };
  }
}

async function validateUser(userIdentifier) {
  try {
    // Check if input is an email
    const isEmail = userIdentifier.includes('@');
    let apiUrl = isEmail 
      ? `https://api.github.com/search/users?q=${encodeURIComponent(userIdentifier)}+in:email`
      : `https://api.github.com/users/${userIdentifier}`;

    const res = await fetch(apiUrl, { headers });
    const data = await res.json();

    if (!res.ok) {
      return { valid: false, username: null };
    }

    // For email search, check if we found any user
    if (isEmail) {
      if (data.total_count === 0) {
        return { valid: false, username: null };
      }
      return { valid: true, username: data.items[0].login };
    }

    // For direct username lookup
    return { valid: true, username: data.login };
  } catch (error) {
    return { valid: false, username: null };
  }
}

// Modify parseGitHubQuery function to handle quotes properly
function parseGitHubQuery(query) {
  const filters = {
    base: [],
    followers: null,
    repos: null,
    language: null,
    location: null,
    created: null,
    pushed: null
  };

  // Split query into parts while preserving quoted strings
  const parts = query.match(/(?:[^\s"]+|"[^"]*")+/g) || [];

  parts.forEach(part => {
    if (part.includes(':')) {
      const [key, ...valueParts] = part.split(':');
      const value = valueParts.join(':').replace(/^"(.*)"$/, '$1'); // Remove surrounding quotes
      
      switch (key.toLowerCase()) {
        case 'followers':
          filters.followers = value;
          break;
        case 'repos':
          filters.repos = value;
          break;
        case 'language':
          filters.language = value;
          break;
        case 'location':
          filters.location = value.replace(/^"(.*)"$/, '$1'); // Remove any existing quotes
          break;
        case 'created':
          filters.created = value;
          break;
        case 'pushed':
          filters.pushed = value;
          break;
        default:
          filters.base.push(part);
      }
    } else {
      filters.base.push(part);
    }
  });

  return filters;
}

// Modify buildGitHubSearchUrl function to properly format the query
function buildGitHubSearchUrl(filters, page = 1) {
  const queryParts = [];

  // Add base keywords
  if (filters.base.length > 0) {
    queryParts.push(filters.base.join(' '));
  }

  // Add filters with proper formatting
  if (filters.followers) {
    queryParts.push(`followers:${filters.followers.replace(/\s+/g, '')}`);
  }
  if (filters.repos) {
    queryParts.push(`repos:${filters.repos.replace(/\s+/g, '')}`);
  }
  if (filters.location) {
    // Remove any existing quotes and add single set of quotes
    const location = filters.location.replace(/^"(.*)"$/, '$1');
    queryParts.push(`location:"${location}"`);
  }
  if (filters.language) {
    queryParts.push(`language:${filters.language}`);
  }
  if (filters.created) {
    queryParts.push(`created:${filters.created.replace(/\s+/g, '')}`);
  }
  if (filters.pushed) {
    queryParts.push(`pushed:${filters.pushed.replace(/\s+/g, '')}`);
  }

  // Always add type:user
  queryParts.push('type:user');

  // Join all parts with spaces
  const query = queryParts.join(' ');
  
  // Log the final query for debugging
  console.log('\n🔍 Generated search query:', query);

  return `https://api.github.com/search/users?q=${encodeURIComponent(query)}&per_page=100&page=${page}`;
}

// Add this function after parseGitHubQuery
function validateSearchFilters(filters) {
  const errors = [];
  const now = new Date();
  
  // Validate date formats and ranges
  const dateFields = ['pushed', 'created'];
  dateFields.forEach(field => {
    if (filters[field]) {
      const dateStr = filters[field].replace(/[<>]=?/, '');
      const date = new Date(dateStr);
      
      if (isNaN(date.getTime())) {
        errors.push(`Invalid date format for ${field}: ${filters[field]}`);
      } else if (date > now) {
        errors.push(`${field} date ${filters[field]} is in the future`);
      }
    }
  });

  // Validate followers/repos ranges
  const numericFields = ['followers', 'repos'];
  numericFields.forEach(field => {
    if (filters[field] && !filters[field].match(/^[<>]=?\d+$/)) {
      errors.push(`Invalid ${field} format: ${filters[field]}. Use >, <, >=, or <= followed by a number`);
    }
  });

  return errors;
}

// Modify searchUsersByKeyword function to better handle API limits
async function searchUsersByKeyword(searchQuery, startFrom = 0, getAllUsers = false) {
  console.log('\n🔍 Analyzing search query...');
  const filters = parseGitHubQuery(searchQuery);
  
  // First, try to get total count without fetching results
  try {
    const countUrl = buildGitHubSearchUrl(filters, 1) + '&per_page=1';
    const countRes = await fetch(countUrl, { headers });
    const countData = await countRes.json();
    
    if (countRes.ok && countData.total_count > 0) {
      console.log('\n📊 Total matches on GitHub:', countData.total_count.toLocaleString());
      console.log('⚠️ Note: Due to GitHub API limitations, we can only fetch the first 1000 most relevant users');
      console.log('💡 Tip: Use more specific filters to narrow down results if needed\n');
    }
  } catch (error) {
    // Continue even if count check fails
    console.log('\n⚠️ Could not fetch total count from GitHub');
  }

  // Validate filters
  const validationErrors = validateSearchFilters(filters);
  if (validationErrors.length > 0) {
    console.log('\n❌ Search query validation errors:');
    validationErrors.forEach(error => console.log(`   • ${error}`));
    console.log('\n💡 Example of valid queries:');
    console.log('   • followers:>=100 pushed:>=2023-01-01');
    console.log('   • created:>=2020-01-01 repos:>=10');
    return [];
  }
  
  // Display parsed filters
  console.log('\n📋 Search filters:');
  if (filters.base.length > 0) console.log(`   • Keywords: ${filters.base.join(' ')}`);
  if (filters.followers) console.log(`   • Followers: ${filters.followers}`);
  if (filters.repos) console.log(`   • Repositories: ${filters.repos}`);
  if (filters.language) console.log(`   • Language: ${filters.language}`);
  if (filters.location) console.log(`   • Location: ${filters.location}`);
  if (filters.created) console.log(`   • Created: ${filters.created}`);
  if (filters.pushed) console.log(`   • Last Push: ${filters.pushed}`);

  let allUsers = new Set();
  let page = 1;
  let hasMore = true;
  let retryCount = 0;
  const maxRetries = 3;
  let totalResults = 0;
  let startTime = Date.now();

  const updateProgress = (current, total, currentPage) => {
    const percentage = (current / total * 100).toFixed(1);
    const elapsedTime = ((Date.now() - startTime) / 1000).toFixed(1);
    process.stdout.clearLine();
    process.stdout.cursorTo(0);
    process.stdout.write(`Progress: [${percentage}%] (${current}/${total}) - Page ${currentPage}/10 - ${elapsedTime}s elapsed`);
  };

  console.log('\n🔍 Fetching users...');
  console.log('📄 Fetching 100 users per page, maximum 10 pages (1000 users)');
  
  while (hasMore && (getAllUsers || page <= 10)) {
    try {
      const searchUrl = buildGitHubSearchUrl(filters, page);
      const res = await fetch(searchUrl, { headers });
      const data = await res.json();

      if (!res.ok) {
        console.error('\n❌ Search failed:', data.message);
        if (data.errors) {
          console.log('\nDetailed errors:');
          data.errors.forEach(error => console.log(`   • ${error.message}`));
        }
        throw new Error(data.message);
      }

      if (page === 1) {
        totalResults = Math.min(data.total_count, 1000);
      }

      const users = data.items.map(user => user.login);
      users.forEach(user => allUsers.add(user));

      updateProgress(allUsers.size, Math.min(totalResults, 1000), page);

      if (!data.items.length || page * 100 >= 1000) {
        hasMore = false;
      } else {
        page++;
        // Add a small delay between requests to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      retryCount = 0;
    } catch (error) {
      console.error('\n❌ Search error:', error.message);
      if (error.message.includes('rate limit')) {
        if (retryCount < maxRetries) {
          retryCount++;
          console.log('\n⚠️ Rate limit hit. Waiting 60 seconds...');
          await new Promise(resolve => setTimeout(resolve, 60000));
          continue;
        }
      }
      break;
    }
  }

  const usersArray = Array.from(allUsers);
  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n\n✅ Search completed in ${totalTime}s - Found ${usersArray.length} unique users`);
  
  if (usersArray.length >= 1000) {
    console.log('\n💡 Tips for narrowing down results:');
    console.log('• Add followers:>X to find more influential users');
    console.log('• Add pushed:>YYYY-MM-DD to find recently active users');
    console.log('• Add language:X to filter by programming language');
    console.log('• Add repos:>X to find users with more repositories');
  }

  return usersArray;
}

async function getRepoContributors(repoUrl) {
  try {
    // Extract owner and repo name from URL
    const urlParts = repoUrl.replace('https://github.com/', '').split('/');
    const owner = urlParts[0];
    const repo = urlParts[1];

    console.log(`📥 Fetching contributors from ${owner}/${repo}...`);
    let allContributors = new Set();
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/contributors?per_page=100&page=${page}`, { headers });
      
      if (!res.ok) {
        const error = await res.json();
        console.error('❌ Failed to fetch contributors:', error.message);
        break;
      }

      const contributors = await res.json();
      contributors.forEach(user => allContributors.add(user.login));
      
      // Check if there are more pages
      const linkHeader = res.headers.get('link');
      if (!linkHeader || !linkHeader.includes('rel="next"')) {
        hasMore = false;
      } else {
        page++;
      }
    }

    // Now scan each contributor's repositories
    const additionalUsers = new Set();
    for (const contributor of allContributors) {
      try {
        console.log(`🔍 Scanning repositories of @${contributor}...`);
        const userRepos = await fetch(`https://api.github.com/users/${contributor}/repos?per_page=100`, { headers });
        
        if (userRepos.ok) {
          const repos = await userRepos.json();
          for (const repo of repos) {
            if (!repo.fork) { // Skip forked repositories
              const repoContribs = await fetch(`https://api.github.com/repos/${repo.full_name}/contributors?per_page=100`, { headers });
              if (repoContribs.ok) {
                const contribs = await repoContribs.json();
                contribs.forEach(user => additionalUsers.add(user.login));
              }
              // Add delay to avoid rate limiting
              await new Promise(resolve => setTimeout(resolve, 1000));
            }
          }
        }
      } catch (error) {
        console.error(`⚠️ Error scanning repos for ${contributor}:`, error.message);
      }
    }

    // Combine all unique users
    const allUsers = new Set([...allContributors, ...additionalUsers]);
    console.log(`✅ Found ${allUsers.size} total unique users`);
    return Array.from(allUsers);
  } catch (error) {
    console.error('❌ Error:', error.message);
    return [];
  }
}

async function scanReadmeForUsers(repoUrl) {
  try {
    // Extract owner and repo name from URL
    const urlParts = repoUrl.replace('https://github.com/', '').split('/');
    const owner = urlParts[0];
    const repo = urlParts[1];

    console.log(`📥 Scanning README files in ${owner}/${repo}...`);
    
    // First try to get the default README
    const readmeFiles = [
      'README.md',
      'README',
      'readme.md',
      'readme',
      'README.markdown',
      'readme.markdown'
    ];

    let content = '';
    for (const filename of readmeFiles) {
      try {
        const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${filename}`, { headers });
        if (res.ok) {
          const data = await res.json();
          // Content is base64 encoded
          content = Buffer.from(data.content, 'base64').toString('utf8');
          console.log(`✅ Found ${filename}`);
          break;
        }
      } catch (error) {
        continue;
      }
    }

    if (!content) {
      console.log('❌ No README file found');
      return [];
    }

    // Find GitHub usernames in the content
    // Match patterns like @username, github.com/username, or [username](https://github.com/username)
    const usernamePatterns = [
      /@([a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38})/g,
      /github\.com\/([a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38})/g,
      /\[([a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38})\]\(https:\/\/github\.com\/[a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38}\)/g
    ];

    const usernames = new Set();
    for (const pattern of usernamePatterns) {
      const matches = content.matchAll(pattern);
      for (const match of matches) {
        // Remove @ symbol if present
        const username = match[1].replace('@', '');
        // Validate the username
        const isValid = await validateUser(username);
        if (isValid.valid) {
          usernames.add(username);
        }
      }
    }

    // Also check for usernames in tables or lists
    // This pattern looks for words that match GitHub username format
    const linePattern = /\|\s*([a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38})\s*\|/g;
    const listPattern = /[-*+]\s+([a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38})\s*$/gm;

    for (const pattern of [linePattern, listPattern]) {
      const matches = content.matchAll(pattern);
      for (const match of matches) {
        const username = match[1];
        // Validate the username
        const isValid = await validateUser(username);
        if (isValid.valid) {
          usernames.add(username);
        }
      }
    }

    const usersArray = Array.from(usernames);
    console.log(`✅ Found ${usersArray.length} potential GitHub users in README`);
    return usersArray;
  } catch (error) {
    console.error('❌ Error:', error.message);
    return [];
  }
}

async function followUser(username) {
  console.log(`👥 Following @${username}...`);
  const res = await fetch(`https://api.github.com/user/following/${username}`, {
    method: 'PUT',
    headers
  });
  
  if (res.status === 204) {
    console.log(`✅ Successfully followed @${username}`);
    return true;
  } else {
    console.error(`❌ Failed to follow ${username}`);
    return false;
  }
}

function loadFollowedUsers() {
  if (!fs.existsSync(FOLLOWED_USERS_FILE)) {
    fs.writeFileSync(FOLLOWED_USERS_FILE, JSON.stringify([]));
    return new Set();
  }
  try {
    return new Set(JSON.parse(fs.readFileSync(FOLLOWED_USERS_FILE, 'utf8')));
  } catch (error) {
    console.error('Error loading followed users file:', error);
    return new Set();
  }
}

function saveFollowedUsers(followedUsers) {
  fs.writeFileSync(FOLLOWED_USERS_FILE, JSON.stringify(Array.from(followedUsers)));
}

async function followAllOrgMembers() {
  console.log('\n🔍 Fetching all organization members...');
  
  // Load already followed users
  const followedUsers = loadFollowedUsers();
  console.log(`📋 Previously followed users: ${followedUsers.size}`);
  
  // Get current members
  const currentMembers = new Set();
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const res = await fetch(`https://api.github.com/orgs/${ORG}/members?per_page=100&page=${page}`, { headers });
    
    if (!res.ok) {
      console.error('❌ Failed to fetch members:', await res.json());
      return;
    }

    const members = await res.json();
    members.forEach(member => currentMembers.add(member.login));
    
    // Check if there are more pages
    const linkHeader = res.headers.get('link');
    if (!linkHeader || !linkHeader.includes('rel="next"')) {
      hasMore = false;
    } else {
      page++;
    }
  }

  console.log(`\n👥 Found ${currentMembers.size} organization members`);
  
  // Filter out already followed users
  const newMembers = Array.from(currentMembers).filter(member => !followedUsers.has(member));
  console.log(`🆕 Found ${newMembers.length} new members to follow`);
  
  if (newMembers.length === 0) {
    console.log('✨ No new members to follow!');
    return;
  }
  
  let successCount = 0;
  for (const member of newMembers) {
    if (await followUser(member)) {
      successCount++;
      followedUsers.add(member);
      // Save after each successful follow to prevent duplicates if script is interrupted
      saveFollowedUsers(followedUsers);
    }
    // Add delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  console.log(`\n✨ Successfully followed ${successCount} new members`);
  
  // Update the members list
  updateMembersList(currentMembers);
}

// Modify saveUsersToFile function to support resuming
async function saveUsersToFile(users, sourceType, keyword) {
  // Create users_data directory if it doesn't exist
  if (!fs.existsSync(USERS_DATA_DIR)) {
    fs.mkdirSync(USERS_DATA_DIR);
  }

  // Generate filename based on source and date
  const date = new Date().toISOString().split('T')[0];
  const filename = `${sourceType}_${keyword}_${date}.json`.replace(/[^a-zA-Z0-9-_\.]/g, '_');
  const filepath = path.join(USERS_DATA_DIR, filename);

  // Check if file exists and has partial data
  let existingData = { users: [] };
  if (fs.existsSync(filepath)) {
    try {
      existingData = JSON.parse(fs.readFileSync(filepath, 'utf8'));
      console.log(`\n📋 Found existing file with ${existingData.users.length} processed users`);
      const resume = await new Promise(resolve => {
        rl.question('Do you want to resume from where it left off? (yes/no): ', resolve);
      });
      
      if (resume.toLowerCase() !== 'yes') {
        existingData = { users: [] };
      }
    } catch (error) {
      console.error('Error reading existing file:', error);
    }
  }

  // Initialize or update file with header information
  const fileHeader = {
    source_type: sourceType,
    keyword: keyword,
    date: date,
    total_users: users.length,
    users: existingData.users
  };
  fs.writeFileSync(filepath, JSON.stringify(fileHeader, null, 2));

  // Start from where we left off
  const processedUsernames = new Set(existingData.users.map(u => u.username));
  const remainingUsers = users.filter(username => !processedUsernames.has(username));

  console.log('\n📥 Fetching detailed information for remaining users...');
  const batchSize = 100;
  let processedCount = existingData.users.length;
  let retryCount = 0;
  const maxRetries = 3;

  for (let i = 0; i < remainingUsers.length; i += batchSize) {
    const batch = remainingUsers.slice(i, i + batchSize);
    const batchData = [];

    for (const username of batch) {
      try {
        processedCount++;
        process.stdout.write(`\r🔍 Processing user ${processedCount}/${users.length}: @${username}`);
        
        const userData = await makeApiCall(
          `https://api.github.com/users/${username}`,
          `Failed to fetch data for ${username}`
        );
        
        batchData.push({
          username: userData.login,
          name: userData.name,
          bio: userData.bio,
          location: userData.location,
          company: userData.company,
          blog: userData.blog,
          public_repos: userData.public_repos,
          followers: userData.followers,
          following: userData.following,
          created_at: userData.created_at
        });
        
        // Save progress after each batch
        const currentData = JSON.parse(fs.readFileSync(filepath, 'utf8'));
        currentData.users = currentData.users.concat(batchData);
        fs.writeFileSync(filepath, JSON.stringify(currentData, null, 2));
        
        retryCount = 0;
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error) {
        if (error.message.includes('rate limit') && retryCount < maxRetries) {
          console.log('\n⚠️ Rate limit hit. Waiting 60 seconds...');
          await new Promise(resolve => setTimeout(resolve, 60000));
          i--; // Retry this user
          retryCount++;
          continue;
        }
        console.error(`\n❌ Error fetching data for ${username}:`, error.message);
      }
    }
  }

  process.stdout.write('\r' + ' '.repeat(100) + '\r');
  console.log(`\n✅ Saved ${processedCount} users' information to ${filepath}`);
  return filepath;
}

// Modify the function that checks last search from log file
function getLastSearchFromLog() {
  try {
    if (!fs.existsSync(LOG_FILE)) {
      return null;
    }
    
    const logContent = fs.readFileSync(LOG_FILE, 'utf8');
    const lines = logContent.split('\n').filter(Boolean);
    
    // Look for the last actual search entry (starting with 'search-')
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      // Skip timestamp if present (handle both old and new format)
      const parts = line.split(' - ').filter(Boolean);
      const lastPart = parts[parts.length - 2]; // Get the search part, not the username
      
      if (lastPart && lastPart.startsWith('search-')) {
        // Remove the 'search-' prefix and any quotes
        return lastPart.replace('search-', '').replace(/"/g, '');
      }
    }
    return null;
  } catch (error) {
    console.error('Error reading last search from log:', error);
    return null;
  }
}

// Add this function near the top with other utility functions
function cleanupLogFile() {
  if (!fs.existsSync(LOG_FILE)) {
    return;
  }

  try {
    console.log('\n🧹 Cleaning up log file...');
    const content = fs.readFileSync(LOG_FILE, 'utf8');
    const lines = content.split('\n').filter(Boolean);
    const cleanedLines = [];
    let invalidLines = 0;

    for (const line of lines) {
      // Handle both old and new format
      const parts = line.split(' - ').filter(Boolean);
      
      if (parts.length >= 2) {
        // If it's the new format (with timestamp)
        if (parts.length === 3) {
          const [timestamp, source, username] = parts;
          // Validate timestamp
          if (new Date(timestamp).toString() === 'Invalid Date') {
            invalidLines++;
            continue;
          }
          cleanedLines.push(line);
        }
        // If it's the old format (without timestamp)
        else if (parts.length === 2) {
          const [source, username] = parts;
          if (source && username) {
            cleanedLines.push(line);
          } else {
            invalidLines++;
          }
        }
      } else {
        invalidLines++;
      }
    }

    if (invalidLines > 0) {
      console.log(`   Found ${invalidLines} invalid entries`);
      // Create backup of original file
      const backupFile = `${LOG_FILE}.backup`;
      fs.copyFileSync(LOG_FILE, backupFile);
      console.log(`   Created backup at: ${backupFile}`);
      
      // Write cleaned content
      fs.writeFileSync(LOG_FILE, cleanedLines.join('\n') + '\n');
      console.log('   ✅ Log file cleaned successfully');
    } else {
      console.log('   ✅ Log file is clean');
    }
  } catch (error) {
    console.error('   ❌ Error cleaning log file:', error.message);
  }
}

// Add this function near the top with other utility functions
async function inviteUsersFromReadme() {
  try {
    console.log('\n📖 Reading users from README.md...');
    const readmeContent = fs.readFileSync('README.md', 'utf8');
    const users = readmeContent.match(/@[a-zA-Z0-9-]+/g) || [];
    const uniqueUsers = [...new Set(users)].map(user => user.substring(1)); // Remove @ symbol
    
    if (uniqueUsers.length === 0) {
      console.log('❌ No users found in README.md');
      return;
    }

    console.log(`\n🎯 Found ${uniqueUsers.length} unique users in README.md`);
    
    // Get current members and previously invited users
    const members = await getOrgMembers(ORG);
    const previouslyInvited = getPreviouslyInvitedUsers();
    
    // Filter out existing members and previously invited users
    const newUsers = uniqueUsers.filter(user => 
      !members.includes(user) && !previouslyInvited.has(user)
    );
    
    if (newUsers.length === 0) {
      console.log('✨ All users are already members or have pending invitations!');
      return;
    }

    console.log(`\n🎯 ${newUsers.length} new users to invite:`);
    for (const user of newUsers) {
      console.log(`   • @${user}`);
    }

    const confirm = await new Promise(resolve => {
      rl.question('\nDo you want to proceed with sending invites? (yes/no): ', resolve);
    });

    if (confirm.toLowerCase() === 'yes') {
      const forceInvite = await new Promise(resolve => {
        rl.question('Do you want to force send invites (bypass 50 limit)? (yes/no): ', resolve);
      });

      let successfulInvites = 0;
      for (const user of newUsers) {
        if (await inviteUser(user, 'readme', ORG, forceInvite.toLowerCase() === 'yes')) {
          successfulInvites++;
          await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_INVITES));
        }
      }

      console.log('\n✨ All done!');
      console.log(`📊 Stats for this session:`);
      console.log(`   • Successfully invited: ${successfulInvites} users`);
      console.log(`   • Total invites sent: ${invitationStats.totalInvites}`);
      console.log(`   • Invites in last 24h: ${invitationStats.last24Hours}`);
      console.log(`   • Pending invites: ${invitationStats.pendingInvites}`);
    }
  } catch (error) {
    console.error('Error inviting users from README:', error);
  }
}

// Modify the main function to use the new function
async function main() {
  try {
    console.log('🤖 KHC Invitation Bot');
    console.log('📝 Configuration:');
    console.log('   GitHub Token: ✅ Present');

    // Clean up log file first
    cleanupLogFile();

    // Load previously invited users
    const previouslyInvited = getPreviouslyInvitedUsers();
    console.log(`📋 Previously invited users: ${previouslyInvited.size}`);

    // Check last search from log file
    const lastSearch = getLastSearchFromLog();
    
    if (lastSearch) {
      console.log(`\n🔍 Found previous search for: "${lastSearch}"`);
      
      const checkPrevious = await new Promise(resolve => {
        rl.question('Do you want to continue with the previous search first? (yes/no): ', resolve);
      });

      if (checkPrevious.toLowerCase() === 'yes') {
        console.log(`\n🔍 Checking last search: "${lastSearch}"`);
        const followers = await searchUsersByKeyword(lastSearch);
        
        if (followers.length > 0) {
          const members = await getOrgMembers(ORG);
          const newFollowers = followers.filter(user => 
            !members.includes(user) && !previouslyInvited.has(user)
          );
          
          if (newFollowers.length > 0) {
            console.log(`\n🎯 Found ${newFollowers.length} new users to invite:`);
            for (const user of newFollowers) {
              console.log(`   • @${user}`);
            }

            const confirm = await new Promise(resolve => {
              rl.question('\nDo you want to proceed with sending invites? (yes/no): ', resolve);
            });

            if (confirm.toLowerCase() === 'yes') {
              const forceInvite = await new Promise(resolve => {
                rl.question('Do you want to force send invites (bypass 50 limit)? (yes/no): ', resolve);
              });

              let successfulInvites = 0;
              for (const user of newFollowers) {
                if (await inviteUser(user, `search-${lastSearch}`, ORG, forceInvite.toLowerCase() === 'yes')) {
                  successfulInvites++;
                  await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_INVITES));
                }
              }

              console.log('\n✨ All done!');
              console.log(`📊 Stats for this session:`);
              console.log(`   • Successfully invited: ${successfulInvites} users`);
              console.log(`   • Total invites sent: ${invitationStats.totalInvites}`);
              console.log(`   • Invites in last 24h: ${invitationStats.last24Hours}`);
              console.log(`   • Pending invites: ${invitationStats.pendingInvites}`);
            }
          } else {
            console.log('✨ No new users to invite!');
          }
        } else {
          console.log('✨ No new followers found from last search!');
        }
      }
    }

    // Add option to invite users from README
    const inviteFromReadme = await new Promise(resolve => {
      rl.question('\nDo you want to invite users from README.md? (yes/no): ', resolve);
    });

    if (inviteFromReadme.toLowerCase() === 'yes') {
      await inviteUsersFromReadme();
    }

    // Ask for global preference
    console.log('\n🔧 Please set your preference for handling found users:');
    console.log('1. Send invitations directly');
    console.log('2. Save user information to file');
    console.log('3. Ask each time');

    const preference = await new Promise(resolve => {
      rl.question('Enter your choice (1-3): ', resolve);
    });

    let globalPreference = null;
    if (preference === '1') {
      globalPreference = 'invite';
    } else if (preference === '2') {
      globalPreference = 'save';
    }

    console.log('\n📊 Current Stats:');
    console.log(`   Total Invites Sent: ${invitationStats.totalInvites}`);
    console.log(`   Invites in Last 24h: ${invitationStats.last24Hours}`);
    console.log(`   Pending Invites: ${invitationStats.pendingInvites}\n`);

    // Show main menu options
    console.log('\nPlease choose an option:');
    console.log('1. Invite followers of a specific user');
    console.log('2. Invite followers of an organization');
    console.log('3. Invite a single user (by username or email)');
    console.log('4. Search and invite users by keyword');
    console.log('5. Scan repository/organization contributors');
    console.log('6. Follow all organization members');
    console.log('7. Scan README files for GitHub users');

    const answer = await new Promise(resolve => {
      rl.question('Enter your choice (1-7): ', resolve);
    });

    let followers;
    let sourceUsername;
    let targetOrg = ORG;

    if (answer === '7') {
      const repoUrl = await new Promise(resolve => {
        rl.question('Enter the GitHub repository URL: ', resolve);
      });
      
      sourceUsername = `readme-${repoUrl.split('/').pop()}`;
      followers = await scanReadmeForUsers(repoUrl);
    } else if (answer === '5') {
      const repoUrl = await new Promise(resolve => {
        rl.question('Enter the GitHub repository or organization URL: ', resolve);
      });
      
      sourceUsername = `scan-${repoUrl.split('/').pop()}`;
      followers = await getRepoContributors(repoUrl);
    } else if (answer === '1') {
      sourceUsername = await new Promise(resolve => {
        rl.question('Enter the GitHub username: ', resolve);
      });
      followers = await getFollowers(sourceUsername);
      
      if (followers.length > 0) {
        let action = globalPreference;
        
        if (!action) {
          console.log('\nFound users. What would you like to do?');
          console.log('1. Send invitations');
          console.log('2. Save user information to file');
          
          const choice = await new Promise(resolve => {
            rl.question('Enter your choice (1-2): ', resolve);
          });
          
          action = choice === '1' ? 'invite' : 'save';
        }

        if (action === 'save') {
          const filepath = await saveUsersToFile(followers, 'user_followers', sourceUsername);
          console.log('\n✨ All done!');
          console.log(`📁 User information has been saved to: ${filepath}`);
          console.log('You can find the following information for each user:');
          console.log('- Username, Name, Bio');
          console.log('- Location, Company, Blog');
          console.log('- Number of repositories');
          console.log('- Follower and following counts');
          console.log('- Account creation date');
          return;
        }

        // Continue with invitation process if action is 'invite'
        const members = await getOrgMembers(targetOrg);
        const newFollowers = followers.filter(user => 
          !members.includes(user) && !previouslyInvited.has(user)
        );

        if (newFollowers.length === 0) {
          console.log('✨ No new followers to invite!');
          return;
        }

        console.log(`\n🎯 Found ${newFollowers.length} new user${newFollowers.length === 1 ? '' : 's'} to invite:`);
        for (const user of newFollowers) {
          console.log(`   • @${user}`);
        }

        if (followers.length - newFollowers.length > 0) {
          console.log(`\n⚠️ Skipping ${followers.length - newFollowers.length} previously invited users`);
        }

        const confirm = await new Promise(resolve => {
          rl.question(`\nDo you want to proceed with sending invites to ${targetOrg}? (yes/no): `, resolve);
        });

        if (confirm.toLowerCase() !== 'yes') {
          console.log('❌ Invitation process cancelled.');
          return;
        }

        const forceInvite = await new Promise(resolve => {
          rl.question('Do you want to force send invites (bypass 50 limit)? (yes/no): ', resolve);
        });

        let successfulInvites = 0;
        for (const user of newFollowers) {
          if (await inviteUser(user, sourceUsername, targetOrg, forceInvite.toLowerCase() === 'yes')) {
            successfulInvites++;
            await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_INVITES));
          }
        }

        console.log('\n✨ All done!');
        console.log(`📊 Stats for this session:`);
        console.log(`   • Successfully invited: ${successfulInvites} users`);
        console.log(`   • Total invites sent: ${invitationStats.totalInvites}`);
        console.log(`   • Invites in last 24h: ${invitationStats.last24Hours}`);
        console.log(`   • Pending invites: ${invitationStats.pendingInvites}`);
        console.log(`📝 Invitation log has been updated in ${LOG_FILE}`);
        console.log(`📊 Stats have been saved to ${INVITATION_STATS_FILE}`);

        // After successful invites in any option, follow new members
        if (successfulInvites > 0) {
          console.log('\n👥 Following organization members...');
          await followAllOrgMembers();
        }
      } else {
        console.log('✨ No followers found for this user!');
      }
    } else if (answer === '2') {
      console.log('\nChoose organization option:');
      console.log('1. Krypto-Hashers-Community (KHC)');
      console.log('2. Different organization');
      
      const orgChoice = await new Promise(resolve => {
        rl.question('Enter your choice (1 or 2): ', resolve);
      });

      if (orgChoice === '2') {
        let isValidOrg = false;
        let orgName = null;
        while (!isValidOrg) {
          const orgUrl = await new Promise(resolve => {
            rl.question('Enter the organization URL (e.g., "https://github.com/organization-name"): ', resolve);
          });
          
          console.log('🔍 Validating organization...');
          const validation = await validateOrg(orgUrl);
          isValidOrg = validation.valid;
          orgName = validation.orgName;
          
          if (!isValidOrg) {
            console.log('❌ Invalid organization URL. Please try again.');
            console.log('   Make sure the URL is in the format: https://github.com/organization-name');
          }
        }
        sourceUsername = orgName;
        followers = await getOrgFollowers(orgName);
      } else {
        sourceUsername = ORG;
        followers = await getOrgFollowers(ORG);
      }

      if (followers.length > 0) {
        let action = globalPreference;
        
        if (!action) {
          console.log('\nFound users. What would you like to do?');
          console.log('1. Send invitations');
          console.log('2. Save user information to file');
          
          const choice = await new Promise(resolve => {
            rl.question('Enter your choice (1-2): ', resolve);
          });
          
          action = choice === '1' ? 'invite' : 'save';
        }

        if (action === 'save') {
          const filepath = await saveUsersToFile(followers, 'org_followers', sourceUsername);
          console.log('\n✨ All done!');
          console.log(`📁 User information has been saved to: ${filepath}`);
          console.log('You can find the following information for each user:');
          console.log('- Username, Name, Bio');
          console.log('- Location, Company, Blog');
          console.log('- Number of repositories');
          console.log('- Follower and following counts');
          console.log('- Account creation date');
          return;
        }

        // Continue with invitation process if action is 'invite'
        const members = await getOrgMembers(targetOrg);
        const newFollowers = followers.filter(user => 
          !members.includes(user) && !previouslyInvited.has(user)
        );
        
        if (newFollowers.length === 0) {
          console.log('✨ No new followers to invite!');
          return;
        }

        console.log(`\n🎯 Found ${newFollowers.length} new user${newFollowers.length === 1 ? '' : 's'} to invite:`);
        for (const user of newFollowers) {
          console.log(`   • @${user}`);
        }

        if (followers.length - newFollowers.length > 0) {
          console.log(`\n⚠️ Skipping ${followers.length - newFollowers.length} previously invited users`);
        }

        const confirm = await new Promise(resolve => {
          rl.question(`\nDo you want to proceed with sending invites to ${targetOrg}? (yes/no): `, resolve);
        });

        if (confirm.toLowerCase() !== 'yes') {
          console.log('❌ Invitation process cancelled.');
          return;
        }

        const forceInvite = await new Promise(resolve => {
          rl.question('Do you want to force send invites (bypass 50 limit)? (yes/no): ', resolve);
        });

        let successfulInvites = 0;
        for (const user of newFollowers) {
          if (await inviteUser(user, sourceUsername, targetOrg, forceInvite.toLowerCase() === 'yes')) {
            successfulInvites++;
            await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_INVITES));
          }
        }

        console.log('\n✨ All done!');
        console.log(`📊 Stats for this session:`);
        console.log(`   • Successfully invited: ${successfulInvites} users`);
        console.log(`   • Total invites sent: ${invitationStats.totalInvites}`);
        console.log(`   • Invites in last 24h: ${invitationStats.last24Hours}`);
        console.log(`   • Pending invites: ${invitationStats.pendingInvites}`);
        console.log(`📝 Invitation log has been updated in ${LOG_FILE}`);
        console.log(`📊 Stats have been saved to ${INVITATION_STATS_FILE}`);

        // After successful invites in any option, follow new members
        if (successfulInvites > 0) {
          console.log('\n👥 Following organization members...');
          await followAllOrgMembers();
        }
      } else {
        console.log('✨ No followers found for this organization!');
      }
    } else if (answer === '3') {
      let isValidUser = false;
      let username = null;
      while (!isValidUser) {
        const userIdentifier = await new Promise(resolve => {
          rl.question('Enter GitHub username or email: ', resolve);
        });
        
        console.log('🔍 Validating user...');
        const validation = await validateUser(userIdentifier);
        isValidUser = validation.valid;
        username = validation.username;
        
        if (!isValidUser) {
          console.log('❌ Invalid user. Please try again.');
          console.log('   Make sure to enter a valid GitHub username or email');
        }
      }
      
      sourceUsername = 'manual-invite';
      followers = [username];
    } else if (answer === '4') {
      console.log('\n🧩 GitHub User Search');
      console.log('ℹ️ Important Notes:');
      console.log('• The GitHub API limits results to 1000 users per search');
      console.log('• Results are sorted by best match');
      console.log('• Use specific filters to find the most relevant users\n');
      
      console.log('Example queries:');
      console.log('Simple queries:');
      console.log('• location:Germany');
      console.log('  (Find users from Germany)');
      console.log('• followers:>=1000');
      console.log('  (Find users with 1000+ followers)');
      console.log('\nNarrowed queries:');
      console.log('• location:Germany followers:>=1000');
      console.log('  (Find popular users from Germany)');
      console.log('• location:Germany language:python pushed:>=2023-06-01');
      console.log('  (Find active Python developers from Germany)');
      console.log('\nComplex queries:');
      console.log('• followers:>=200 repos:>=30 pushed:>=2023-01-01');
      console.log('  (Find users with 200+ followers, 30+ repos, who pushed recently)');
      console.log('• followers:>=100 language:javascript location:"San Francisco"');
      console.log('  (Find JavaScript developers from San Francisco)');
      console.log('• created:<=2020-01-01 followers:>=500');
      console.log('  (Old and popular GitHub accounts)\n');
      console.log('💡 Tips:');
      console.log('• Try simpler queries first, then add filters to narrow results');
      console.log('• Date format: YYYY-MM-DD');
      console.log('• Use quotes for locations with spaces: location:"New York"');
      console.log('• Available operators: >, <, >=, <=');
      console.log('• Language names are case-sensitive (e.g., javascript, Python, Go)');
      console.log('• If results exceed 1000, add more filters to narrow down\n');

      const keyword = await new Promise(resolve => {
        rl.question('Enter your search query: ', resolve);
      });

      console.log('\nDo you want to:');
      console.log('1. Get first 500 users (faster)');
      console.log('2. Get all users (may take longer)');
      
      const searchChoice = await new Promise(resolve => {
        rl.question('Enter your choice (1-2): ', resolve);
      });
      
      sourceUsername = `search-${keyword}`;
      followers = await searchUsersByKeyword(keyword, 0, searchChoice === '2');
      
      if (followers.length > 0) {
        let action = globalPreference;
        
        if (!action) {
          console.log('\nFound users. What would you like to do?');
          console.log('1. Send invitations');
          console.log('2. Save user information to file');
          
          const choice = await new Promise(resolve => {
            rl.question('Enter your choice (1-2): ', resolve);
          });
          
          action = choice === '1' ? 'invite' : 'save';
        }

        if (action === 'save') {
          const filepath = await saveUsersToFile(followers, 'keyword_search', keyword);
          console.log('\n✨ All done!');
          console.log(`📁 User information has been saved to: ${filepath}`);
          console.log('You can find the following information for each user:');
          console.log('- Username, Name, Bio');
          console.log('- Location, Company, Blog');
          console.log('- Number of repositories');
          console.log('- Follower and following counts');
          console.log('- Account creation date');
          return;
        }
      }

      // Continue with invitation process if action is 'invite'
      const members = await getOrgMembers(targetOrg);
      const newFollowers = followers.filter(user => 
        !members.includes(user) && !previouslyInvited.has(user)
      );
      
      if (newFollowers.length === 0) {
        console.log('✨ No new followers to invite!');
        return;
      }

      console.log(`\n🎯 Found ${newFollowers.length} new user${newFollowers.length === 1 ? '' : 's'} to invite:`);
      for (const user of newFollowers) {
        console.log(`   • @${user}`);
      }

      if (followers.length - newFollowers.length > 0) {
        console.log(`\n⚠️ Skipping ${followers.length - newFollowers.length} previously invited users`);
      }

      const confirm = await new Promise(resolve => {
        rl.question(`\nDo you want to proceed with sending invites to ${targetOrg}? (yes/no): `, resolve);
      });

      if (confirm.toLowerCase() !== 'yes') {
        console.log('❌ Invitation process cancelled.');
        return;
      }

      const forceInvite = await new Promise(resolve => {
        rl.question('Do you want to force send invites (bypass 50 limit)? (yes/no): ', resolve);
      });

      let successfulInvites = 0;
      for (const user of newFollowers) {
        if (await inviteUser(user, sourceUsername, targetOrg, forceInvite.toLowerCase() === 'yes')) {
          successfulInvites++;
          // Add delay between invites
          await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_INVITES));
        }
      }

      console.log('\n✨ All done!');
      console.log(`📊 Stats for this session:`);
      console.log(`   • Successfully invited: ${successfulInvites} users`);
      console.log(`   • Total invites sent: ${invitationStats.totalInvites}`);
      console.log(`   • Invites in last 24h: ${invitationStats.last24Hours}`);
      console.log(`   • Pending invites: ${invitationStats.pendingInvites}`);
      console.log(`📝 Invitation log has been updated in ${LOG_FILE}`);
      console.log(`📊 Stats have been saved to ${INVITATION_STATS_FILE}`);

      // After successful invites in any option, follow new members
      if (successfulInvites > 0) {
        console.log('\n👥 Following organization members...');
        await followAllOrgMembers();
      }
    } else if (answer === '6') {
      await followAllOrgMembers();
      return;
    } else {
      console.error('❌ Invalid choice. Please enter 1, 2, 3, 4, 5, 6, or 7.');
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ An unexpected error occurred:', error.message);
    process.exit(1);
  } finally {
    rl.close();
  }
}

main();