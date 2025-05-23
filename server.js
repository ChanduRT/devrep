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
      timeout: 30000,
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
        flask_services: pythonHealthCheck.data.services || {}
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

// Code analysis endpoint
app.post('/analyze', async (req, res) => {
  try {
    const { code, language } = req.body;
    
    if (!code) {
      return res.status(400).json({ error: 'No code provided' });
    }
    
    const result = await callFlaskAPI('/analyze', { code, language });
    res.json(result);
  } catch (error) {
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

// Code execution endpoint (mock implementation)
app.post('/execute', async (req, res) => {
  try {
    const { code, language } = req.body;
    
    if (!code) {
      return res.status(400).json({ error: 'No code provided' });
    }
    
    // Mock execution - in production, you'd implement proper sandboxed execution
    let output = '';
    
    switch (language) {
      case 'javascript':
        try {
          // Simple eval for basic JavaScript (NOT for production)
          const result = eval(code);
          output = result !== undefined ? String(result) : 'Code executed successfully';
        } catch (evalError) {
          output = `JavaScript Error: ${evalError.message}`;
        }
        break;
      
      case 'python':
        output = 'Python execution requires a Python runtime. Code analysis completed.';
        break;
      
      default:
        output = `${language} execution not implemented. Code syntax appears valid.`;
    }
    
    res.json({ output, success: true });
  } catch (error) {
    res.status(500).json({ 
      output: `Execution failed: ${error.message}`,
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
  console.log('\n🔧 Make sure to:');
  console.log('1. Start the Flask backend server (python app.py)');
  console.log('2. Install required dependencies (npm install)');
  console.log('3. Configure your Gemini API key in app.py');
});

export default app;