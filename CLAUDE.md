# SOP Development Rules

## Core Principle
Always make .bak of files before making significant changes to a file.

## Instructions

### Project Initialization
**Purpose:** Set up and maintain the foundation for project management.

**Details:**
- Ensure a `memlog` folder exists to store tasks, changelogs, and persistent data.
- Verify and update the `memlog` folder before responding to user requests. Always append never overwrite and always datestamp.
- Keep a clear record of user progress and system state in the folder.

### Task Execution
**Purpose:** Break down user requests into actionable steps.

**Details:**
- Split tasks into **clear, numbered steps** with explanations for actions and reasoning.
- Identify and flag potential issues before they arise.
- Verify completion of each step before proceeding.
- If errors occur, document them, revert to previous steps, and retry as needed.

### Credential Management
**Purpose:** Securely manage user credentials and guide credential-related tasks.

**Details:**
- Clearly explain the purpose of credentials requested from users.
- Guide users in obtaining any missing credentials.
- Validate credentials before proceeding with any operations.
- Avoid storing credentials in plaintext; provide guidance on secure storage.
- Implement and recommend proper refresh procedures for expiring credentials.

### File Handling
**Purpose:** Ensure files are organized, modular, and maintainable.

**Details:**
- Keep files modular by breaking large components into smaller sections.
- Store constants, configurations, and reusable strings in separate files.
- Use descriptive names for files and folders for clarity.
- Document all file dependencies and maintain a clean project structure.

### Error Reporting
**Purpose:** Provide actionable feedback to users and maintain error logs.

**Details:**
- Create detailed error reports, including context and timestamps.
- Suggest recovery steps or alternative solutions for users.
- Track error history to identify patterns and improve future responses.
- Escalate unresolved issues with context to appropriate channels.

### Third Party Services
**Purpose:** Verify and manage connections to third-party services.

**Details:**
- Ensure all user setup requirements, permissions, and settings are complete.
- Test third-party service connections before using them in workflows.
- Document version requirements, service dependencies, and expected behavior.
- Prepare contingency plans for service outages or unexpected failures.

### Dependencies and Libraries
**Purpose:** Use stable, compatible, and maintainable libraries.

**Details:**
- Always use the most stable versions of dependencies to ensure compatibility.
- Update libraries regularly, avoiding changes that disrupt functionality.

### Code Documentation
**Purpose:** Maintain clarity and consistency in project code.

**Details:**
- Write clear, concise comments for all sections of code.
- Use **one set of triple quotes** for docstrings to prevent syntax errors.
- Document the purpose and expected behavior of functions and modules.

### Change Review
**Purpose:** Evaluate the impact of project changes and ensure stability.

**Details:**
- Review all changes to assess their effect on other parts of the project.
- Test changes thoroughly to ensure consistency and prevent conflicts.
- Document changes, their outcomes, and any corrective actions taken in the `memlog` folder.

### Browser Rules
**Purpose:** Exhaust all options before determining an action is impossible.

**Details:**
- When evaluating feasibility, check alternatives in all directions: **up/down** and **left/right**.
- Only conclude an action cannot be performed after all possibilities are tested.

## Server Management

**Use the server management scripts instead of manual commands:**

### Full Server Management (./server.sh)
- `./server.sh start` - Start all services (backend, frontend, tunnel)
- `./server.sh stop` - Stop all services
- `./server.sh restart` - Restart all services
- `./server.sh status` - Check status and health of all services
- `./server.sh backend restart` - Restart just the backend
- `./server.sh tunnel restart` - Restart just the tunnel
- `./server.sh logs backend` - View backend logs

### Quick Development Restart (./quick-restart.sh)
- `./quick-restart.sh` - Quickly restart backend and tunnel only

**IMPORTANT**: Always use these scripts to manage servers. Do not use manual kill/start commands.

## Additional Development Rules

- After making changes, ALWAYS restart using `./quick-restart.sh` or `./server.sh restart`
- Always look for existing code to iterate on instead of creating new code.
- Do not drastically change the patterns before trying to iterate on existing patterns.
- Always kill all existing related servers that may have been created in previous testing before trying to start a new server.
- Always prefer simple solutions.
- Avoid duplication of code whenever possible, which means checking for other areas of the codebase that might already have similar code and functionality.
- Write code that takes into account the different environments: dev, test, and prod.
- You are careful to only make changes that are requested or you are confident are well understood and related to the change being requested.
- When fixing an issue or bug, do not introduce a new pattern or technology without first exhausting all options for the existing implementation. And if you finally do this, make sure to remove the old implementation afterwards so we don't have duplicate logic.
- Keep the codebase very clean and organized.
- Avoid writing scripts in files if possible, especially if the script is likely only to be run once.
- Avoid having files over 200-300 lines of code. Refactor at that point.
- Mocking data is only needed for tests, never mock data for dev or prod.
- Never add stubbing or fake data patterns to code that affects the dev or prod environments.
- Never overwrite my .env file without first asking and confirming.
- Focus on the areas of code relevant to the task.
- Do not touch code that is unrelated to the task.
- Write thorough tests for all major functionality on a regular basis and keep the tests up-to-date.
- Avoid making major changes to the patterns and architecture of how a feature works, after it has shown to work well, unless explicitly instructed.
- Always think about what other methods and areas of code might be affected by code changes.