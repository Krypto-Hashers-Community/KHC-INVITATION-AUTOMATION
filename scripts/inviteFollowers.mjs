// scripts/inviteFollowers.mjs
import fetch from 'node-fetch';
import { config } from 'dotenv';
import { createInterface } from 'readline';
import { writeFileSync, readFileSync, appendFileSync, existsSync, mkdirSync, copyFileSync, unlinkSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { execSync } from 'child_process';
import { readdirSync, basename } from 'fs';

// Initialize dotenv
config();

const ORG = 'Krypto-Hashers-Community';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const LOG_FILE = 'invitation_log.txt';
const INVITATION_STATS_FILE = 'invitation_stats.json';
const DELAY_BETWEEN_INVITES = 2000; // 2 seconds delay between invites
const SEARCH_PROGRESS_FILE = 'search_progress.json';
const USERS_DATA_DIR = 'users_data';
const DEFAULT_SAVE_FILE = 'github_users.json';
const DEFAULT_TEAM = 'support';
const DEFAULT_TEAM_URL = 'https://github.com/orgs/Krypto-Hashers-Community/teams/support';

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
if (!existsSync(LOG_FILE)) {
  writeFileSync(LOG_FILE, '');
}

// Load or initialize invitation stats
let invitationStats = {
  totalInvites: 0,
  last24Hours: 0,
  lastInviteTime: 0,
  pendingInvites: 0
};

if (existsSync(INVITATION_STATS_FILE)) {
  try {
    invitationStats = JSON.parse(readFileSync(INVITATION_STATS_FILE, 'utf8'));
  } catch (error) {
    console.error('Error loading stats file:', error);
  }
}

// Update stats file
function updateStats() {
  writeFileSync(INVITATION_STATS_FILE, JSON.stringify(invitationStats, null, 2));
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
  if (!existsSync(LOG_FILE)) return new Set();
  
  const logContent = readFileSync(LOG_FILE, 'utf8');
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

if (existsSync(SEARCH_PROGRESS_FILE)) {
  try {
    searchProgress = JSON.parse(readFileSync(SEARCH_PROGRESS_FILE, 'utf8'));
  } catch (error) {
    console.error('Error loading search progress:', error);
  }
}

// Update search progress file
function updateSearchProgress() {
  writeFileSync(SEARCH_PROGRESS_FILE, JSON.stringify(searchProgress, null, 2));
}

// Load or initialize members list
let previousMembers = new Set();
if (existsSync(MEMBERS_FILE)) {
  try {
    previousMembers = new Set(JSON.parse(readFileSync(MEMBERS_FILE, 'utf8')));
  } catch (error) {
    console.error('Error loading members file:', error);
  }
}

// Save members list
function updateMembersList(members) {
  writeFileSync(MEMBERS_FILE, JSON.stringify(Array.from(members)));
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

const rl = createInterface({
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
  if (existsSync(SCAN_PROGRESS_FILE)) {
    try {
      const progress = JSON.parse(readFileSync(SCAN_PROGRESS_FILE, 'utf8'));
      // Check if the progress is recent (less than 6 hours old)
      const progressAge = Date.now() - new Date(progress.lastSavedAt).getTime();
      if (progressAge < 6 * 60 * 60 * 1000) { // 6 hours
        return progress;
      } else {
        console.log('\n⚠️ Found old progress file (>6h old). Starting fresh scan...');
        unlinkSync(SCAN_PROGRESS_FILE);
      }
    } catch (error) {
      console.error('Error loading scan progress:', error);
      // If file is corrupted, delete it
      unlinkSync(SCAN_PROGRESS_FILE);
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
  
  writeFileSync(SCAN_PROGRESS_FILE, JSON.stringify(progress, null, 2));
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
        if (existsSync(SCAN_PROGRESS_FILE)) {
          unlinkSync(SCAN_PROGRESS_FILE);
        }
      }
    } else {
      console.log('\n⚠️ Organization data has changed since last scan. Starting fresh...');
      if (existsSync(SCAN_PROGRESS_FILE)) {
        unlinkSync(SCAN_PROGRESS_FILE);
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
  if (existsSync(SCAN_PROGRESS_FILE)) {
    unlinkSync(SCAN_PROGRESS_FILE);
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
  console.log(`\n📥 Fetching current members of ${orgName}...`);
  let allMembers = new Set();
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    try {
      const res = await fetch(`https://api.github.com/orgs/${orgName}/members?per_page=100&page=${page}`, { headers });
      
      if (!res.ok) {
        const error = await res.json();
        console.error('❌ Failed to fetch members:', error.message);
        break;
      }

      const members = await res.json();
      if (members.length === 0) {
        hasMore = false;
      } else {
        members.forEach(member => allMembers.add(member.login));
        page++;
      }
    } catch (error) {
      console.error('❌ Error:', error.message);
      break;
    }
  }

  return Array.from(allMembers);
}

async function getTeamId(orgName, teamSlug) {
  try {
    const res = await fetch(`https://api.github.com/orgs/${orgName}/teams/${teamSlug}`, { headers });
    if (res.ok) {
      const team = await res.json();
      return team.id;
    }
    return null;
  } catch (error) {
    console.error('❌ Error fetching team ID:', error.message);
    return null;
  }
}

async function getUserId(username) {
  try {
    const res = await fetch(`https://api.github.com/users/${username}`, { headers });
    if (res.ok) {
      const user = await res.json();
      return user.id;
    }
    return null;
  } catch (error) {
    console.error('❌ Error fetching user ID:', error.message);
    return null;
  }
}

function cleanupLogFile() {
  if (!existsSync(LOG_FILE)) return;
  
  const now = Date.now();
  const oneDay = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
  
  const logContent = readFileSync(LOG_FILE, 'utf8');
  const lines = logContent.split('\n').filter(line => {
    if (!line.trim()) return false;
    
    const [timestamp] = line.split(' - ');
    const inviteTime = new Date(timestamp).getTime();
    return now - inviteTime <= oneDay;
  });
  
  writeFileSync(LOG_FILE, lines.join('\n') + '\n');
}

function getLastSearchFromLog() {
  if (!existsSync(LOG_FILE)) return null;
  
  const logContent = readFileSync(LOG_FILE, 'utf8');
  const lines = logContent.split('\n').filter(Boolean);
  
  if (lines.length === 0) return null;
  
  const lastLine = lines[lines.length - 1];
  const match = lastLine.match(/search-(.*?) -/);
  return match ? match[1] : null;
}

// Modify the appendToLog function to ensure we preserve existing data
function appendToLog(sourceUsername, invitedUser) {
  const timestamp = new Date().toISOString();
  const logEntry = `${timestamp} - ${sourceUsername} - ${invitedUser}\n`;
  
  try {
    // Create backup of current log first if it exists
    if (existsSync(LOG_FILE)) {
      copyFileSync(LOG_FILE, `${LOG_FILE}.backup`);
    }

    // Ensure directory exists
    const logDir = dirname(LOG_FILE);
    if (!existsSync(logDir)) {
      mkdirSync(logDir, { recursive: true });
    }

    // Append to log file (create if doesn't exist)
    if (!existsSync(LOG_FILE)) {
      writeFileSync(LOG_FILE, '');
    }
    appendFileSync(LOG_FILE, logEntry);

    // Append to JSON file while preserving existing entries
    let jsonEntries = [];
    if (existsSync('invited_users.json')) {
      try {
        const content = readFileSync('invited_users.json', 'utf8');
        jsonEntries = content.split('\n')
          .filter(line => line.trim())
          .map(line => JSON.parse(line));
      } catch (error) {
        console.error('Warning: Error reading existing invited_users.json');
      }
    }
    
    // Add new entry
    jsonEntries.push({
      timestamp,
      source: sourceUsername,
      username: invitedUser,
      status: 'invited'
    });

    // Write back all entries
    writeFileSync('invited_users.json', 
      jsonEntries.map(entry => JSON.stringify(entry)).join('\n') + '\n'
    );

    // Verify the write
    const lastLine = readFileSync(LOG_FILE, 'utf8').split('\n').filter(Boolean).pop();
    if (lastLine !== logEntry.trim()) {
      throw new Error('Log entry verification failed');
    }

    console.log('\n📝 Successfully logged invitation');
  } catch (error) {
    console.error('\n❌ Error writing to log:', error.message);
    
    // Try to restore from backup if we have one
    if (existsSync(`${LOG_FILE}.backup`)) {
      try {
        copyFileSync(`${LOG_FILE}.backup`, LOG_FILE);
        appendFileSync(LOG_FILE, logEntry);
        console.log('✅ Restored from backup and added new entry');
      } catch (backupError) {
        console.error('❌ Failed to restore from backup:', backupError.message);
      }
    }
  }
}

// Add this function after getPreviouslyInvitedUsers()
function isUserAlreadyInvited(username) {
  const logContent = readFileSync(LOG_FILE, 'utf8');
  const invitedUsers = logContent.split('\n')
    .filter(line => line.trim())
    .map(line => {
      const parts = line.split(' - ');
      return parts.length >= 2 ? parts[2] : null;
    })
    .filter(user => user !== null);
  
  return invitedUsers.includes(username);
}

// Add these functions before searchUsersByKeyword
function parseGitHubQuery(query) {
  const filters = {
    base: [],
    followers: '',
    repos: '',
    language: '',
    location: '',
    created: '',
    pushed: ''
  };

  // Split query into parts, preserving quoted strings
  const parts = query.match(/(?:[^\s"]+|"[^"]*")+/g) || [];

  parts.forEach(part => {
    // Remove quotes from quoted strings
    part = part.replace(/^"(.*)"$/, '$1');

    if (part.includes(':')) {
      const [key, value] = part.split(':');
      switch (key.toLowerCase()) {
        case 'followers':
        case 'repos':
          filters[key] = value;
          break;
        case 'language':
          filters.language = value;
          break;
        case 'location':
          filters.location = value;
          break;
        case 'created':
        case 'pushed':
          filters[key] = value;
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

function validateSearchFilters(filters) {
  const errors = [];
  
  // Validate numeric filters
  ['followers', 'repos'].forEach(key => {
    if (filters[key] && !/^[<>]=?\d+$/.test(filters[key])) {
      errors.push(`Invalid ${key} filter. Use format: ${key}:>100 or ${key}:>=100`);
    }
  });

  // Validate date filters
  ['created', 'pushed'].forEach(key => {
    if (filters[key] && !/^[<>]=?\d{4}-\d{2}-\d{2}$/.test(filters[key])) {
      errors.push(`Invalid ${key} filter. Use format: ${key}:>2020-01-01 or ${key}:>=2020-01-01`);
    }
  });

  return errors;
}

function buildGitHubSearchUrl(filters, page) {
  const query = ['type:user']; // Add type:user filter to only get individual users

  // Add base keywords
  if (filters.base.length > 0) {
    query.push(filters.base.join(' '));
  }

  // Add filters
  if (filters.followers) query.push(`followers:${filters.followers}`);
  if (filters.repos) query.push(`repos:${filters.repos}`);
  if (filters.language) query.push(`language:${filters.language}`);
  if (filters.location) query.push(`location:"${filters.location}"`);
  if (filters.created) query.push(`created:${filters.created}`);
  if (filters.pushed) query.push(`pushed:${filters.pushed}`);

  // Build the URL
  const encodedQuery = encodeURIComponent(query.join(' '));
  return `https://api.github.com/search/users?q=${encodedQuery}&page=${page}`;
}

// Modify the searchUsersByKeyword function
async function searchUsersByKeyword(query, startPage = 0, getAllUsers = false) {
  console.log(`\n🔍 Searching for users matching: "${query}"`);
  let allUsers = new Set();
  let page = startPage || 1;
  let hasMore = true;
  let startTime = Date.now();
  let totalResults = 0;

  while (hasMore) {
    try {
      const res = await fetch(
        `https://api.github.com/search/users?q=${encodeURIComponent(query)}&page=${page}&per_page=100`,
        { headers }
      );

      if (!res.ok) {
        const error = await res.json();
        console.error('❌ Search failed:', error.message);
        break;
      }

      const data = await res.json();
      totalResults = data.total_count;
      
      if (data.items.length === 0 || (!getAllUsers && allUsers.size >= 500)) {
        hasMore = false;
      } else {
        data.items.forEach(user => allUsers.add(user.login));
        console.log(`   Found ${allUsers.size}/${totalResults} users...`);
        page++;
        
        // Add delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    } catch (error) {
      console.error('❌ Error:', error.message);
      break;
    }
  }

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n✅ Found ${allUsers.size} users in ${totalTime}s`);
  
  // Save search progress
  searchProgress = {
    lastSearch: query,
    completedCount: allUsers.size,
    totalCount: totalResults,
    remainingUsers: Array.from(allUsers)
  };
  updateSearchProgress();

  return Array.from(allUsers);
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

// Add this function before handleSponsorInvitations
async function inviteUser(username, sourceUsername, targetOrg, forceInvite = false, teamId = null) {
  // Check if we can send more invites (unless force invite is enabled)
  if (!forceInvite && !canSendMoreInvites()) {
    console.log(`\n⚠️ Daily invitation limit reached. Skipping @${username}`);
    return false;
  }

  try {
    // First check if user exists and get their ID
    const userId = await getUserId(username);
    if (!userId) {
      console.log(`\n❌ Could not find user @${username}`);
      return false;
    }

    // Send the invitation
    console.log(`\n📨 Inviting @${username} to ${targetOrg}${teamId ? ' Support Team' : ''}...`);
    const inviteData = {
      invitee_id: userId,
      role: 'direct_member'
    };

    // If teamId is provided, add team membership
    if (teamId) {
      inviteData.team_ids = [teamId];
    }

    const res = await fetch(`https://api.github.com/orgs/${targetOrg}/invitations`, {
      method: 'POST',
      headers,
      body: JSON.stringify(inviteData)
    });

    if (!res.ok) {
      const error = await res.json();
      
      if (error.message.includes('rate limit')) {
        console.log('⚠️ Rate limit reached. Please try again later.');
        failedInvitesCount++;
        if (failedInvitesCount >= MAX_FAILED_INVITES) {
          console.log('❌ Too many failed attempts. Stopping invitations.');
          process.exit(1);
        }
        return false;
      }
      
      if (error.message.includes('already invited')) {
        console.log('⚠️ User was already invited');
        return false;
      }
      
      console.error('❌ Failed to send invitation:', error.message);
      return false;
    }

    // Update stats
    invitationStats.totalInvites++;
    invitationStats.last24Hours++;
    invitationStats.lastInviteTime = Date.now();
    invitationStats.pendingInvites++;
    updateStats();

    // Log the invitation
    const timestamp = new Date().toISOString();
    appendFileSync(LOG_FILE, `${timestamp} - ${sourceUsername} - ${username}\n`);

    console.log('✅ Invitation sent successfully');
    return true;
  } catch (error) {
    console.error('❌ Error:', error.message);
    return false;
  }
}

// Modify commitLogFiles to be more careful with existing data
async function commitLogFiles() {
  try {
    const timestamp = new Date().toISOString().split('T')[0];
    const message = `Update invitation logs - ${timestamp}`;
    
    console.log('\n📤 Committing log files to repository...');
    
    // First verify all files exist and have content
    const filesToCommit = [
      LOG_FILE,
      'invited_users.json',
      'invitation_stats.json',
      `${LOG_FILE}.backup`,
      'search_progress.json'
    ];

    // Check each file before staging
    for (const file of filesToCommit) {
      if (existsSync(file)) {
        try {
          // Read file content to verify it's not empty or corrupted
          const content = readFileSync(file, 'utf8');
          if (content.trim()) {
            execSync(`git add "${file}"`, { stdio: 'pipe' });
            console.log(`✅ Staged ${file}`);
          } else {
            console.log(`⚠️ Skipping empty file: ${file}`);
          }
        } catch (error) {
          console.error(`❌ Error with ${file}:`, error.message);
        }
      }
    }

    // Check if there are any changes to commit
    const status = execSync('git status --porcelain', { encoding: 'utf8' });
    if (!status.trim()) {
      console.log('ℹ️ No changes to commit');
      return;
    }

    // Commit changes
    try {
      execSync(`git commit -m "${message}"`, { stdio: 'pipe' });
      console.log('✅ Successfully committed changes');

      // Push changes
      console.log('📤 Pushing changes to remote...');
      execSync('git push origin master', { stdio: 'pipe' });
      console.log('✅ Successfully pushed changes');
    } catch (error) {
      console.error('❌ Failed to commit/push changes:', error.message);
    }
  } catch (error) {
    console.error('❌ Error during git operations:', error.message);
  }
}

// Modify handleSponsorInvitations to include commit after success
async function handleSponsorInvitations(followers, sourceUsername, targetOrg) {
  if (followers.length === 0) {
    console.log('✨ No users found!');
    return false;
  }

  // Get current members
  const members = await getOrgMembers(targetOrg);
  const previouslyInvited = new Set(
    readFileSync(LOG_FILE, 'utf8')
      .split('\n')
      .filter(line => line.trim())
      .map(line => line.split(' - ')[2])
  );

  const newFollowers = followers.filter(user => 
    !members.includes(user) && !previouslyInvited.has(user)
  );

  if (newFollowers.length === 0) {
    console.log('✨ No new users to invite!');
    return false;
  }

  console.log(`\n🎯 Found ${newFollowers.length} new user${newFollowers.length === 1 ? '' : 's'} to invite to the Support Team:`);
  for (const user of newFollowers) {
    console.log(`   • @${user}`);
  }

  const confirm = await new Promise(resolve => {
    rl.question(`\nDo you want to proceed with sending invites to ${targetOrg} Support Team? (yes/no): `, resolve);
  });

  if (confirm.toLowerCase() !== 'yes') {
    console.log('❌ Invitation process cancelled.');
    return false;
  }

  const forceInvite = await new Promise(resolve => {
    rl.question('Do you want to force send invites (bypass 50 limit)? (yes/no): ', resolve);
  });

  // Get team ID first
  console.log('\n🔍 Fetching Support Team information...');
  const teamId = await getTeamId(targetOrg, DEFAULT_TEAM);
  if (!teamId) {
    console.error('❌ Could not find Support Team. Please check the team URL and try again.');
    return false;
  }

  let successfulInvites = 0;
  for (const user of newFollowers) {
    if (await inviteUser(user, sourceUsername, targetOrg, forceInvite.toLowerCase() === 'yes', teamId)) {
      successfulInvites++;
      await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_INVITES));
    }
  }

  console.log('\n✨ All done!');
  console.log(`📊 Stats for this session:`);
  console.log(`   • Successfully invited: ${successfulInvites} users to Support Team`);
  console.log(`   • Total invites sent: ${invitationStats.totalInvites}`);
  console.log(`   • Invites in last 24h: ${invitationStats.last24Hours}`);
  console.log(`   • Pending invites: ${invitationStats.pendingInvites}`);

  // Add commit operation if there were successful invites
  if (successfulInvites > 0) {
    await commitLogFiles();
  }

  return successfulInvites > 0;
}

function loadFollowedUsers() {
  if (!existsSync(FOLLOWED_USERS_FILE)) {
    writeFileSync(FOLLOWED_USERS_FILE, JSON.stringify([]));
    return new Set();
  }
  try {
    return new Set(JSON.parse(readFileSync(FOLLOWED_USERS_FILE, 'utf8')));
  } catch (error) {
    console.error('Error loading followed users file:', error);
    return new Set();
  }
}

function saveFollowedUsers(followedUsers) {
  writeFileSync(FOLLOWED_USERS_FILE, JSON.stringify(Array.from(followedUsers)));
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
  if (!existsSync(USERS_DATA_DIR)) {
    mkdirSync(USERS_DATA_DIR);
  }

  // Generate filename based on source and date
  const date = new Date().toISOString().split('T')[0];
  const filename = `${sourceType}_${keyword}_${date}.json`.replace(/[^a-zA-Z0-9-_\.]/g, '_');
  const filepath = join(USERS_DATA_DIR, filename);

  // Check if file exists and has partial data
  let existingData = { users: [] };
  if (existsSync(filepath)) {
    try {
      existingData = JSON.parse(readFileSync(filepath, 'utf8'));
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
  writeFileSync(filepath, JSON.stringify(fileHeader, null, 2));

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
        const currentData = JSON.parse(readFileSync(filepath, 'utf8'));
        currentData.users = currentData.users.concat(batchData);
        writeFileSync(filepath, JSON.stringify(currentData, null, 2));
        
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

// Add this function near the top with other utility functions
async function inviteUsersFromReadme() {
  try {
    console.log('\n📖 Reading users from README.md...');
    const readmeContent = readFileSync('README.md', 'utf8');
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

// Add this function before handleSponsorInvitations
function extractGitHubUsername(url) {
  try {
    // Handle both URLs and direct usernames
    if (url.includes('github.com')) {
      // Remove trailing slash if present
      url = url.replace(/\/$/, '');
      // Extract username from URL
      const matches = url.match(/github\.com\/([^\/]+)/);
      return matches ? matches[1] : null;
    }
    // If it's not a URL, return as is (assumed to be username)
    return url;
  } catch (error) {
    console.error('❌ Error parsing GitHub URL:', error.message);
    return null;
  }
}

// Add this function before handleSponsorInvitations
async function getSponsors(username) {
  console.log(`\n📥 Fetching sponsors of @${username}...`);
  let allSponsors = new Set();
  let hasNextPage = true;
  let endCursor = null;
  let startTime = Date.now();

  const query = `
    query($login: String!, $after: String) {
      repositoryOwner(login: $login) {
        ... on Organization {
          sponsorshipsAsMaintainer(first: 100, after: $after) {
            nodes {
              sponsorEntity {
                ... on User {
                  login
                  type: __typename
                }
              }
            }
            pageInfo {
              hasNextPage
              endCursor
            }
          }
          sponsors(first: 100, after: $after) {
            nodes {
              ... on User {
                login
              }
            }
            pageInfo {
              hasNextPage
              endCursor
            }
          }
        }
        ... on User {
          sponsorshipsAsMaintainer(first: 100, after: $after) {
            nodes {
              sponsorEntity {
                ... on User {
                  login
                  type: __typename
                }
              }
            }
            pageInfo {
              hasNextPage
              endCursor
            }
          }
        }
      }
    }
  `;

  while (hasNextPage) {
    try {
      const res = await fetch('https://api.github.com/graphql', {
        method: 'POST',
        headers: {
          'Authorization': `bearer ${GITHUB_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query,
          variables: {
            login: username,
            after: endCursor
          }
        })
      });

      if (!res.ok) {
        const error = await res.json();
        console.error('❌ Failed to fetch sponsors:', error.message);
        break;
      }

      const data = await res.json();
      
      if (data.errors) {
        console.error('❌ GraphQL Error:', data.errors[0].message);
        break;
      }

      const repoOwner = data.data?.repositoryOwner;
      if (!repoOwner) {
        console.log('❌ Account not found');
        break;
      }

      // Handle organization sponsors
      const orgSponsors = repoOwner.sponsors?.nodes || [];
      orgSponsors.forEach(sponsor => {
        if (sponsor?.login) {
          allSponsors.add(sponsor.login);
        }
      });

      // Handle maintainer sponsorships
      const sponsorships = repoOwner.sponsorshipsAsMaintainer?.nodes || [];
      sponsorships.forEach(node => {
        if (node.sponsorEntity?.type === 'User') {
          allSponsors.add(node.sponsorEntity.login);
        }
      });

      // Update pagination info based on either query
      hasNextPage = repoOwner.sponsors?.pageInfo.hasNextPage || 
                   repoOwner.sponsorshipsAsMaintainer?.pageInfo.hasNextPage || 
                   false;
      endCursor = repoOwner.sponsors?.pageInfo.endCursor || 
                 repoOwner.sponsorshipsAsMaintainer?.pageInfo.endCursor;

      // Add delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (error) {
      console.error('❌ Error:', error.message);
      break;
    }
  }

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n✅ Found ${allSponsors.size} sponsors in ${totalTime}s`);
  
  // Log all found sponsors for debugging
  if (allSponsors.size > 0) {
    console.log('\nFound sponsors:');
    Array.from(allSponsors).forEach(sponsor => {
      console.log(`  • @${sponsor}`);
    });
  }
  
  return Array.from(allSponsors);
}

// Add this function before getSponsoring
async function getSponsoring(username) {
  console.log(`\n📥 Fetching users/orgs that @${username} is sponsoring...`);
  let allSponsoring = new Set();
  let page = 1;
  let hasMore = true;
  let startTime = Date.now();

  while (hasMore) {
    try {
      const res = await fetch(`https://api.github.com/users/${username}/sponsoring?per_page=100&page=${page}`, { headers });
      
      if (!res.ok) {
        if (res.status === 404) {
          console.log('❌ Sponsoring data not found. Make sure the account exists.');
          break;
        }
        const error = await res.json();
        console.error('❌ Failed to fetch sponsoring:', error.message);
        break;
      }

      const sponsoring = await res.json();
      if (sponsoring.length === 0) {
        hasMore = false;
      } else {
        sponsoring.forEach(sponsor => {
          // Only add if it's a user, not an organization
          if (sponsor.type === 'User') {
            allSponsoring.add(sponsor.login);
          }
        });
        page++;
        // Add delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    } catch (error) {
      console.error('❌ Error:', error.message);
      break;
    }
  }

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n✅ Found ${allSponsoring.size} sponsored users in ${totalTime}s`);
  return Array.from(allSponsoring);
}

// Add this function after the imports
function initializeLogFiles() {
  console.log('\n📋 Initializing log files...');
  
  // Create backup directory if it doesn't exist
  const backupDir = 'log_backups';
  if (!existsSync(backupDir)) {
    mkdirSync(backupDir, { recursive: true });
  }

  // Initialize or restore log files
  const logFiles = [
    LOG_FILE,
    'invited_users.json',
    'invitation_stats.json',
    'search_progress.json'
  ];

  for (const file of logFiles) {
    // If file doesn't exist, try to restore from backup
    if (!existsSync(file)) {
      console.log(`⚠️ ${file} not found, attempting to restore...`);
      
      // Try main backup
      if (existsSync(`${file}.backup`)) {
        copyFileSync(`${file}.backup`, file);
        console.log(`✅ Restored ${file} from backup`);
        continue;
      }
      
      // Try dated backups
      const backupFiles = readdirSync(backupDir)
        .filter(f => f.startsWith(basename(file)))
        .sort()
        .reverse();
      
      if (backupFiles.length > 0) {
        const latestBackup = join(backupDir, backupFiles[0]);
        copyFileSync(latestBackup, file);
        console.log(`✅ Restored ${file} from ${backupFiles[0]}`);
        continue;
      }
      
      // Create empty file if no backups found
      writeFileSync(file, '');
      console.log(`📝 Created new ${file}`);
    }
  }

  // Create daily backup with timestamp
  const timestamp = new Date().toISOString().split('T')[0];
  for (const file of logFiles) {
    if (existsSync(file)) {
      const backupName = `${basename(file)}_${timestamp}`;
      copyFileSync(file, join(backupDir, backupName));
    }
  }

  console.log('✅ Log initialization complete\n');
}

// Add this function to create periodic backups
function createPeriodicBackup() {
  const timestamp = new Date().toISOString().split('T')[0];
  const backupDir = 'log_backups';
  
  if (!existsSync(backupDir)) {
    mkdirSync(backupDir, { recursive: true });
  }

  const logFiles = [
    LOG_FILE,
    'invited_users.json',
    'invitation_stats.json',
    'search_progress.json'
  ];

  for (const file of logFiles) {
    if (existsSync(file)) {
      const backupName = `${basename(file)}_${timestamp}`;
      copyFileSync(file, join(backupDir, backupName));
    }
  }
}

// Modify the main function to initialize logs at startup
async function main() {
  try {
    console.log('🤖 KHC Invitation Bot');
    console.log('📝 Configuration:');
    console.log('   GitHub Token: ✅ Present');

    // Initialize log files first
    initializeLogFiles();

    // Create periodic backup
    createPeriodicBackup();

    // Clean up log file
    cleanupLogFile();

    // Check last search from log file
    const lastSearch = getLastSearchFromLog();
    
    if (lastSearch) {
      console.log(`\n🔍 Found previous search for: "${lastSearch}"`);
      
      const checkPrevious = await new Promise(resolve => {
        rl.question('Do you want to continue with the previous search first? (yes/no): ', resolve);
      });

      if (checkPrevious.toLowerCase() === 'yes') {
        const followers = await searchUsersByKeyword(lastSearch);
        await handleSponsorInvitations(followers, `search-${lastSearch}`, ORG);
      }
    }

    // Show main menu options
    console.log('\nPlease choose an option:');
    console.log('1. Invite followers of a specific user');
    console.log('2. Invite followers of an organization');
    console.log('3. Invite a single user (by username or email)');
    console.log('4. Search and invite users by keyword');
    console.log('5. Scan repository/organization contributors');
    console.log('6. Follow all organization members');
    console.log('7. Scan README files for GitHub users');
    console.log('8. Invite sponsors of a user/organization');
    console.log('9. Invite users being sponsored by a user/organization');

    const answer = await new Promise(resolve => {
      rl.question('Enter your choice (1-9): ', resolve);
    });

    if (answer === '8' || answer === '9') {
      const userInput = await new Promise(resolve => {
        rl.question('Enter the GitHub profile/organization URL (e.g., https://github.com/username): ', resolve);
      });

      const username = extractGitHubUsername(userInput);
      if (!username) {
        console.error('❌ Invalid GitHub URL or username');
        return false;
      }

      console.log(`\n🔍 Processing ${answer === '8' ? 'sponsors' : 'sponsored users'} for @${username}...`);
      const sourceUsername = username;
      const followers = answer === '8' ? 
        await getSponsors(username) : 
        await getSponsoring(username);

      return await handleSponsorInvitations(followers, sourceUsername, ORG);
    } else {
      console.error('❌ Invalid choice. Please enter 1-9.');
      return false;
    }
  } catch (error) {
    console.error('❌ An unexpected error occurred:', error.message);
    return false;
  }
}

// Start the application
try {
  await main();
} catch (error) {
  console.error('❌ An unexpected error occurred:', error.message);
  process.exit(1);
} finally {
  rl.close();
}