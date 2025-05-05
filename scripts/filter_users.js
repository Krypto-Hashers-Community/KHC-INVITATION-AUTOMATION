import InviteManager from './invite_manager.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function filterNewUsers(userList) {
    const manager = new InviteManager();
    const newUsers = [];
    const alreadyInvited = [];

    for (const username of userList) {
        if (!manager.isUserInvited(username)) {
            newUsers.push(username);
        } else {
            const inviteInfo = manager.invitedUsers.invited_users[username];
            alreadyInvited.push({
                username,
                invited_at: inviteInfo.invited_at,
                search_term: inviteInfo.search_term
            });
        }
    }

    // Print summary
    console.log('\n=== User Filter Results ===');
    console.log(`Total users in list: ${userList.length}`);
    console.log(`New users: ${newUsers.length}`);
    console.log(`Already invited: ${alreadyInvited.length}`);

    if (alreadyInvited.length > 0) {
        console.log('\nSample of already invited users:');
        alreadyInvited.slice(0, 5).forEach(user => {
            console.log(`- ${user.username} (invited on ${user.invited_at} via "${user.search_term}")`);
        });
    }

    if (newUsers.length > 0) {
        console.log('\nNew users to invite:');
        newUsers.forEach(username => console.log(`- ${username}`));
    }

    return {
        newUsers,
        alreadyInvited
    };
}

// If running directly, process input from stdin
if (import.meta.url === new URL(import.meta.url).href) {
    let input = '';
    process.stdin.setEncoding('utf-8');
    
    process.stdin.on('data', chunk => {
        input += chunk;
    });

    process.stdin.on('end', async () => {
        const userList = input.split('\n')
            .map(line => line.trim())
            .filter(line => line && line.startsWith('@'))
            .map(line => line.substring(1)); // remove @ symbol
        
        await filterNewUsers(userList);
    });
}

export default filterNewUsers; 