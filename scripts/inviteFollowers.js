// scripts/inviteFollowers.js
import fetch from 'node-fetch';
import 'dotenv/config';
import readline from 'readline';
import fs from 'fs';
import path from 'path';

const ORG = 'Krypto-Hashers-Community';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const LOG_FILE = 'invitation_log.txt';
const INVITATION_STATS_FILE = 'invitation_stats.json';
const DELAY_BETWEEN_INVITES = 2000; // 2 seconds delay between invites
const SEARCH_PROGRESS_FILE = 'search_progress.json';

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
  console.log(`📥 Fetching followers of ${orgName}...`);
  // First get the organization's members
  const membersRes = await fetch(`https://api.github.com/orgs/${orgName}/members?per_page=100`, { headers });
  if (!membersRes.ok) {
    const error = await membersRes.json();
    console.error('❌ Failed to fetch org members:', error.message);
    process.exit(1);
  }
  const members = await membersRes.json();
  
  // Then get the organization's repositories
  const reposRes = await fetch(`https://api.github.com/orgs/${orgName}/repos?per_page=100`, { headers });
  if (!reposRes.ok) {
    const error = await reposRes.json();
    console.error('❌ Failed to fetch org repos:', error.message);
    process.exit(1);
  }
  const repos = await reposRes.json();
  
  // Get stargazers from all repositories
  let followers = new Set();
  for (const repo of repos) {
    let page = 1;
    let hasMore = true;
    
    while (hasMore) {
      const starsRes = await fetch(`https://api.github.com/repos/${orgName}/${repo.name}/stargazers?per_page=100&page=${page}`, { headers });
      if (starsRes.ok) {
        const stargazers = await starsRes.json();
        stargazers.forEach(user => followers.add(user.login));
        
        // Check if there are more pages
        const linkHeader = starsRes.headers.get('link');
        if (!linkHeader || !linkHeader.includes('rel="next"')) {
          hasMore = false;
        } else {
          page++;
        }
      } else {
        hasMore = false;
      }
    }
  }
  
  // Convert Set to Array and filter out members
  const followersArray = Array.from(followers).filter(user => 
    !members.some(member => member.login === user)
  );
  
  console.log(`✅ Found ${followersArray.length} potential followers`);
  return followersArray;
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
  const res = await fetch(`https://api.github.com/users/${username}`, { headers });
  
  if (!res.ok) {
    const error = await res.json();
    console.error(`❌ Failed to fetch user ID for ${username}:`, error.message);
    process.exit(1);
  }

  const data = await res.json();
  return data.id;
}

async function inviteUser(username, sourceUsername, targetOrg, forceInvite = false) {
  if (!forceInvite && !canSendMoreInvites()) {
    console.log(`⚠️ Reached daily invitation limit (50). Use force option to bypass this limit.`);
    return false;
  }

  console.log(`📨 Inviting @${username} to ${targetOrg}...`);
  const res = await fetch(`https://api.github.com/orgs/${targetOrg}/invitations`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ invitee_id: await getUserId(username) })
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
    console.error(`❌ Failed to invite ${username}:`, err.message);
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

async function searchUsersByKeyword(keyword, startFrom = 0) {
  console.log(`🔍 Searching users with keyword: "${keyword}"...`);
  let allUsers = [];
  let page = 1;
  let hasMore = true;
  let totalCount = 0;

  // First get total count
  const initialRes = await fetch(
    `https://api.github.com/search/users?q=${encodeURIComponent(keyword)}&per_page=1`,
    { headers }
  );
  
  if (!initialRes.ok) {
    const error = await initialRes.json();
    console.error('❌ Failed to search users:', error.message);
    process.exit(1);
  }

  const initialData = await initialRes.json();
  totalCount = initialData.total_count;
  
  // Calculate starting page based on startFrom
  page = Math.floor(startFrom / 100) + 1;
  const skipCount = startFrom % 100;

  console.log(`📊 Total users found: ${totalCount}`);
  console.log(`📈 Starting from position: ${startFrom + 1}`);

  while (hasMore && allUsers.length < 500) {
    const res = await fetch(
      `https://api.github.com/search/users?q=${encodeURIComponent(keyword)}&per_page=100&page=${page}`,
      { headers }
    );
    
    if (!res.ok) {
      const error = await res.json();
      console.error('❌ Failed to search users:', error.message);
      process.exit(1);
    }

    const data = await res.json();
    let users = data.items.map(user => user.login);
    
    // Skip already processed users
    if (skipCount > 0 && page === Math.floor(startFrom / 100) + 1) {
      users = users.slice(skipCount);
    }
    
    allUsers = allUsers.concat(users);
    
    // Check if we've reached the limit or end of results
    if (allUsers.length >= 500 || !data.items.length) {
      hasMore = false;
    } else {
      // Check if there are more pages
      const linkHeader = res.headers.get('link');
      if (!linkHeader || !linkHeader.includes('rel="next"')) {
        hasMore = false;
      } else {
        page++;
      }
    }
  }

  // Update search progress
  searchProgress = {
    lastSearch: keyword,
    completedCount: startFrom + allUsers.length,
    totalCount: totalCount,
    remainingUsers: allUsers
  };
  updateSearchProgress();

  console.log(`✅ Found ${allUsers.length} users matching "${keyword}"`);
  return allUsers;
}

async function main() {
  try {
    console.log('🤖 KHC Invitation Bot');
    console.log('📝 Configuration:');
    console.log('   GitHub Token: ✅ Present');
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

    const answer = await new Promise(resolve => {
      rl.question('Enter your choice (1, 2, 3 or 4): ', resolve);
    });

    let followers;
    let sourceUsername;
    let targetOrg = ORG;

    if (answer === '1') {
      sourceUsername = await new Promise(resolve => {
        rl.question('Enter the GitHub username: ', resolve);
      });
      followers = await getFollowers(sourceUsername);
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
        targetOrg = orgName;
      }
      
      sourceUsername = targetOrg;
      followers = await getOrgFollowers(targetOrg);
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
      
      sourceUsername = `search-${keyword}`;
      followers = await searchUsersByKeyword(keyword);
    } else {
      console.error('❌ Invalid choice. Please enter 1, 2, 3, or 4.');
      process.exit(1);
    }

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
  } catch (error) {
    console.error('❌ An unexpected error occurred:', error.message);
    process.exit(1);
  } finally {
    rl.close();
  }
}

main();