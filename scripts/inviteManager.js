const { Octokit } = require('@octokit/rest');
const fs = require('fs').promises;
const path = require('path');
const simpleGit = require('simple-git');
const { execSync } = require('child_process');

// Add dotenv support
try {
    require('dotenv').config();
} catch (error) {
    // dotenv is optional
}

class InviteManager {
    constructor(config) {
        this.octokit = new Octokit({ auth: config.githubToken });
        this.organization = config.organization;
        this.invitedUsersPath = path.join(__dirname, '..', 'data', 'invited_users.json');
        this.statsPath = path.join(__dirname, '..', 'data', 'invitation_stats.json');
        this.logsPath = path.join(__dirname, '..', 'logs');
        this.terminalLogPath = path.join(__dirname, '..', 'logs', 'terminal-output.log');
        this.invitedUsers = new Set();
        this.stats = {
            totalInvites: 0,
            searchTerms: {},
            lastInvitedAt: null
        };
        this.sessionStartTime = new Date().toISOString();
    }

    async initialize() {
        // Create necessary directories
        await fs.mkdir(path.join(__dirname, '..', 'data'), { recursive: true });
        await fs.mkdir(this.logsPath, { recursive: true });

        // Load existing data
        try {
            const data = await fs.readFile(this.invitedUsersPath, 'utf8');
            const { users } = JSON.parse(data);
            users.forEach(user => this.invitedUsers.add(user));
        } catch (error) {
            await this.saveInvitedUsers();
        }

        try {
            const data = await fs.readFile(this.statsPath, 'utf8');
            this.stats = JSON.parse(data);
        } catch (error) {
            await this.saveStats();
        }

        // Initialize today's log file
        this.currentLogFile = path.join(this.logsPath, `invites-${new Date().toISOString().split('T')[0]}.log`);
        
        // Log session start
        await this.log('SESSION', 'Session started', { timestamp: this.sessionStartTime });
        
        // Capture terminal output
        this.startTerminalLogging();
    }

    startTerminalLogging() {
        // Create write stream for terminal output
        this.terminalStream = fs.createWriteStream(this.terminalLogPath, { flags: 'a' });
        process.stdout.write = new Proxy(process.stdout.write, {
            apply: (target, thisArg, args) => {
                this.terminalStream.write(args[0]);
                return target.apply(thisArg, args);
            }
        });
    }

    async pushLogsToGitHub(message = '') {
        try {
            const git = simpleGit();
            const currentBranch = (await git.branch()).current;
            
            // Save current work if any
            if (currentBranch !== 'logs-only') {
                await git.stash(['save', 'Temporary stash before log commit']);
            }
            
            // Switch to logs-only branch
            try {
                await git.checkout('logs-only');
            } catch (error) {
                // If branch doesn't exist remotely, create it
                await git.checkoutLocalBranch('logs-only');
            }
            
            // Add only log files
            await git.add([
                path.join('logs', '*.log'),
                path.join('data', 'invitation_stats.json'),
                path.join('data', 'invited_users.json')
            ]);
            
            const timestamp = new Date().toISOString();
            const commitMessage = message || `[Automated] Log update at ${timestamp}`;
            await git.commit(commitMessage);
            await git.push('origin', 'logs-only', ['--set-upstream']);
            
            // Switch back to original branch if different
            if (currentBranch !== 'logs-only') {
                await git.checkout(currentBranch);
                try {
                    await git.stash(['pop']);
                } catch (error) {
                    // Ignore if no stash exists
                }
            }
            
            await this.log('GIT', 'Successfully pushed logs to GitHub');
        } catch (error) {
            await this.log('GIT_ERROR', 'Failed to push logs to GitHub', { error: error.message });
            console.error('Failed to push logs to GitHub:', error.message);
        }
    }

    async endSession() {
        const sessionEndTime = new Date().toISOString();
        await this.log('SESSION', 'Session ended', {
            startTime: this.sessionStartTime,
            endTime: sessionEndTime
        });
        
        // Push final logs
        await this.pushLogsToGitHub('[Automated] Session end log update');
    }

    async log(type, message, data = {}) {
        const timestamp = new Date().toISOString();
        const logEntry = {
            timestamp,
            type,
            message,
            ...data
        };

        const logLine = JSON.stringify(logEntry);
        await fs.appendFile(this.currentLogFile, logLine + '\n');

        // Also log to console
        console.log(`[${timestamp}] ${type}: ${message}`);
    }

    async saveInvitedUsers() {
        await fs.writeFile(
            this.invitedUsersPath,
            JSON.stringify({ users: Array.from(this.invitedUsers) }, null, 2)
        );
    }

    async saveStats() {
        await fs.writeFile(
            this.statsPath,
            JSON.stringify(this.stats, null, 2)
        );
    }

    async checkRateLimits() {
        try {
            const { data } = await this.octokit.rateLimit.get();
            await this.log('RATE_LIMIT', 'Current rate limits', {
                core: data.resources.core,
                search: data.resources.search
            });
            return data.resources;
        } catch (error) {
            await this.log('ERROR', 'Failed to check rate limits', { error: error.message });
            throw error;
        }
    }

    async searchUsers(searchTerm) {
        await this.log('SEARCH', `Searching users with term: ${searchTerm}`);
        
        const limits = await this.checkRateLimits();
        if (limits.search.remaining < 1) {
            const resetTime = new Date(limits.search.reset * 1000);
            await this.log('RATE_LIMIT_EXCEEDED', 'Search rate limit exceeded', { resetTime });
            throw new Error('Search rate limit exceeded');
        }

        const users = await this.octokit.search.users({
            q: searchTerm,
            per_page: 100
        });

        const filteredUsers = users.data.items.filter(user => !this.invitedUsers.has(user.login));
        await this.log('SEARCH_RESULTS', 'Found users', {
            total: users.data.items.length,
            new: filteredUsers.length
        });

        return filteredUsers;
    }

    async inviteUser(username, searchTerm) {
        await this.log('INVITE_ATTEMPT', `Attempting to invite user: ${username}`, { searchTerm });

        if (this.invitedUsers.has(username)) {
            await this.log('SKIP', `User ${username} was already invited`);
            return false;
        }

        try {
            const { data: user } = await this.octokit.users.getByUsername({ username });
            
            await this.octokit.orgs.createInvitation({
                org: this.organization,
                invitee_id: user.id,
                role: 'direct_member'
            });

            // Update tracking
            this.invitedUsers.add(username);
            await this.saveInvitedUsers();

            // Update stats
            this.stats.totalInvites++;
            this.stats.searchTerms[searchTerm] = (this.stats.searchTerms[searchTerm] || 0) + 1;
            this.stats.lastInvitedAt = new Date().toISOString();
            await this.saveStats();

            await this.log('INVITE_SUCCESS', `Successfully invited ${username}`, {
                userId: user.id,
                searchTerm
            });
            return true;
        } catch (error) {
            await this.log('INVITE_ERROR', `Failed to invite ${username}`, {
                error: error.message,
                searchTerm
            });
            return false;
        }
    }

    async getStats() {
        const stats = {
            totalInvites: this.stats.totalInvites,
            searchTermStats: this.stats.searchTerms,
            lastInvitedAt: this.stats.lastInvitedAt,
            totalUniqueInvites: this.invitedUsers.size
        };

        await this.log('STATS', 'Retrieved statistics', stats);
        return stats;
    }

    async getLogs(days = 7) {
        const logFiles = await fs.readdir(this.logsPath);
        const recentLogs = {};

        for (const file of logFiles) {
            const date = file.split('invites-')[1].split('.log')[0];
            const fileDate = new Date(date);
            const now = new Date();
            const diffTime = Math.abs(now - fileDate);
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

            if (diffDays <= days) {
                const content = await fs.readFile(path.join(this.logsPath, file), 'utf8');
                recentLogs[date] = content.split('\n')
                    .filter(line => line.trim())
                    .map(line => JSON.parse(line));
            }
        }

        return recentLogs;
    }

    async inviteUsers(searchTerm, maxInvites = 50) {
        // Check rate limits before starting
        await this.checkRateLimits();

        console.log(`Searching users with term: ${searchTerm}`);
        const users = await this.searchUsers(searchTerm);
        console.log(`Found ${users.length} new users to invite`);

        let invitedCount = 0;
        for (const user of users) {
            if (invitedCount >= maxInvites) {
                console.log(`Reached maximum invites limit (${maxInvites})`);
                break;
            }

            try {
                const invited = await this.inviteUser(user.login, searchTerm);
                if (invited) invitedCount++;

                // Add longer delay between invites to respect rate limits
                await new Promise(resolve => setTimeout(resolve, 2000));
            } catch (error) {
                if (error.message.includes('rate limit')) {
                    console.log('\nPausing due to rate limits...');
                    break;
                }
                console.error(`Error inviting ${user.login}:`, error.message);
            }
        }

        // Final rate limit check
        await this.checkRateLimits();

        // After invitations are done, push logs
        await this.pushLogsToGitHub(`[Automated] Invitation logs for "${searchTerm}"`);
        
        console.log(`\nInvitation Summary for "${searchTerm}":`);
        console.log(`- Users invited: ${invitedCount}`);
        console.log(`- Total unique invites: ${this.invitedUsers.size}`);
        
        return invitedCount;
    }
}

// Modify the main function to handle session end
async function main() {
    const config = {
        githubToken: process.env.GITHUB_TOKEN,
        organization: process.env.GITHUB_ORG
    };

    if (!config.githubToken || !config.organization) {
        console.error('\nError: Missing required environment variables!\n');
        console.error('Please set up your environment variables using one of these methods:\n');
        console.error('1. Export them in your shell:');
        console.error('   export GITHUB_TOKEN="your_github_token"');
        console.error('   export GITHUB_ORG="your_organization_name"\n');
        console.error('2. Or create a .env file with:');
        console.error('   GITHUB_TOKEN=your_github_token');
        console.error('   GITHUB_ORG=your_organization_name\n');
        console.error('Note: Get your GitHub token from https://github.com/settings/tokens');
        console.error('      Token needs "admin:org" permission to invite users\n');
        process.exit(1);
    }

    const manager = new InviteManager(config);
    await manager.initialize();

    try {
        const command = process.argv[2];
        const searchTerm = process.argv[3];
        const maxInvites = parseInt(process.argv[4]) || 50;

        switch (command) {
            case 'invite':
                if (!searchTerm) {
                    console.error('Error: Search term is required');
                    console.log('Usage: node inviteManager.js invite <search-term> [max-invites]');
                    process.exit(1);
                }
                await manager.inviteUsers(searchTerm, maxInvites);
                break;

            case 'stats':
                const stats = await manager.getStats();
                console.log('\nInvitation Statistics:');
                console.log('====================');
                console.log(`Total Invites Sent: ${stats.totalInvites}`);
                console.log(`Unique Users Invited: ${stats.totalUniqueInvites}`);
                console.log('\nSearch Term Statistics:');
                Object.entries(stats.searchTermStats).forEach(([term, count]) => {
                    console.log(`- ${term}: ${count} invites`);
                });
                console.log(`\nLast Invitation: ${stats.lastInvitedAt || 'Never'}`);
                break;

            case 'logs':
                const logs = await manager.getLogs();
                console.log('\nRecent Logs:');
                console.log('====================');
                Object.entries(logs).forEach(([date, entries]) => {
                    console.log(`\n${date}:`);
                    entries.forEach(entry => {
                        console.log(`- ${entry.timestamp}: ${entry.type} - ${entry.message}`);
                        if (entry.data) {
                            console.log('  Data:', entry.data);
                        }
                    });
                });
                break;

            default:
                console.log('Usage:');
                console.log('  node inviteManager.js invite <search-term> [max-invites]');
                console.log('  node inviteManager.js stats');
                console.log('  node inviteManager.js logs');
                process.exit(1);
        }

        // Ensure session is properly ended
        await manager.endSession();
    } catch (error) {
        console.error('Error:', error.message);
        // Ensure logs are pushed even on error
        await manager.endSession();
        process.exit(1);
    }
}

if (require.main === module) {
    main().catch(error => {
        console.error('Error:', error.message);
        process.exit(1);
    });
}

module.exports = InviteManager; 