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

async function testConfiguration() {
  try {
    console.log('🔍 Testing GitHub configuration...\n');

    // Test 1: Check authentication
    console.log('Test 1: Checking authentication...');
    const authRes = await fetch('https://api.github.com/user', { headers });
    const userData = await authRes.json();
    
    if (!authRes.ok) {
      throw new Error(userData.message);
    }
    
    console.log('✅ Authenticated as:', userData.login);
    console.log('Token has access to:', userData.scopes || 'unknown scopes');
    console.log();

    // Test 2: Check organization access
    console.log('Test 2: Checking organization access...');
    const orgRes = await fetch('https://api.github.com/user/orgs', { headers });
    const orgs = await orgRes.json();
    
    if (!orgRes.ok) {
      throw new Error(orgs.message);
    }
    
    console.log('✅ You have access to these organizations:');
    orgs.forEach(org => console.log(`   • ${org.login}`));
    console.log();

    // Test 3: Check rate limits
    console.log('Test 3: Checking API rate limits...');
    const rateRes = await fetch('https://api.github.com/rate_limit', { headers });
    const rateData = await rateRes.json();
    
    if (!rateRes.ok) {
      throw new Error(rateData.message);
    }
    
    console.log('✅ Rate limits:');
    console.log(`   • ${rateData.rate.remaining}/${rateData.rate.limit} requests remaining`);
    console.log(`   • Resets at: ${new Date(rateData.rate.reset * 1000).toLocaleString()}`);

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  }
}

testConfiguration(); 