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
  console.log(`📥 Fetching followers of @${username}...`);
  let allFollowers = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const res = await fetch(`https://api.github.com/users/${username}/followers?per_page=100&page=${page}`, { headers });
    
    if (!res.ok) {
      const error = await res.json();
      console.error('❌ Failed to fetch followers:', error.message);
      process.exit(1);
    }

    const followers = await res.json();
    allFollowers = allFollowers.concat(followers.map(user => user.login));
    
    // Check if there are more pages
    const linkHeader = res.headers.get('link');
    if (!linkHeader || !linkHeader.includes('rel="next"')) {
      hasMore = false;
    } else {
      page++;
    }
  }

  console.log(`✅ Found ${allFollowers.length} followers`);
  return allFollowers;
}

async function getOrgFollowers(orgName) {
  console.log(`🔍 Fetching followers and members of ${orgName}...`);
  let allUsers = new Set();
  
  // Get all organization members (including admins) with pagination
  console.log('📥 Fetching organization members and admins...');
  let page = 1;
  let hasMore = true;
  while (hasMore) {
    const membersRes = await fetch(`https://api.github.com/orgs/${orgName}/members?per_page=100&page=${page}&role=all`, { headers });
    if (!membersRes.ok) {
      const error = await membersRes.json();
      console.error('❌ Failed to fetch org members:', error.message);
      break;
    }
    const members = await membersRes.json();
    if (members.length === 0) {
      hasMore = false;
    } else {
      members.forEach(member => allUsers.add(member.login));
      page++;
    }
    // Add delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  // Get organization followers with pagination
  console.log('📥 Fetching organization followers...');
  page = 1;
  hasMore = true;
  while (hasMore) {
    const followersRes = await fetch(`https://api.github.com/orgs/${orgName}/followers?per_page=100&page=${page}`, { headers });
    if (followersRes.ok) {
      const followers = await followersRes.json();
      if (followers.length === 0) {
        hasMore = false;
      } else {
        followers.forEach(user => allUsers.add(user.login));
        page++;
      }
    } else {
      hasMore = false;
    }
    // Add delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  // Then get the organization's repositories with pagination
  console.log('📥 Fetching repository stargazers and watchers...');
  page = 1;
  hasMore = true;
  const repos = new Set();
  
  while (hasMore) {
    const reposRes = await fetch(`https://api.github.com/orgs/${orgName}/repos?per_page=100&page=${page}`, { headers });
    if (!reposRes.ok) {
      const error = await reposRes.json();
      console.error('❌ Failed to fetch org repos:', error.message);
      break;
    }
    const reposList = await reposRes.json();
    if (reposList.length === 0) {
      hasMore = false;
    } else {
      reposList.forEach(repo => repos.add(repo.name));
      page++;
    }
    // Add delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  // Get stargazers and watchers from all repositories
  for (const repo of repos) {
    // Get stargazers
    page = 1;
    hasMore = true;
    while (hasMore) {
      const starsRes = await fetch(`https://api.github.com/repos/${orgName}/${repo}/stargazers?per_page=100&page=${page}`, { headers });
      if (starsRes.ok) {
        const stargazers = await starsRes.json();
        if (stargazers.length === 0) {
          hasMore = false;
        } else {
          stargazers.forEach(user => allUsers.add(user.login));
          page++;
        }
      } else {
        hasMore = false;
      }
      // Add delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // Get watchers
    page = 1;
    hasMore = true;
    while (hasMore) {
      const watchersRes = await fetch(`https://api.github.com/repos/${orgName}/${repo}/subscribers?per_page=100&page=${page}`, { headers });
      if (watchersRes.ok) {
        const watchers = await watchersRes.json();
        if (watchers.length === 0) {
          hasMore = false;
        } else {
          watchers.forEach(user => allUsers.add(user.login));
          page++;
        }
      } else {
        hasMore = false;
      }
      // Add delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  const usersArray = Array.from(allUsers);
  console.log(`✅ Found ${usersArray.length} total users (members, admins, followers, stargazers, and watchers)`);
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
      // Update stats
      invitationStats.totalInvites++;
      invitationStats.last24Hours++;
      invitationStats.lastInviteTime = Date.now();
      invitationStats.pendingInvites++;
      updateStats();
      
      // Log the invitation
      const logEntry = `${sourceUsername} - ${username}\n`;
      fs.appendFileSync(LOG_FILE, logEntry);
      return true;
    } else {
      const err = await res.json();
      if (err.message.includes('rate limit')) {
        failedInvitesCount++;
        console.log(`❌ Failed to invite ${username}: Over invitation rate limit (Failed: ${failedInvitesCount}/${MAX_FAILED_INVITES})`);
        
        // If we've hit the maximum failed invites, commit and exit
        if (failedInvitesCount >= MAX_FAILED_INVITES) {
          console.log('\n⚠️ Reached maximum failed invites. Stopping and committing changes...');
          await commitAndPushChanges();
          process.exit(0);
        }
      } else {
        console.error(`❌ Failed to invite ${username}: ${err.message}`);
      }
      return false;
    }
  } catch (error) {
    console.error(`❌ Failed to invite ${username}: ${error.message}`);
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

async function searchUsersByKeyword(keyword, startFrom = 0, getAllUsers = false) {
  console.log(`🔍 Searching users with keyword: "${keyword}"...`);
  let allUsers = new Set(); // Using Set to avoid duplicates
  let totalProcessed = 0;

  // Optimized search strategies - focusing on most effective filters
  const searchStrategies = [
    // Strategy 1: Direct search with type:user
    async () => {
      const query = `${keyword} type:user`;
      await searchWithQuery(query, allUsers);
    },
    // Strategy 2: Search with language filters
    async () => {
      const languages = ['javascript', 'python', 'java', 'cpp', 'typescript'];
      for (const lang of languages) {
        const query = `${keyword} language:${lang} type:user`;
        await searchWithQuery(query, allUsers);
      }
    },
    // Strategy 3: Search by repositories
    async () => {
      const query = `${keyword} repos:>0 type:user`;
      await searchWithQuery(query, allUsers);
    }
  ];

  async function searchWithQuery(query, userSet) {
    let page = 1;
    let hasMore = true;
    let retryCount = 0;
    const maxRetries = 3;

    while (hasMore && page <= 10) { // Limit to 1000 results per query (10 pages * 100 results)
      try {
        const res = await fetch(
          `https://api.github.com/search/users?q=${encodeURIComponent(query)}&per_page=100&page=${page}`,
          { headers }
        );
        
        if (!res.ok) {
          const error = await res.json();
          if (error.message.includes('rate limit')) {
            if (retryCount < maxRetries) {
              retryCount++;
              console.log('\n⚠️ Hit rate limit. Retrying in 10 seconds...');
              await new Promise(resolve => setTimeout(resolve, 10000));
              continue;
            } else {
              console.log('\n⚠️ Skipping after maximum retries');
              break;
            }
          }
          if (error.message.includes('Only the first 1000 search results are available')) {
            break;
          }
          console.error(`❌ Search failed: ${error.message}`);
          break;
        }

        const data = await res.json();
        const users = data.items.map(user => user.login);
        const initialSize = userSet.size;
        users.forEach(user => userSet.add(user));
        
        // Show progress only if new users were added
        if (userSet.size > initialSize) {
          totalProcessed = userSet.size;
          process.stdout.write(`\r📥 Found ${totalProcessed} unique users...`);
        }

        // Check if we should continue
        if (!data.items.length || page * 100 >= 1000) {
          hasMore = false;
        } else {
          page++;
          // Smaller delay between requests
          await new Promise(resolve => setTimeout(resolve, 500));
        }

        retryCount = 0; // Reset retry count on successful request
      } catch (error) {
        console.error('❌ Error:', error.message);
        break;
      }
    }
  }

  for (const [index, strategy] of searchStrategies.entries()) {
    await strategy();
    // Don't continue with other strategies if we already found enough users
    if (allUsers.size >= 1000) break;
  }

  const usersArray = Array.from(allUsers);
  console.log(`\n✅ Found ${usersArray.length} unique users matching "${keyword}"`);

  // Update search progress
  searchProgress = {
    lastSearch: keyword,
    completedCount: startFrom + usersArray.length,
    totalCount: usersArray.length,
    remainingUsers: usersArray
  };
  updateSearchProgress();

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

async function followAllOrgMembers() {
  console.log('\n🔍 Fetching all organization members...');
  
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
  
  let successCount = 0;
  for (const member of currentMembers) {
    if (await followUser(member)) {
      successCount++;
    }
    // Add delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  console.log(`\n✨ Successfully followed ${successCount} members`);
  
  // Update the members list
  updateMembersList(currentMembers);
}

async function saveUsersToFile(users, sourceType, keyword) {
  // Create users_data directory if it doesn't exist
  if (!fs.existsSync(USERS_DATA_DIR)) {
    fs.mkdirSync(USERS_DATA_DIR);
  }

  // Generate filename based on source and date
  const date = new Date().toISOString().split('T')[0];
  const filename = `${sourceType}_${keyword}_${date}.json`.replace(/[^a-zA-Z0-9-_\.]/g, '_');
  const filepath = path.join(USERS_DATA_DIR, filename);

  // Initialize file with header information
  const fileHeader = {
    source_type: sourceType,
    keyword: keyword,
    date: date,
    total_users: users.length,
    users: []
  };
  fs.writeFileSync(filepath, JSON.stringify(fileHeader, null, 2));

  // Fetch and save user information in batches
  console.log('\n📥 Fetching detailed information for users...');
  const batchSize = 100;
  let processedCount = 0;
  let retryCount = 0;
  const maxRetries = 3;

  for (let i = 0; i < users.length; i += batchSize) {
    const batch = users.slice(i, i + batchSize);
    const batchData = [];

    for (const username of batch) {
      try {
        processedCount++;
        process.stdout.write(`\r🔍 Processing user ${processedCount}/${users.length}: @${username}`);
        
        const res = await fetch(`https://api.github.com/users/${username}`, { headers });
        if (res.ok) {
          const userData = await res.json();
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
          retryCount = 0; // Reset retry count on success
        } else if (res.status === 403 && retryCount < maxRetries) {
          // Rate limit hit, wait and retry
          retryCount++;
          console.log('\n⚠️ Rate limit hit. Waiting 60 seconds...');
          await new Promise(resolve => setTimeout(resolve, 60000));
          i--; // Retry this user
          continue;
        }
        // Add delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error) {
        console.error(`\n❌ Error fetching data for ${username}:`, error.message);
      }
    }

    // Append batch data to file
    const currentData = JSON.parse(fs.readFileSync(filepath, 'utf8'));
    currentData.users = currentData.users.concat(batchData);
    fs.writeFileSync(filepath, JSON.stringify(currentData, null, 2));
  }

  // Clear the processing line
  process.stdout.write('\r' + ' '.repeat(100) + '\r');
  console.log(`\n✅ Saved ${processedCount} users' information to ${filepath}`);
  return filepath;
}

async function main() {
  try {
    console.log('🤖 KHC Invitation Bot');
    console.log('📝 Configuration:');
    console.log('   GitHub Token: ✅ Present');

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

    // Load previously invited users
    const previouslyInvited = getPreviouslyInvitedUsers();
    console.log(`📋 Previously invited users: ${previouslyInvited.size}`);

    // Check last search from log file
    const logContent = fs.readFileSync(LOG_FILE, 'utf8');
    const lastSearchLine = logContent.split('\n').reverse().find(line => line.includes('search-'));
    
    if (lastSearchLine) {
      const lastSearch = lastSearchLine.split(' - ')[0].replace('search-', '');
      console.log(`\n🔍 Checking last search: "${lastSearch}"`);
      
      const followers = await searchUsersByKeyword(lastSearch);
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
          console.log(`📝 Invitation log has been updated in ${LOG_FILE}`);
          console.log(`📊 Stats have been saved to ${INVITATION_STATS_FILE}`);

          // After successful invites in any option, follow new members
          if (successfulInvites > 0) {
            console.log('\n👥 Following organization members...');
            await followAllOrgMembers();
          }
        } else {
          console.log('❌ Invitation process cancelled.');
        }
      } else {
        console.log('✨ No new followers found from last search!');
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
      const keyword = await new Promise(resolve => {
        rl.question('Enter search keyword (e.g., "SRM University"): ', resolve);
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