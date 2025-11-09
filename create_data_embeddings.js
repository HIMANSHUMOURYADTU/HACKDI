import fetch from 'node-fetch';
import dotenv from 'dotenv';
import { MongoClient, ServerApiVersion } from 'mongodb';

dotenv.config();

const mongoUri = process.env.MONGODB_URI;
const apiKey = process.env.GEMINI_API_KEY;
const embeddingModel = 'text-embedding-004'; // Gemini embedding model
const EMBEDDING_DIMENSIONS = 768;

if (!mongoUri || !apiKey) {
  console.error("Missing MONGODB_URI or GEMINI_API_KEY in .env file");
  process.exit(1);
}

const mongoClient = new MongoClient(mongoUri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

/**
 * Calls the Gemini API to get an embedding for a text chunk.
 */
async function getEmbedding(text) {
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
    console.error(`Error getting embedding for text: ${text.substring(0, 20)}...`, error.message);
    return null;
  }
}

/**
 * Creates a single descriptive string from a manager document.
 */
function createTextForEmbedding(doc) {
  // Combine all relevant fields into one text block for the AI to understand
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

/**
 * Main function to process all documents
 */
async function createEmbeddings() {
  let db;
  try {
    await mongoClient.connect();
    console.log("Connected to MongoDB Atlas.");
    db = mongoClient.db("Employees");
    const collection = db.collection("managers");

    // --- FIX ---
    // Fetch all documents that need processing into an array *first*.
    // This avoids the cursor timeout error.
    console.log("Fetching documents to process...");
    const documentsToProcess = await collection.find({ docEmbedding: { $exists: false } }).toArray();
    
    if (documentsToProcess.length === 0) {
      console.log("All documents already have embeddings.");
      await mongoClient.close();
      return;
    }
    
    console.log(`Found ${documentsToProcess.length} documents to process.`);
    // --- END FIX ---

    let count = 0;

    // Now, iterate over the local array
    for (const doc of documentsToProcess) {
      console.log(`Processing document: ${doc.Name} (ID: ${doc._id})`);
      
      // 1. Create the text string
      const textToEmbed = createTextForEmbedding(doc);

      // 2. Get the embedding
      const embedding = await getEmbedding(textToEmbed);

      if (embedding) {
        if (embedding.length !== EMBEDDING_DIMENSIONS) {
          console.error(`Embedding dimensions mismatch: ${embedding.length} vs ${EMBEDDING_DIMENSIONS}`);
          continue;
        }
        
        // 3. Save the embedding back to the document
        await collection.updateOne(
          { _id: doc._id },
          { $set: { docEmbedding: embedding } }
        );
        count++;
        console.log(`  -> Successfully created and saved embedding for ${doc.Name}.`);
      }
      
      // Add a small delay to respect API rate limits
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    console.log(`\nSuccessfully created embeddings for ${count} new documents.`);

  } catch (err) {
    console.error("An error occurred:", err);
  } finally {
    await mongoClient.close();
    console.log("Disconnected from MongoDB.");
  }
}

createEmbeddings();