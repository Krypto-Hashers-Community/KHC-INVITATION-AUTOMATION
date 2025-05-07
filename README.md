# GitHub Organization Invitation Manager

A robust system for managing GitHub organization invitations with duplicate prevention, tracking, and statistics.

## Features

- ✅ Prevents duplicate invitations
- 📊 Tracks invitation statistics
- 🔍 Supports various search terms
- 📈 Provides detailed reporting
- ⚡ Rate limit handling
- 🔄 Persistent storage of invited users

## Setup

1. Install dependencies:
```bash
npm install
```

2. Set up environment variables:
```bash
export GITHUB_TOKEN="your-github-token"
export GITHUB_ORG="your-organization-name"
```

## Usage

### Inviting Users

To invite users based on a search term:
```bash
npm run invite "search-term" [max-invites]
```

Examples:
```bash
# Invite up to 50 users matching "IIT"
npm run invite "search-IIT"

# Invite up to 100 users from Germany
npm run invite "location:Germany" 100
```

### Viewing Statistics

To view invitation statistics:
```bash
npm run stats
```

This will show:
- Total invites sent
- Unique users invited
- Breakdown by search term
- Last invitation timestamp

## Data Storage

The system maintains two JSON files in the `data` directory:
- `invited_users.json`: Tracks all invited users to prevent duplicates
- `invitation_stats.json`: Stores invitation statistics and metrics

## Search Terms

You can use various GitHub search qualifiers:
- `location:Country`
- `language:JavaScript`
- `followers:>100`
- `created:>2020-01-01`

## Rate Limiting

The system includes built-in rate limiting:
- 1-second delay between invitations
- Maximum invites per run can be specified
- Respects GitHub API rate limits

## Troubleshooting

If you encounter issues:
1. Ensure your GitHub token has the required permissions
2. Check the `data` directory exists and is writable
3. Verify your organization name is correct
4. Check GitHub API rate limits 