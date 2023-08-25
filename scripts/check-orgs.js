import fetch from 'node-fetch';
import 'dotenv/config';

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

if (!GITHUB_TOKEN) {
  console.error('❌ Error: GITHUB_TOKEN not found in environment');
  process.exit(1);
}

const headers = {
  Authorization: `token ${GITHUB_TOKEN}`,
  Accept: 'application/vnd.github+json',
};

async function checkOrgs() {
  try {
    console.log('🔍 Checking your organizations...\n');
    const res = await fetch('https://api.github.com/user/orgs', { headers });
    const orgs = await res.json();
    
    if (!res.ok) {
      throw new Error(orgs.message);
    }
    
    console.log('✅ You have access to these organizations:');
    orgs.forEach(org => console.log(`   • ${org.login}`));
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

checkOrgs(); 