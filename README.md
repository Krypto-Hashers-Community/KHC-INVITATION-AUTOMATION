   # Invites to Org

   A GitHub automation script that automatically invites followers of a bot account to join your organization.

   ## Features

   - Automatically detects new followers of your bot account
   - Checks if followers are already organization members
   - Sends organization invitations to new followers
   - Simple configuration through environment variables

   ## Setup

   1. Clone this repository
   2. Install dependencies:
      ```bash
      npm install
      ```
   3. Copy `.env.example` to `.env`:
      ```bash
      cp .env.example .env
      ```
   4. Edit `.env` with your configuration:
      - `GITHUB_TOKEN`: Your GitHub Personal Access Token with 'admin:org' scope
      - `ORG`: Your organization name (optional - can be changed in the script)
      - `BOT_USERNAME`: Your bot account username (optional - can be changed in the script)

   ## Usage

   Run the script:
   ```bash
   npm start
   ```

   ## Configuration

   You can modify the following constants in `scripts/inviteFollowers.js`:
   - `ORG`: Your organization name
   - `BOT_USERNAME`: Your bot account username

   ## Requirements

   - Node.js 14 or higher
   - GitHub Personal Access Token with 'admin:org' scope
   - A bot account that followers can follow
   - Organization admin privileges

   ## Security

   Never commit your `.env` file or expose your GitHub token. The `.env` file is already in `.gitignore` to prevent accidental commits. 