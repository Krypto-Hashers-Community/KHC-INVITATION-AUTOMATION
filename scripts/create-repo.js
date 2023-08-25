import fetch from 'node-fetch';
import 'dotenv/config';

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

if (!GITHUB_TOKEN) {
  console.error('❌ Please set GITHUB_TOKEN environment variable');
  console.error('1. Go to https://github.com/settings/tokens');
  console.error('2. Generate a new token with "repo" scope');
  console.error('3. Create a .env file and add: GITHUB_TOKEN=your_token_here');
  process.exit(1);
}

async function createRepo() {
  const response = await fetch('https://api.github.com/user/repos', {
    method: 'POST',
    headers: {
      'Authorization': `token ${GITHUB_TOKEN}`,
      'Accept': 'application/vnd.github+json'
    },
    body: JSON.stringify({
      name: 'KHC-INVITATION-AUTOMATION',
      description: 'Automatically invite GitHub followers to your organization',
      private: false,
      has_issues: true,
      has_wiki: true,
      auto_init: false
    })
  });

  if (response.ok) {
    const data = await response.json();
    console.log('✅ Repository created successfully!');
    console.log(`🔗 ${data.html_url}`);
    return data;
  } else {
    const error = await response.json();
    console.error('❌ Failed to create repository:', error.message);
    process.exit(1);
  }
}

createRepo(); 