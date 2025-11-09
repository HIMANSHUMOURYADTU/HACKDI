import express from 'express';
import fetch from 'node-fetch';
import dotenv from 'dotenv';
import { MongoClient } from 'mongodb';
dotenv.config();

const app = express();
const port = process.env.PORT || 3001;
app.use(express.json());

// Add CORS middleware
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// --- CONFIGURATION ---
const apiKey = process.env.GEMINI_API_KEY;
const mongoUri = process.env.MONGODB_URI;

if (!apiKey || !mongoUri) {
  console.error("Missing GEMINI_API_KEY or MONGODB_URI in .env file. Please check your .env file.");
  process.exit(1);
}

// Gemini Model Configuration
const chatModel = 'gemini-2.0-flash'; // Matched your curl command
const embeddingModel = 'text-embedding-004'; // Gemini embedding model
const EMBEDDING_DIMENSIONS = 768;

// --- AGENT PROMPTS ---

const QUERY_AGENT_PROMPT = `
You are a MongoDB query expert. Your job is to convert a natural language query into a valid MongoDB 'find' filter.
- You must only output a valid JSON object for the 'find' filter.
- Do not output any other text, markdown, or explanations.
- If the query is vague, make a best guess.
- **CRITICAL RULE:** For any string field query, especially 'Name', you MUST use a case-insensitive regex that matches the exact name, ignoring leading/trailing spaces.
- The regex MUST be JSON-safe. Use \\\\ (four backslashes) for \\.
- Use this format: { "Name": { "$regex": "^\\\\s*Kangan\\\\s*$", "$options": "i" } }
- Example: "find person named Kangan" -> { "Name": { "$regex": "^\\\\s*Kangan\\\\s*$", "$options": "i" } }
- Example: "Vidit tayal" -> { "Name": { "$regex": "^\\\\s*Vidit tayal\\\\s*$", "$options": "i" } }
- Handle CTC (salary) in LPA. "50LPA" or "50 Lakhs" means { "$gt": 50 }.
- **Branch Mappings:**
  - CO: Computer Science
  - IT: Information Technology
  - SE: Software Engineering
  - MCE: Mathematical and Computational Engineering
  - ECE: Electronics and Communication Engineering
  - EE: Electrical Engineering
  - ME: Mechanical Engineering
  - EN: Environmental Engineering
  - CE: Civil Engineering
  - PE: Production Engineering
  - BT: Biotechnology
- **Branch Categories:**
  - **Tech Branches:** CO, IT, SE, MCE
  - **Circuital Branches:** ECE, EE
  - **Core Branches:** ME, EN, CE, PE, BT
- If a user asks for "tech branches", you must translate that to: { "Branch": { "$in": ["CO", "IT", "SE", "MCE"] } }
- If a user asks for "circuital branches", translate to: { "Branch": { "$in": ["ECE", "EE"] } }
- If a user asks for "core branches", translate to: { "Branch": { "$in": ["ME", "EN", "CE", "PE", "BT"] } }
`;

const SECURITY_AGENT_PROMPT = `
You are a MongoDB security agent.
- Your job is to check if a query is safe.
- Safe queries only use 'find' operators (like $gt, $lt, $in, $eq, $ne, $regex, $options).
- DANGEROUS queries use operators like $where, $function, $eval, $lookup, $unionWith, or any aggregation pipeline stages.
- The user query is NOT a full aggregation pipeline, it is just the JSON for a 'find' filter.
- You must output JSON.
- If safe, output: { "isSafe": true, "reason": "Query uses safe find operators." }
- If dangerous, output: { "isSafe": false, "reason": "Query contains potentially dangerous operators like [operator]." }
`;

const OPTIMIZATION_AGENT_PROMPT = `
You are a MongoDB performance expert.
- Your job is to optimize a 'find' filter JSON.
- For most simple queries, no optimization is needed.
- If no optimization is needed, return the original query.
- You must only output the optimized JSON filter.
- Example: If a query uses regex like /Name/, change it to /^Name/ for better index use.
`;

const VALIDATION_AGENT_PROMPT = `
You are a query validation AI.
- Your job is to predict if a query will be useful for structured data retrieval.
- "Useful" queries are specific (e.g., "find managers with ctc > 50", "show me people in CO branch").
- "Vague" queries are conversational or broad (e.g., "tell me about our managers", "what's up with marketing?", "Kangan Gupta").
- You must output JSON.
- Output a confidence score from 0.0 (vague) to 1.0 (specific).
- Example for "find ctc > 50": { "isUseful": true, "confidence": 0.95, "suggestion": "Query is clear and specific." }
- Example for "tell me about Kangan": { "isUseful": false, "confidence": 0.3, "suggestion": "Query is conversational. RAG might be better." }
`;

const RAG_AGENT_PROMPT = `
You are a helpful assistant. You will be given a user's question and a JSON array of database documents as context.
Your job is to answer the user's question *only* using the provided context.
- Be concise and answer in natural language.
- Do not mention the context or the database.
- If the context is empty, just say "I'm sorry, I couldn't find any relevant information."
- Synthesize the information if there are multiple documents.
`;

const UPDATE_AGENT_PROMPT = `
You are a MongoDB update query expert.
- Your job is to convert a natural language update request into a valid MongoDB update query object.
- You MUST output a JSON object with two keys: "filter" (to find the document) and "update" (using the "$set" operator).
- Only use the "$set" operator.

**CRITICAL FILTER RULES:**
1.  The 'filter' object MUST be specific. If a 'Name' is mentioned, you MUST use it.
2.  For any string field in the 'filter' (like 'Name'), you MUST use a case-insensitive regex that matches the exact name, ignoring leading/trailing spaces.
    - The regex MUST be JSON-safe. Use \\\\ (four backslashes) for \\.
    - Example: "Kangan Gupta" -> { "Name": { "$regex": "^\\\\s*Kangan Gupta\\\\s*$", "$options": "i" } }
3.  **SAFETY RULE:** If the filter is ambiguous, not specific (e.g., no 'Name' or 'Roll No'), or would update multiple documents, you MUST return an empty filter object.
    - Example: "Change CTC for CO branch" -> { "filter": {}, "update": {} }

**CRITICAL UPDATE RULES:**
1.  Handle CTC (salary) as a number. "50LPA" or "50 Lakhs" must be converted to a number.
    - Example: "set CTC to 70 LPA" -> { "$set": { "CTC": 70 } }
2.  Use the branch mappings for any 'Branch' updates.
    - Example: "move to Computer Science" -> { "$set": { "Branch": "CO" } }

**BRANCH MAPPINGS (for 'Branch' field):**
- CO: Computer Science
- IT: Information Technology
- SE: Software Engineering
- MCE: Mathematical and Computational Engineering
- ECE: Electronics and Communication Engineering
- EE: Electrical Engineering
- ME: Mechanical Engineering
- EN: Environmental Engineering
- CE: Civil Engineering
- PE: Production Engineering
- BT: Biotechnology

**EXAMPLES:**
- User: "Change the CTC for Kangan Gupta to 70"
- Output: { "filter": { "Name": { "$regex": "^\\\\s*Kangan Gupta\\\\s*$", "$options": "i" } }, "update": { "$set": { "CTC": 70 } } }
- User: "Update Vidit Tayal's branch to Information Technology"
- Output: { "filter": { "Name": { "$regex": "^\\\\s*Vidit Tayal\\\\s*$", "$options": "i" } }, "update": { "$set": { "Branch": "IT" } } }
- User: "Set all CO branch CTCs to 50"
- Output: { "filter": {}, "update": {} }
`;

const UPDATE_SECURITY_AGENT_PROMPT = `
You are a strict MongoDB security agent for UPDATE queries.
- Your job is to check if an update query is safe.
- The query MUST be a JSON object with "filter" and "update" keys.
- The "update" object MUST only use the "$set" operator.
- **DANGEROUS OPERATORS:** Any operator other than "$set" ($unset, $rename, $inc, $mul, $push, $pull) is DANGEROUS.
- **DANGEROUS FILTERS:** The "filter" object MUST NOT be empty ({}). An empty filter is DANGEROUS as it would update all documents.
- You must output JSON.
- If safe (only $set AND non-empty filter): { "isSafe": true, "reason": "Update uses $set operator and a specific filter." }
- If dangerous (bad operator): { "isSafe": false, "reason": "Update uses a dangerous operator other than $set." }
- If dangerous (empty filter): { "isSafe": false, "reason": "Update filter is empty. This is too broad." }
`;

// --- DATABASE CONNECTION ---
// Remove the 'serverApi' block to avoid the $vectorSearch error
const mongoClient = new MongoClient(mongoUri);

let db;
(async () => {
  try {
    await mongoClient.connect();
    db = mongoClient.db("Employees"); // The database we are using
    await mongoClient.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } catch (err) {
    console.error("Failed to connect to MongoDB", err);
    process.exit(1);
  }
})();


// --- GEMINI HELPER FUNCTIONS ---
async function callGemini(systemPrompt, userQuery, apiKey, isJson = true) {
  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${chatModel}:generateContent?key=${apiKey}`; 
  
  if (!userQuery) {
    console.error("[callGemini] Error: userQuery is null or undefined.");
    throw new Error("Gemini was called with an empty query.");
  }

  // This structure matches your curl command for the v1beta API
  const payload = {
    contents: [
      {
        role: "user",
        parts: [{ text: systemPrompt }]
      },
      {
        role: "model",
        parts: [{ text: "Okay, I understand my role and will provide the requested output." }]
      },
       {
        role: "user",
        parts: [{ text: userQuery }]
      }
    ],
    generationConfig: {
      responseMimeType: isJson ? "application/json" : "text/plain",
    }
  };

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Gemini API request failed: ${response.status} ${errorBody}`);
    }

    const result = await response.json();

    if (result.candidates && result.candidates[0].content?.parts?.[0]?.text) {
      const textResponse = result.candidates[0].content.parts[0].text;
      return isJson ? JSON.parse(textResponse) : textResponse;
    } else {
      // Handle cases where Gemini returns no response (e.g., safety block)
      console.error("[callGemini] No text response from Gemini. Full response:", JSON.stringify(result, null, 2));
      if (result.promptFeedback?.blockReason) {
        throw new Error(`Gemini request blocked: ${result.promptFeedback.blockReason}`);
      }
      throw new Error("Invalid response structure from Gemini API.");
    }
  } catch (error) {
    console.error(`[callGemini] Error: ${error.message}`);
    throw error;
  }
}

async function getEmbedding(text, apiKey) {
  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${embeddingModel}:embedContent?key=${apiKey}`;
  const payload = {
    content: {
      parts: [{ text: text }]
    }
  };

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Gemini Embedding API request failed: ${response.status} ${errorBody}`);
    }
    
    const result = await response.json();
    return result.embedding.values;
  } catch (error) {
    console.error(`[getEmbedding] Error: ${error.message}`);
    throw error;
  }
}

function createTextForEmbedding(doc) {
  return `
    Manager Name: ${doc.Name || 'N/A'},
    CGPA: ${doc.CGPA || 'N/A'},
    Branch: ${doc.Branch || 'N/A'},
    Role: ${doc.Role || 'N/A'},
    Company: ${doc.Company || 'N/A'},
    CTC: ${doc.CTC || 'N/A'} LPA,
    Details: ${doc.Details || 'N/A'}
  `.trim().replace(/\s+/g, ' ');
}


// --- REUSABLE PIPELINE 1: NL-to-Query ---
async function runNlToQueryPipeline(userInput, collectionName, user) {
  console.log(`[NL-to-Query] Running: "${userInput}"`);
  
  // 1. Query Agent
  console.log('[NL-to-Query] Calling Query Agent...');
  const mongoQuery = await callGemini(QUERY_AGENT_PROMPT, userInput, apiKey);

  // 2. Security Agent
  console.log('[NL-to-Query] Calling Security Agent...');
  const securityCheck = await callGemini(SECURITY_AGENT_PROMPT, JSON.stringify(mongoQuery), apiKey);
  if (!securityCheck.isSafe) {
    throw new Error(`Query blocked by security: ${securityCheck.reason}`);
  }

  // 3. Optimization Agent
  console.log('[NL-to-Query] Calling Optimization Agent...');
  const optimizedQuery = await callGemini(OPTIMIZATION_AGENT_PROMPT, JSON.stringify(mongoQuery), apiKey);

  // 4. Validation Agent
  console.log('[NL-to-Query] Calling Validation Agent...');
  const validation = await callGemini(VALIDATION_AGENT_PROMPT, userInput, apiKey);

  // 5. Run Query
  console.log(`[NL-to-Query] Checking permissions...`);
  const collection = db.collection("Permissions");
  const permission = await collection.findOne({ role: user.role });
  
  const hasPermission = permission && 
                        (permission.allowedCollections.includes("*") || 
                         permission.allowedCollections.includes(collectionName));

  if (!hasPermission) {
    throw new Error(`Role '${user.role}' has no access to '${collectionName}'`);
  }

  console.log(`[NL-to-Query] Running query on ${collectionName}: ${JSON.stringify(optimizedQuery)}`);
  const data = await db.collection(collectionName)
    .find(optimizedQuery)
    .project({ docEmbedding: 0 }) // Exclude the embedding
    .toArray();
  console.log(`[NL-to-Query] Found ${data.length} results.`);

  // 6. Audit Log
  const auditLog = {
    userId: user.id,
    role: user.role,
    userInput,
    mongoQuery: optimizedQuery,
    results: data.length,
    timestamp: new Date()
  };
  await db.collection("AuditLogs").insertOne(auditLog);

  // 7. Return final result
  return {
    type: "data",
    confidence: data.length === 0 ? 0 : validation.confidence,
    data: data,
    mongoQuery: optimizedQuery,
    securityCheck,
    validation
  };
}


// --- REUSABLE PIPELINE 2: RAG ---
async function runRagPipeline(userInput, user) {
  console.log(`[RAG] Running: "${userInput}"`);
  
  // 1. Get embedding for the user's query
  console.log('[RAG] Getting query embedding...');
  const queryVector = await getEmbedding(userInput, apiKey);

  // 2. Perform Vector Search
  console.log('[RAG] Performing vector search...');
  const collection = db.collection("managers");
  const searchCursor = collection.aggregate([
    {
      "$vectorSearch": {
        "index": "vectorIndex",
        "path": "docEmbedding",
        "queryVector": queryVector,
        "numCandidates": 100,
        "limit": 5
      }
    },
    {
      "$project": {
        "docEmbedding": 0, // Don't return the embedding
        "score": { "$meta": "vectorSearchScore" }
      }
    }
  ]);
  const retrievedDocs = await searchCursor.toArray();
  console.log(`[RAG] Found ${retrievedDocs.length} relevant documents.`);

  if (retrievedDocs.length === 0) {
    return {
      type: "answer",
      confidence: 0,
      answer: "I'm sorry, I couldn't find any relevant information in the database to answer that question.",
      context: []
    };
  }

  // 3. Call Gemini to generate a natural language answer
  console.log('[RAG] Calling Gemini to generate answer...');
  const topScore = retrievedDocs[0].score;
  const context = JSON.stringify(retrievedDocs);
  const answer = await callGemini(RAG_AGENT_PROMPT, `Question: ${userInput}\n\nContext: ${context}`, apiKey, false);

  // 4. RETURN FINAL RAG RESULT
  return {
    type: "answer",
    confidence: topScore,
    answer: answer,
    context: retrievedDocs
  };
}


// --- REUSABLE PIPELINE 3: Update ---
async function runUpdatePipeline(userInput, collectionName, user) {
  console.log(`[Update] Running: "${userInput}"`);

  // 1. Check Permissions
  console.log(`[Update] Checking permissions...`);
  const permCollection = db.collection("Permissions");
  const permission = await permCollection.findOne({ role: user.role });
  const hasPermission = permission && 
                        (permission.allowedCollections.includes("*") || 
                         permission.allowedCollections.includes(collectionName));

  if (!hasPermission) {
    throw new Error(`Role '${user.role}' has no access to '${collectionName}'`);
  }

  // 2. Update Agent
  console.log('[Update] Calling Update Agent...');
  const updateQuery = await callGemini(UPDATE_AGENT_PROMPT, userInput, apiKey);

  // 3. Update Security Agent
  console.log('[Update] Calling Update Security Agent...');
  const securityCheck = await callGemini(UPDATE_SECURITY_AGENT_PROMPT, JSON.stringify(updateQuery), apiKey);
  if (!securityCheck.isSafe) {
    throw new Error(`Update blocked by security: ${securityCheck.reason}`);
  }

  // 4. Run Update Query
  console.log(`[Update] Running query on ${collectionName}: ${JSON.stringify(updateQuery)}`);
  const collection = db.collection(collectionName);
  const updateResult = await collection.updateMany(updateQuery.filter, updateQuery.update);
  console.log(`[Update] Modified ${updateResult.modifiedCount} documents.`);

  // 5. Re-sync RAG Embeddings
  let reEmbeddedCount = 0;
  if (updateResult.modifiedCount > 0) {
    console.log(`[Update] Re-syncing ${updateResult.modifiedCount} RAG embeddings...`);
    const updatedDocs = await collection.find(updateQuery.filter).toArray();
    
    for (const doc of updatedDocs) {
      console.log(`  -> Synced embedding for: ${doc.Name}`);
      const textToEmbed = createTextForEmbedding(doc);
      const embedding = await getEmbedding(textToEmbed, apiKey);
      await collection.updateOne({ _id: doc._id }, { $set: { docEmbedding: embedding } });
      reEmbeddedCount++;
    }
  }

  // 6. Audit Log
  await db.collection("AuditLogs").insertOne({
    userId: user.id,
    role: user.role,
    userInput,
    mongoQuery: updateQuery,
    modifiedCount: updateResult.modifiedCount,
    timestamp: new Date()
  });

  return {
    success: true,
    modifiedCount: updateResult.modifiedCount,
    reEmbeddedCount: reEmbeddedCount
  };
}


// --- API ENDPOINTS ---

app.get('/', (req, res) => {
  res.send('QueryChain AI Backend is running.');
});

/**
 * HYBRID QUERY ENDPOINT
 * Runs both NL-to-Query and RAG pipelines and returns the most confident result.
 */
app.post('/api/hybrid-query', async (req, res) => {
  const { userInput, collectionName } = req.body;
  const user = { id: "user-123", role: "Admin" }; // Hard-coded user

  if (!userInput || !collectionName) {
    return res.status(400).json({ error: "userInput and collectionName are required." });
  }
  
  console.log(`[Hybrid] Received: "${userInput}"`);

  try {
    // Run both pipelines in parallel
    const [nlResult, ragResult] = await Promise.all([
      runNlToQueryPipeline(userInput, collectionName, user),
      runRagPipeline(userInput, user)
    ]);

    console.log(`[Hybrid] NL-to-Query Confidence: ${nlResult.confidence}`);
    console.log(`[Hybrid] RAG Confidence: ${ragResult.confidence}`);

    // Compare confidence and return the winner
    if (nlResult.confidence > ragResult.confidence) {
      console.log('[Hybrid] Winner: NL-to-Query');
      res.json({ winner: "nl-to-query", ...nlResult });
    } else {
      console.log('[Hybrid] Winner: RAG');
      res.json({ winner: "rag", ...ragResult });
    }

  } catch (error) {
    console.error(`[Hybrid] An error occurred: ${error.message}`);
    res.status(500).json({ error: "An error occurred during hybrid query.", details: error.message });
  }
});

/**
 * UPDATE QUERY ENDPOINT
 * Runs the secure update pipeline.
 */
app.post('/api/update-query', async (req, res) => {
  const { userInput, collectionName } = req.body;
  const user = { id: "user-123", role: "Admin" }; // Hard-coded user

  if (!userInput || !collectionName) {
    return res.status(400).json({ error: "userInput and collectionName are required." });
  }
  
  try {
    const result = await runUpdatePipeline(userInput, collectionName, user);
    res.json({ status: "success", ...result });
  } catch (error) {
    console.error(`[Update] An error occurred: ${error.message}`);
    res.status(500).json({ error: "An error occurred during update.", details: error.message });
  }
});


// --- START SERVER ---
app.listen(port, () => {
  console.log(`QueryChain AI Backend listening on http://localhost:${port}`);
});