# HackCBS

Small project workspace for HackCBS. This repository contains frontend and backend helper scripts for local development.

Getting started
- Copy `.env.sample` to `.env` (or create a `.env` file) and fill in any required secrets.
- Install dependencies: run `npm install`.
- Start the app (if applicable): `npm start` or `node gemini_backend.js` depending on the project.

Notes
- The repository's `.gitignore` excludes `.env`, `.idea`, and `node_modules` so sensitive data and editor configs are not committed.
- Do NOT commit your real `.env` values to source control.
# QueryChain AI - Natural Language Database Query System

A powerful AI-powered system that allows users to query and update MongoDB databases using natural language prompts.
Built with Gemini AI for intelligent query processing.

## Features

✨ **Natural Language Queries** - Ask questions in plain English  
🔍 **Hybrid Search** - Combines direct queries and RAG (Retrieval Augmented Generation)  
✏️ **Safe Updates** - Update database records with natural language  
🛡️ **Security Agents** - Built-in security checks for all operations  
📊 **Beautiful UI** - Modern, responsive chat interface  
🎯 **Confidence Scoring** - Know how confident the AI is about results

## Architecture

The system uses multiple AI agents working together:

1. **Query Agent** - Converts NL to MongoDB queries
2. **Security Agent** - Validates query safety
3. **Optimization Agent** - Optimizes queries for performance
4. **Validation Agent** - Checks query usefulness
5. **RAG Agent** - Provides conversational answers using vector search
6. **Update Agent** - Handles database updates safely

## Prerequisites

- Node.js (v18 or higher)
- MongoDB Atlas account
- Gemini API Key

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment Variables

Create a `.env` file in the root directory:

```env
GEMINI_API_KEY=your_gemini_api_key_here
MONGODB_URI=your_mongodb_connection_string_here
PORT=3001
```

### 3. Start the Backend

```bash
npm start
```

Or for development with auto-reload:

```bash
npm run dev
```

The backend will run on `http://localhost:3001`

### 4. Open the Frontend

Simply open `index.html` in your web browser, or use a local server:

```bash
# Using Python
python3 -m http.server 8000

# Using Node.js http-server (install with: npm install -g http-server)
http-server -p 8000

# Using PHP
php -S localhost:8000
```

Then navigate to `http://localhost:8000` in your browser.

## Usage

### Query Examples

**Finding Records:**

- "Find all managers with CTC greater than 50 LPA"
- "Show me people in CO branch"
- "Find tech branches with CGPA above 8"

**Conversational Questions:**

- "Tell me about Kangan Gupta"
- "What is the average CTC in the database?"

**Updates:**

- "Change the CTC for Kangan Gupta to 70"
- "Update Vidit Tayal's branch to IT"

### API Endpoints

#### POST `/api/hybrid-query`

Runs both NL-to-Query and RAG pipelines, returns the most confident result.

**Request:**

```json
{
  "userInput": "Find managers with CTC greater than 50",
  "collectionName": "managers"
}
```

**Response:**

```json
{
  "winner": "nl-to-query",
  "type": "data",
  "confidence": 0.95,
  "data": [...],
  "mongoQuery": {...}
}
```

#### POST `/api/update-query`

Safely updates database records using natural language.

**Request:**

```json
{
  "userInput": "Change the CTC for Kangan Gupta to 70",
  "collectionName": "managers"
}
```

**Response:**

```json
{
  "status": "success",
  "modifiedCount": 1,
  "reEmbeddedCount": 1
}
```

## Database Collections

### managers

Contains manager/employee data with fields:

- Name
- CGPA
- Branch (CO, IT, SE, MCE, ECE, EE, ME, EN, CE, PE, BT)
- Role
- Company
- CTC (in LPA)
- Details
- docEmbedding (vector for RAG)

### Permissions

Role-based access control:

```json
{
  "role": "Admin",
  "allowedCollections": ["*"]
}
```

### AuditLogs

Tracks all queries and updates for compliance.

## Branch Mappings

- **CO** - Computer Science
- **IT** - Information Technology
- **SE** - Software Engineering
- **MCE** - Mathematical and Computational Engineering
- **ECE** - Electronics and Communication Engineering
- **EE** - Electrical Engineering
- **ME** - Mechanical Engineering
- **EN** - Environmental Engineering
- **CE** - Civil Engineering
- **PE** - Production Engineering
- **BT** - Biotechnology

### Branch Categories

- **Tech Branches:** CO, IT, SE, MCE
- **Circuital Branches:** ECE, EE
- **Core Branches:** ME, EN, CE, PE, BT

## Security Features

- Query validation against dangerous operators ($where, $function, etc.)
- Empty filter detection for updates (prevents mass updates)
- Only $set operator allowed for updates
- Role-based access control
- Audit logging for all operations

## Technologies Used

- **Backend:** Node.js, Express.js
- **Database:** MongoDB Atlas with Vector Search
- **AI:** Google Gemini 2.0 Flash + Text Embedding 004
- **Frontend:** Vanilla JavaScript, HTML5, CSS3

## Development

The project structure:

```
HackCBS/
├── index.html              # Frontend UI
├── gemini_backend.js       # Backend server
├── create_data_embeddings.js
├── package.json
├── .env                    # Environment variables (create this)
└── README.md
```

## Troubleshooting

**Port already in use:**

```bash
# Find the process using port 3001
lsof -ti:3001

# Kill the process
kill -9 <PID>
```

**CORS errors:**
Make sure the backend CORS middleware is enabled (already added in the backend).

**Connection refused:**
Ensure the backend is running on port 3001 before opening the frontend.

## License

MIT

## Contributors

Built for HackCBS 🚀

## Deployment

This project can be deployed several ways. Below are recommended, low-friction options.

1) Docker (recommended for reproducible deployments)

 - Build image locally:

```powershell
docker build -t querychain-backend:latest .
```

 - Run locally with environment file:

```powershell
docker run --env-file .env -p 3001:3001 querychain-backend:latest
```

2) GitHub Container Registry (CI)

 - Push to `main` to trigger the workflow at `.github/workflows/ci-container.yml`. It builds and pushes an image to GHCR.
 - Configure repository secrets if your deployment provider needs them (example: render, cloud run credentials).

3) Deploy providers (quick notes):

 - Render: Create a new web service from a Docker image or from the repo (auto-build). Use the GHCR image or let Render build from the repo.
 - Railway / Fly / Heroku: Can use Docker or the Node start command. Provide `GEMINI_API_KEY` and `MONGODB_URI` as environment variables.
 - Google Cloud Run: Use the pushed GHCR image or build with Cloud Build. Make sure to set required secrets in Cloud Run service.

Secrets you must provide in your host/provider:

- GEMINI_API_KEY
- MONGODB_URI
- (Optional) PORT (defaults to 3001)

If you'd like, I can:

- Create a simple `render.yaml` or Cloud Run deploy action for one provider you choose.
- Replace the local `.env` with `.env.sample` and keep real secrets only locally.

### Render: quick setup and GitHub integration

Option A — Let Render build from the repo (recommended for simplicity):

1. Go to Render dashboard -> New -> Web Service -> Connect your GitHub repo `HIMANSHUMOURYADTU/HACKDI`.
2. Choose branch `main`.
3. Environment: Docker. Dockerfile path: `Dockerfile`.
4. Start command: `node gemini_backend.js`. Health check: `/`.
5. In the Render service's Environment section, add the required secrets:
   - `GEMINI_API_KEY` (secret)
   - `MONGODB_URI` (secret)
   - `PORT` (3001)
6. Enable auto-deploy on push to `main`.

Option B — Trigger deploys from GitHub Actions (already included):

- The repository includes `.github/workflows/deploy-to-render.yml`. It calls the Render API to trigger a deploy for a given Render Service ID.
- To use it, create a Render API key (Account → API Keys) and note your Render Service ID (Service settings). Add both as GitHub repository secrets:
  - `RENDER_API_KEY`
  - `RENDER_SERVICE_ID`
- When both secrets are present, pushing to `main` will trigger the `deploy-to-render.yml` workflow which calls POST `https://api.render.com/v1/services/{SERVICE_ID}/deploys`.

Notes and troubleshooting
- If you want Render to build from the GitHub repository you do not need to use the workflow — Render's automatic builds are sufficient.
- If you prefer to publish to GHCR and have Render pull the image, use the GHCR build workflow (already added) and configure Render to deploy from a container image instead.
- If you want, I can also add a combined GitHub Actions workflow that builds the image, publishes to GHCR, and then triggers Render (fully automated CI -> CD).

