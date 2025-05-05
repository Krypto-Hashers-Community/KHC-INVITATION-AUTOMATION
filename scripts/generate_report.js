import InviteManager from './invite_manager.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function generateReports() {
    const manager = new InviteManager();
    
    // Generate main report
    const reportPath = path.join(__dirname, '..', 'invitation_report.md');
    await manager.generateReport(reportPath);

    // Get statistics
    const stats = manager.getStatistics();
    console.log('\nQuick Statistics:');
    console.log(`Total unique invites: ${stats.totalInvites}`);
    console.log('\nTop 5 Search Terms:');
    stats.topSearchTerms.slice(0, 5).forEach(({term, count}) => {
        console.log(`- ${term}: ${count} invites`);
    });

    // Check for duplicate attempts
    const duplicates = manager.getDuplicateSearchAttempts();
    if (duplicates.length > 0) {
        console.log(`\nFound ${duplicates.length} users with duplicate search attempts`);
        console.log('Sample of duplicate attempts:');
        duplicates.slice(0, 3).forEach(({username, attempts}) => {
            console.log(`\n${username}:`);
            attempts.forEach(attempt => {
                console.log(`- ${attempt.invited_at} via "${attempt.search_term}"`);
            });
        });
    }

    // Get recent statistics
    const today = new Date();
    const lastWeek = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
    const recentInvites = manager.getInvitesByDateRange(lastWeek, today);
    
    console.log(`\nLast 7 days: ${recentInvites.length} invites`);
}

// Run if this is the main module
generateReports().catch(console.error); 