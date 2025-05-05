import InviteManager from './invite_manager.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class SearchAndInvite {
    constructor() {
        this.inviteManager = new InviteManager();
        this.logPath = path.join(__dirname, '..', 'invitation_log.txt');
    }

    async searchAndInviteUsers(searchTerm) {
        try {
            // Your existing search logic here
            const users = await this.searchUsers(searchTerm);
            
            let invitedCount = 0;
            let skippedCount = 0;

            for (const username of users) {
                // Check if user was already invited
                if (await this.inviteManager.trackInvite(username, searchTerm)) {
                    // Your existing invite logic here
                    await this.inviteUser(username, searchTerm);
                    invitedCount++;
                } else {
                    skippedCount++;
                }
            }

            console.log(`Search term: ${searchTerm}`);
            console.log(`New invites sent: ${invitedCount}`);
            console.log(`Skipped (already invited): ${skippedCount}`);
            
        } catch (error) {
            console.error('Error in search and invite process:', error);
            throw error;
        }
    }

    async searchUsers(searchTerm) {
        // Your existing search implementation
        // Return array of usernames
        return [];
    }

    async inviteUser(username, searchTerm) {
        const timestamp = new Date().toISOString();
        const logEntry = `${timestamp} - ${searchTerm} - ${username}\n`;
        
        await fs.appendFile(this.logPath, logEntry);
        // Your existing invite implementation
    }

    async importExistingInvites() {
        await this.inviteManager.importFromLog(this.logPath);
    }
}

// Example usage:
async function main() {
    const searcher = new SearchAndInvite();
    
    // First import existing invites
    await searcher.importExistingInvites();
    
    // Then do new search
    await searcher.searchAndInviteUsers('search-IIT');
}

// Run if this is the main module
main().catch(console.error);

export default SearchAndInvite; 