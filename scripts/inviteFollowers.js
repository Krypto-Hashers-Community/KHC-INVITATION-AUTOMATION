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

async function getOrgFollowers() {
  console.log(`📥 Fetching followers of ${ORG}...`);
  // First get the organization's members
  const membersRes = await fetch(`https://api.github.com/orgs/${ORG}/members?per_page=100`, { headers });
  if (!membersRes.ok) {
    const error = await membersRes.json();
    console.error('❌ Failed to fetch org members:', error.message);
    process.exit(1);
  }
  const members = await membersRes.json();
  
  // Then get the organization's repositories
  const reposRes = await fetch(`https://api.github.com/orgs/${ORG}/repos?per_page=100`, { headers });
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
      const starsRes = await fetch(`https://api.github.com/repos/${ORG}/${repo.name}/stargazers?per_page=100&page=${page}`, { headers });
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

async function getOrgMembers() {
  console.log(`📥 Fetching members of ${ORG}...`);
  const res = await fetch(`https://api.github.com/orgs/${ORG}/members`, { headers });
  
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

async function inviteUser(username, sourceUsername) {
  if (!canSendMoreInvites()) {
    console.log(`⚠️ Reached daily invitation limit (50). Please try again tomorrow.`);
    return false;
  }

  console.log(`📨 Inviting @${username} to ${ORG}...`);
  const res = await fetch(`https://api.github.com/orgs/${ORG}/invitations`, {
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

async function main() {
  try {
    console.log('🤖 KHC Invitation Bot');
    console.log('📝 Configuration:');
    console.log(`   Organization: ${ORG}`);
    console.log('   GitHub Token: ✅ Present');
    console.log('\n📊 Current Stats:');
    console.log(`   Total Invites Sent: ${invitationStats.totalInvites}`);
    console.log(`   Invites in Last 24h: ${invitationStats.last24Hours}`);
    console.log(`   Pending Invites: ${invitationStats.pendingInvites}\n`);

    console.log('Please choose an option:');
    console.log('1. Invite followers of a specific user');
    console.log('2. Invite followers of the organization');

    const answer = await new Promise(resolve => {
      rl.question('Enter your choice (1 or 2): ', resolve);
    });

    let followers;
    let sourceUsername;
    if (answer === '1') {
      sourceUsername = await new Promise(resolve => {
        rl.question('Enter the GitHub username: ', resolve);
      });
      followers = await getFollowers(sourceUsername);
    } else if (answer === '2') {
      sourceUsername = ORG;
      followers = await getOrgFollowers();
    } else {
      console.error('❌ Invalid choice. Please enter 1 or 2.');
      process.exit(1);
    }

    const members = await getOrgMembers();
    const newFollowers = followers.filter(user => !members.includes(user));
    
    if (newFollowers.length === 0) {
      console.log('✨ No new followers to invite!');
      return;
    }

    console.log(`\n🎯 Found ${newFollowers.length} followers to invite:`);
    for (const user of newFollowers) {
      console.log(`   • @${user}`);
    }

    const confirm = await new Promise(resolve => {
      rl.question('\nDo you want to proceed with sending invites? (yes/no): ', resolve);
    });

    if (confirm.toLowerCase() !== 'yes') {
      console.log('❌ Invitation process cancelled.');
      return;
    }

    let successfulInvites = 0;
    for (const user of newFollowers) {
      if (await inviteUser(user, sourceUsername)) {
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