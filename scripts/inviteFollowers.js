// scripts/inviteFollowers.js
import fetch from 'node-fetch';
import 'dotenv/config';
import readline from 'readline';
import fs from 'fs';
import path from 'path';

const ORG = 'Krypto-Hashers-Community';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const LOG_FILE = 'invitation_log.txt';

// Ensure log file exists
if (!fs.existsSync(LOG_FILE)) {
  fs.writeFileSync(LOG_FILE, '');
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
  console.log(`📨 Inviting @${username} to ${ORG}...`);
  const res = await fetch(`https://api.github.com/orgs/${ORG}/invitations`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ invitee_id: await getUserId(username) })
  });

  if (res.ok) {
    console.log(`✅ Successfully invited @${username}`);
    // Log the invitation
    const logEntry = `${sourceUsername} - ${username}\n`;
    fs.appendFileSync(LOG_FILE, logEntry);
  } else {
    const err = await res.json();
    console.error(`❌ Failed to invite ${username}:`, err.message);
  }
}

async function main() {
  try {
    console.log('🤖 KHC Invitation Bot');
    console.log('📝 Configuration:');
    console.log(`   Organization: ${ORG}`);
    console.log('   GitHub Token: ✅ Present\n');

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

    for (const user of newFollowers) {
      await inviteUser(user, sourceUsername);
    }

    console.log('\n✨ All done! Check your GitHub organization for pending invites.');
    console.log(`📝 Invitation log has been updated in ${LOG_FILE}`);
  } catch (error) {
    console.error('❌ An unexpected error occurred:', error.message);
    process.exit(1);
  } finally {
    rl.close();
  }
}

main();