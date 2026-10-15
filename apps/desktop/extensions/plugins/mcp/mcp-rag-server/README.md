# Local RAG MCP Server

A dedicated Node.js-based MCP server that provides 100% local, offline Retrieval-Augmented Generation capabilities.

## Features
- **Local Embeddings**: Uses `@xenova/transformers` (`all-MiniLM-L6-v2`) to generate embeddings locally on your machine without hitting external APIs.
- **Qdrant Storage**: Stores vectors and payloads efficiently.
- **File Ingestion**: Supports `.txt`, `.pdf`, and `.docx` via base64 upload, automatically chunking them with semantic overlap.
- **MCP Integration**: Fully exposes `rag_add_document` and `rag_search` tools to AI Server Studio.

## Prerequisites
1. **Node.js** v18+ 
2. **Qdrant** running locally. 
   Set up Qdrant using their executable, or via Docker:
   ```bash
   docker run -p 6333:6333 -p 6334:6334 \
       -v $(pwd)/qdrant_storage:/qdrant/storage:z \
       qdrant/qdrant
   ```

## Usage

1. Start the server (it will automatically build the `documents` collection on boot):
   ```bash
   npm start
   ```

2. Open **AI Server Studio**, navigate to **Settings -> MCP Servers**.
3. Add a new server with the URL: `http://localhost:4000`
4. The server will sync. You will now see `rag_add_document` and `rag_search` listed as available tools. 

*(Note: The very first time you start the server and run an embedding, it will download the Xenova MiniLM model cache. Subsequent runs will be significantly faster).*
