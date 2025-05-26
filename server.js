import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import bodyParser from 'body-parser';
import axios from 'axios';
import cors from 'cors';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const port = 3000;

// Set EJS as templating engine
app.set('view engine', 'ejs');
app.set('views', join(__dirname, 'views'));

// Middleware
app.use(cors());
app.use(express.static('public'));
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));

// Enhanced error handling middleware
app.use((err, req, res, next) => {
  console.error('Server Error:', err);
  res.status(500).json({ 
    error: 'Internal server error', 
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong' 
  });
});

// Flask backend URL
const FLASK_BACKEND_URL = 'http://localhost:5000';

// Helper function to make requests to Flask backend
async function callFlaskAPI(endpoint, data = {}) {
  try {
    const response = await axios.post(`${FLASK_BACKEND_URL}${endpoint}`, data, {
      timeout: 60000, // Increased timeout for code execution
      headers: { 'Content-Type': 'application/json' }
    });
    return response.data;
  } catch (error) {
    console.error(`Flask API Error (${endpoint}):`, error.message);
    
    if (error.code === 'ECONNREFUSED') {
      throw new Error('Flask backend is not running. Please start the Python server on port 5000.');
    }
    
    if (error.response) {
      throw new Error(error.response.data?.error || 'Backend service error');
    }
    
    throw new Error('Failed to connect to backend service');
  }
}

// Routes
app.get('/', (req, res) => {
  res.render('index');
});

app.get('/index', (req, res) => {
  res.render('editor');
});

app.get('/voice', (req, res) => {
  res.render('voice');
});

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    // Check Python backend health
    const pythonHealthCheck = await axios.get(`${FLASK_BACKEND_URL}/health`, { timeout: 5000 });
    
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      services: {
        node_server: 'running',
        python_backend: pythonHealthCheck.data.status || 'unknown',
        flask_services: pythonHealthCheck.data.services || {},
        piston_api: pythonHealthCheck.data.services?.piston || 'unknown',
        codellama: pythonHealthCheck.data.services?.codellama || 'unknown'
      }
    });
  } catch (error) {
    res.status(503).json({
      status: 'degraded',
      timestamp: new Date().toISOString(),
      services: {
        node_server: 'running',
        python_backend: 'unavailable',
        error: error.message
      }
    });
  }
});

// Code execution endpoint using Piston API
app.post('/execute', async (req, res) => {
  try {
    const { code, language } = req.body;
    
    if (!code) {
      return res.status(400).json({ error: 'No code provided' });
    }
    
    console.log(`Executing ${language} code via Piston API...`);
    const result = await callFlaskAPI('/execute', { code, language });
    
    res.json({
      output: result.output || 'Code executed successfully',
      success: result.success !== false,
      runtime: result.runtime || 'Unknown runtime',
      error: result.error || null
    });
  } catch (error) {
    console.error('Code execution error:', error.message);
    res.status(500).json({ 
      output: `Execution failed: ${error.message}`,
      success: false,
      error: error.message
    });
  }
});

// Code analysis endpoint using CodeLlama
app.post('/analyze', async (req, res) => {
  try {
    const { code, language } = req.body;
    
    if (!code) {
      return res.status(400).json({ error: 'No code provided' });
    }
    
    console.log(`Analyzing ${language} code with CodeLlama...`);
    const result = await callFlaskAPI('/analyze', { code, language });
    res.json(result);
  } catch (error) {
    console.error('Code analysis error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Legacy endpoints for backward compatibility
app.post('/checklint', async (req, res) => {
  try {
    const { code, language } = req.body;
    
    if (!code) {
      return res.status(400).json({ error: 'No code provided' });
    }
    
    const result = await callFlaskAPI('/analyze', { code, language });
    
    // Transform response to match expected format
    res.json({
      comments: result.analysis_result ? result.analysis_result.join('\n') : 'No analysis available',
      success: true
    });
  } catch (error) {
    res.status(500).json({ 
      comments: `Analysis failed: ${error.message}`,
      success: false 
    });
  }
});

// Report generation endpoint
app.post('/report', async (req, res) => {
  try {
    const result = await callFlaskAPI('/report', req.body);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Legacy report endpoint
app.post('/crerep', async (req, res) => {
  try {
    const result = await callFlaskAPI('/report', req.body);
    
    // Transform response to match expected format
    res.json({
      output: result.report || 'Report generation failed',
      success: !!result.report
    });
  } catch (error) {
    res.status(500).json({ 
      output: `Report generation failed: ${error.message}`,
      success: false 
    });
  }
});

// Voice-to-code endpoint
app.post('/voice-to-code', async (req, res) => {
  try {
    const result = await callFlaskAPI('/voice-to-code', req.body);
    res.json(result);
  } catch (error) {
    res.status(500).json({ 
      error: error.message,
      code: '',
      voice_input: ''
    });
  }
});

// Chat endpoint
app.post('/chat', async (req, res) => {
  try {
    const result = await callFlaskAPI('/chat', req.body);
    res.json(result);
  } catch (error) {
    res.status(500).json({ 
      response: `Chat service unavailable: ${error.message}`,
      error: true 
    });
  }
});

// Get supported languages endpoint
app.get('/languages', async (req, res) => {
  try {
    // Return supported languages for Piston API
    const supportedLanguages = [
      { id: 'javascript', name: 'JavaScript', extension: 'js' },
      { id: 'python', name: 'Python', extension: 'py' },
      { id: 'java', name: 'Java', extension: 'java' },
      { id: 'cpp', name: 'C++', extension: 'cpp' },
      { id: 'c', name: 'C', extension: 'c' },
      { id: 'csharp', name: 'C#', extension: 'cs' },
      { id: 'php', name: 'PHP', extension: 'php' },
      { id: 'ruby', name: 'Ruby', extension: 'rb' },
      { id: 'go', name: 'Go', extension: 'go' },
      { id: 'rust', name: 'Rust', extension: 'rs' },
      { id: 'typescript', name: 'TypeScript', extension: 'ts' }
    ];
    
    res.json({ languages: supportedLanguages });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Start server
app.listen(port, () => {
  console.log(`🚀 DEV IDE Server running on http://localhost:${port}`);
  console.log(`📁 Views directory: ${join(__dirname, 'views')}`);
  console.log(`📦 Static files: ${join(__dirname, 'public')}`);
  console.log(`🔗 Flask backend expected at: ${FLASK_BACKEND_URL}`);
  console.log('\n🔧 Services Integration:');
  console.log('✅ Code Execution: Piston API (online)');
  console.log('✅ Code Analysis: CodeLlama (local Ollama)');
  console.log('✅ Report Generation: Gemini API');
  console.log('✅ Voice Features: Gemini API + Speech Recognition');
  console.log('\n📋 Setup Checklist:');
  console.log('1. Start Flask backend: python app.py');
  console.log('2. Start Ollama: ollama serve');
  console.log('3. Pull CodeLlama: ollama pull codellama');
  console.log('4. Set Gemini API key in Flask app');
  console.log('5. Install dependencies: npm install');
  console.log('\n🌐 Server ready at http://localhost:3000');
});

export default app;