import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class InviteManager {
    constructor() {
        this.invitedUsersPath = path.join(__dirname, '..', 'invited_users.json');
        this.invitedUsers = this.loadInvitedUsers();
    }

    loadInvitedUsers() {
        try {
            const data = fs.readFileSync(this.invitedUsersPath, 'utf8');
            return JSON.parse(data);
        } catch (error) {
            // If file doesn't exist or is invalid, return default structure
            return {
                invited_users: {},
                last_updated: new Date().toISOString(),
                total_invites: 0
            };
        }
    }

    isUserInvited(username) {
        return username in this.invitedUsers.invited_users;
    }

    async trackInvite(username, searchTerm = '') {
        if (this.isUserInvited(username)) {
            console.log(`User ${username} was already invited on ${this.invitedUsers.invited_users[username].invited_at}`);
            return false;
        }

        // Track the new invite
        this.invitedUsers.invited_users[username] = {
            invited_at: new Date().toISOString(),
            search_term: searchTerm
        };
        this.invitedUsers.total_invites++;
        this.invitedUsers.last_updated = new Date().toISOString();

        // Save to file
        await this.saveInvitedUsers();
        return true;
    }

    async saveInvitedUsers() {
        try {
            await fs.promises.writeFile(
                this.invitedUsersPath,
                JSON.stringify(this.invitedUsers, null, 2),
                'utf8'
            );
        } catch (error) {
            console.error('Error saving invited users:', error);
            throw error;
        }
    }

    // Import existing invites from log file
    async importFromLog(logPath) {
        try {
            const logContent = await fs.promises.readFile(logPath, 'utf8');
            const lines = logContent.split('\n');
            
            for (const line of lines) {
                if (line.trim()) {
                    const match = line.match(/(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z) - (.+?) - (.+)/);
                    if (match) {
                        const [, timestamp, searchTerm, username] = match;
                        if (!this.isUserInvited(username)) {
                            this.invitedUsers.invited_users[username] = {
                                invited_at: timestamp,
                                search_term: searchTerm
                            };
                            this.invitedUsers.total_invites++;
                        }
                    }
                }
            }
            
            this.invitedUsers.last_updated = new Date().toISOString();
            await this.saveInvitedUsers();
            console.log(`Imported invites from log. Total unique invites: ${this.invitedUsers.total_invites}`);
        } catch (error) {
            console.error('Error importing from log:', error);
            throw error;
        }
    }

    getStatistics() {
        const stats = {
            totalInvites: this.invitedUsers.total_invites,
            lastUpdated: this.invitedUsers.last_updated,
            bySearchTerm: {},
            byDate: {},
            recentInvites: [],
            topSearchTerms: []
        };

        // Process all invites
        for (const [username, data] of Object.entries(this.invitedUsers.invited_users)) {
            // Count by search term
            const searchTerm = data.search_term || 'unknown';
            stats.bySearchTerm[searchTerm] = (stats.bySearchTerm[searchTerm] || 0) + 1;

            // Count by date
            const date = data.invited_at.split('T')[0];
            stats.byDate[date] = (stats.byDate[date] || 0) + 1;
        }

        // Get top search terms
        stats.topSearchTerms = Object.entries(stats.bySearchTerm)
            .sort(([,a], [,b]) => b - a)
            .slice(0, 10)
            .map(([term, count]) => ({ term, count }));

        // Get most recent invites
        stats.recentInvites = Object.entries(this.invitedUsers.invited_users)
            .map(([username, data]) => ({
                username,
                invited_at: data.invited_at,
                search_term: data.search_term
            }))
            .sort((a, b) => new Date(b.invited_at) - new Date(a.invited_at))
            .slice(0, 20);

        return stats;
    }

    async generateReport(outputPath = null) {
        const stats = this.getStatistics();
        const report = [];

        // Header
        report.push('# Invitation Statistics Report');
        report.push(`Generated on: ${new Date().toISOString()}\n`);

        // Overall stats
        report.push('## Overall Statistics');
        report.push(`Total Invites: ${stats.totalInvites}`);
        report.push(`Last Updated: ${stats.lastUpdated}\n`);

        // Top search terms
        report.push('## Top Search Terms');
        stats.topSearchTerms.forEach(({term, count}) => {
            report.push(`- ${term}: ${count} invites`);
        });
        report.push('');

        // Daily statistics
        report.push('## Daily Statistics');
        const sortedDates = Object.entries(stats.byDate)
            .sort(([a], [b]) => b.localeCompare(a));
        
        sortedDates.forEach(([date, count]) => {
            report.push(`- ${date}: ${count} invites`);
        });
        report.push('');

        // Recent invites
        report.push('## Recent Invites');
        stats.recentInvites.forEach(invite => {
            report.push(`- ${invite.username} (${invite.invited_at}) - via "${invite.search_term}"`);
        });

        const reportText = report.join('\n');
        
        if (outputPath) {
            await fs.promises.writeFile(outputPath, reportText, 'utf8');
            console.log(`Report saved to: ${outputPath}`);
        }

        return reportText;
    }

    getInvitesBySearchTerm(searchTerm) {
        return Object.entries(this.invitedUsers.invited_users)
            .filter(([, data]) => data.search_term === searchTerm)
            .map(([username, data]) => ({
                username,
                invited_at: data.invited_at
            }));
    }

    getInvitesByDateRange(startDate, endDate) {
        const start = new Date(startDate);
        const end = new Date(endDate);
        
        return Object.entries(this.invitedUsers.invited_users)
            .filter(([, data]) => {
                const inviteDate = new Date(data.invited_at);
                return inviteDate >= start && inviteDate <= end;
            })
            .map(([username, data]) => ({
                username,
                invited_at: data.invited_at,
                search_term: data.search_term
            }));
    }

    getDuplicateSearchAttempts() {
        const userSearches = {};
        const duplicates = [];

        Object.entries(this.invitedUsers.invited_users).forEach(([username, data]) => {
            if (!userSearches[username]) {
                userSearches[username] = [];
            }
            userSearches[username].push({
                search_term: data.search_term,
                invited_at: data.invited_at
            });
        });

        // Find users who were found by multiple searches
        Object.entries(userSearches)
            .filter(([, searches]) => searches.length > 1)
            .forEach(([username, searches]) => {
                duplicates.push({
                    username,
                    attempts: searches
                });
            });

        return duplicates;
    }
}

export default InviteManager; 