from flask import Flask, request, jsonify
import requests
import google.generativeai as genai
import speech_recognition as sr
import pyttsx3
import threading
import time
import os
from datetime import datetime

app = Flask(__name__)

# Configure Gemini API
GEMINI_API_KEY = "AIzaSyCQmQlgrhnQtsgnhcY_EmLhpgt8P4zhzfQ"  # Replace with your actual API key
genai.configure(api_key=GEMINI_API_KEY)

# Piston API configuration
PISTON_API_URL = "https://emkc.org/api/v2/piston"

# CodeLlama (Ollama) API configuration
CODELLAMA_API_URL = "http://localhost:11434/api/generate"

# Initialize text-to-speech engine
tts_engine = pyttsx3.init()
tts_engine.setProperty('rate', 150)
tts_engine.setProperty('volume', 0.8)

# Initialize speech recognition
recognizer = sr.Recognizer()
microphone = sr.Microphone()

# Language mappings for Piston API
PISTON_LANGUAGE_MAP = {
    'javascript': 'javascript',
    'python': 'python',
    'java': 'java',
    'cpp': 'cpp',
    'c': 'c',
    'csharp': 'csharp',
    'php': 'php',
    'ruby': 'ruby',
    'go': 'go',
    'rust': 'rust',
    'typescript': 'typescript'
}

class VoiceAssistant:
    def __init__(self):
        self.model = genai.GenerativeModel('gemini-2.0-flash')
        self.is_listening = False
        
    def speak(self, text):
        """Convert text to speech"""
        try:
            tts_engine.say(text)
            tts_engine.runAndWait()
        except Exception as e:
            print(f"TTS Error: {e}")
    
    def listen(self):
        """Listen for voice input and convert to text"""
        try:
            with microphone as source:
                recognizer.adjust_for_ambient_noise(source, duration=1)
                print("Listening...")
                audio = recognizer.listen(source, timeout=10, phrase_time_limit=30)
                
            text = recognizer.recognize_google(audio)
            print(f"You said: {text}")
            return text
        except sr.WaitTimeoutError:
            return "Listening timeout - please try again"
        except sr.UnknownValueError:
            return "Could not understand audio"
        except sr.RequestError as e:
            return f"Speech recognition error: {e}"
    
    def generate_code(self, prompt):
        """Generate code using Gemini"""
        try:
            enhanced_prompt = f"""
            You are a helpful coding assistant. Based on the following request, generate clean, well-commented code:
            
            Request: {prompt}
            
            Please provide:
            1. Clean, working code
            2. Brief explanation of what the code does
            3. Any important notes or considerations
            
            Format your response clearly with code blocks where appropriate.
            """
            
            response = self.model.generate_content(enhanced_prompt)
            return response.text
        except Exception as e:
            return f"Error generating code: {e}"

# Initialize voice assistant
voice_assistant = VoiceAssistant()

def get_piston_runtimes():
    """Get available runtimes from Piston API"""
    try:
        response = requests.get(f"{PISTON_API_URL}/runtimes", timeout=10)
        if response.status_code == 200:
            return response.json()
        return None
    except Exception as e:
        print(f"Error fetching Piston runtimes: {e}")
        return None

def execute_code_with_piston(code, language):
    """Execute code using Piston API"""
    try:
        # Map language to Piston format
        piston_language = PISTON_LANGUAGE_MAP.get(language, language)
        
        # Get available runtimes
        runtimes = get_piston_runtimes()
        if not runtimes:
            return {"error": "Unable to fetch available runtimes"}
        
        # Find the appropriate runtime
        runtime = None
        for rt in runtimes:
            if rt['language'] == piston_language:
                runtime = rt
                break
        
        if not runtime:
            return {"error": f"Language '{language}' not supported"}
        
        # Prepare execution request
        execution_data = {
            "language": runtime['language'],
            "version": runtime['version'],
            "files": [
                {
                    "name": f"main.{get_file_extension(language)}",
                    "content": code
                }
            ]
        }
        
        # Execute code
        response = requests.post(
            f"{PISTON_API_URL}/execute",
            json=execution_data,
            timeout=30
        )
        
        if response.status_code == 200:
            result = response.json()
            
            output = ""
            if result.get('run'):
                if result['run'].get('stdout'):
                    output += result['run']['stdout']
                if result['run'].get('stderr'):
                    output += f"\nErrors:\n{result['run']['stderr']}"
                if result['run'].get('code') != 0:
                    output += f"\nExit code: {result['run']['code']}"
            
            return {
                "output": output if output else "Code executed successfully (no output)",
                "success": True,
                "runtime": f"{runtime['language']} {runtime['version']}"
            }
        else:
            return {"error": f"Execution failed: {response.text}"}
            
    except Exception as e:
        return {"error": f"Execution error: {str(e)}"}

def get_file_extension(language):
    """Get file extension for language"""
    extensions = {
        'javascript': 'js',
        'python': 'py',
        'java': 'java',
        'cpp': 'cpp',
        'c': 'c',
        'csharp': 'cs',
        'php': 'php',
        'ruby': 'rb',
        'go': 'go',
        'rust': 'rs',
        'typescript': 'ts'
    }
    return extensions.get(language, 'txt')

def analyze_code_with_codellama(code, language):
    """Analyze code using CodeLlama (Ollama)"""
    try:
        prompt = f"""
        Analyze the following {language} code for:
        1. Syntax errors and issues
        2. Logic problems and bugs
        3. Performance improvements
        4. Security vulnerabilities
        5. Code quality and best practices
        6. Potential runtime errors
        
        Code to analyze:
        ```{language}
        {code}
        ```
        
        Provide a detailed analysis with specific suggestions for improvement.
        """

        payload = {
            "model": "codellama",
            "prompt": prompt,
            "stream": False,
            "options": {
                "temperature": 0.3,
                "top_p": 0.9,
                "max_tokens": 2000
            }
        }

        response = requests.post(CODELLAMA_API_URL, json=payload, timeout=300)
        
        if response.status_code == 200:
            result = response.json()
            analysis = result.get("response", "No analysis available")
            return {"analysis": analysis, "success": True}
        else:
            raise Exception(f"CodeLlama API returned status {response.status_code}")
            
    except Exception as e:
        print(f"CodeLlama error: {e}")
        return {"analysis": f"Analysis service unavailable: {str(e)}", "success": False}

@app.route("/execute", methods=["POST"])
def execute_code():
    """Execute code using Piston API"""
    data = request.json
    user_code = data.get("code", "")
    language = data.get("language", "python")
    
    if not user_code:
        return jsonify({"error": "No code provided"}), 400
    
    result = execute_code_with_piston(user_code, language)
    return jsonify(result)

@app.route("/analyze", methods=["POST"])
def analyze_code():
    """Analyze code using CodeLlama"""
    data = request.json
    user_code = data.get("code", "")
    language = data.get("language", "python")
    
    if not user_code:
        return jsonify({"error": "No code provided"}), 400

    # Use CodeLlama for analysis
    result = analyze_code_with_codellama(user_code, language)
    
    if result["success"]:
        return jsonify({"analysis_result": [result["analysis"]]})
    else:
        # Fallback to Gemini if CodeLlama fails
        try:
            model = genai.GenerativeModel('gemini-2.0-flash')
            gemini_prompt = f"""
            Analyze this {language} code for issues and improvements:
            
            {user_code}
            
            Provide feedback on:
            - Syntax and logic errors
            - Performance optimizations
            - Security concerns
            - Code quality improvements
            """
            
            response = model.generate_content(gemini_prompt)
            return jsonify({"analysis_result": [response.text]})
        except Exception as gemini_error:
            return jsonify({"analysis_result": [f"Analysis service temporarily unavailable. Error: {gemini_error}"]})

@app.route("/report", methods=["POST"])
def generate_report():
    """Generate detailed code report"""
    data = request.json
    code = data.get("code", "")
    language = data.get("language", "python")
    code_analysis = data.get("code_sum", [])
    
    if not code:
        return jsonify({"error": "No code provided"}), 400

    try:
        model = genai.GenerativeModel('gemini-2.0-flash')
        
        report_prompt = f"""
        Generate a comprehensive code report for the following {language} code:
        
        CODE:
        {code}
        
        ANALYSIS RESULTS:
        {' '.join(code_analysis) if code_analysis else 'No prior analysis available'}
        
        Please provide a detailed report including:
        
        1. CODE OVERVIEW
        - Purpose and functionality
        - Key components and structure
        
        2. TECHNICAL ANALYSIS
        - Code complexity assessment
        - Performance characteristics
        - Memory usage considerations
        
        3. QUALITY ASSESSMENT
        - Code readability score
        - Maintainability factors
        - Documentation quality
        
        4. SECURITY REVIEW
        - Potential vulnerabilities
        - Security best practices compliance
        
        5. RECOMMENDATIONS
        - Specific improvements suggested
        - Refactoring opportunities
        - Best practices to implement
        
        6. SUMMARY
        - Overall code rating (1-10)
        - Priority action items
        
        Format the report professionally with clear sections and bullet points.
        """
        
        response = model.generate_content(report_prompt)
        
        # Add header with timestamp
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        full_report = f"""
CODE ANALYSIS REPORT
Generated on: {timestamp}
Language: {language.upper()}
{'='*50}

{response.text}

{'='*50}
Report generated by DEV IDE - AI-Powered Code Analysis
"""
        
        return jsonify({"report": full_report})
        
    except Exception as e:
        error_report = f"""
CODE ANALYSIS REPORT
Generated on: {datetime.now().strftime("%Y-%m-%d %H:%M:%S")}
Language: {language.upper()}
{'='*50}

ERROR: Report generation failed
Details: {str(e)}

BASIC CODE SUMMARY:
- Code length: {len(code)} characters
- Lines of code: {len(code.split('\n'))}
- Language: {language}

Please check your API configuration and try again.

{'='*50}
Report generated by DEV IDE - AI-Powered Code Analysis
"""
        return jsonify({"report": error_report})
@app.route('/voice-to-code', methods=['POST'])
def voice_to_code():
    try:
        data = request.json or {}
        voice_input = data.get('voice_input')

        if not voice_input:
            # No text provided → listen for voice input
            voice_input = voice_assistant.listen()

            if "error" in voice_input.lower() or "could not" in voice_input.lower():
                return jsonify({"error": voice_input, "code": ""})
        
        # Now generate code from voice_input text (either listened or sent by frontend)
        voice_assistant.speak("Processing your request...")
        generated_code = voice_assistant.generate_code(voice_input)
        voice_assistant.speak("Code generated successfully!")

        return jsonify({
            "voice_input": voice_input,
            "code": generated_code,
            "timestamp": datetime.now().isoformat()
        })

    except Exception as e:
        error_msg = f"Voice processing error: {str(e)}"
        return jsonify({"error": error_msg, "code": ""})

@app.route("/chat", methods=["POST"])
def chat_with_assistant():
    """Chat with AI assistant about code"""
    data = request.json
    message = data.get("message", "")
    code_context = data.get("code", "")
    
    if not message:
        return jsonify({"error": "No message provided"}), 400
    
    try:
        model = genai.GenerativeModel('gemini-2.0-flash')
        
        context_prompt = ""
        if code_context:
            context_prompt = f"\n\nCurrent code context:\n{code_context}\n\n"
        
        chat_prompt = f"""
        You are a helpful programming assistant in DEV IDE.
        {context_prompt}
        User question: {message}
        
        Provide a helpful, concise response. If the question is about code, provide specific examples and explanations.
        """
        
        response = model.generate_content(chat_prompt)
        return jsonify({"response": response.text})
        
    except Exception as e:
        return jsonify({"error": f"Chat error: {str(e)}"})

@app.route("/health", methods=["GET"])
def health_check():
    """Health check endpoint"""
    return jsonify({
        "status": "healthy",
        "timestamp": datetime.now().isoformat(),
        "services": {
            "piston": check_piston_status(),
            "codellama": check_codellama_status(),
            "gemini": check_gemini_status()
        }
    })

def check_piston_status():
    """Check if Piston API is available"""
    try:
        response = requests.get(f"{PISTON_API_URL}/runtimes", timeout=5)
        return "available" if response.status_code == 200 else "unavailable"
    except:
        return "unavailable"

def check_codellama_status():
    """Check if CodeLlama (Ollama) service is available"""
    try:
        response = requests.post(CODELLAMA_API_URL, json={
            "model": "codellama",
            "prompt": "test",
            "stream": False
        }, timeout=5)
        return "available" if response.status_code == 200 else "unavailable"
    except:
        return "unavailable"

def check_gemini_status():
    """Check if Gemini API is configured"""
    return "configured" if GEMINI_API_KEY != "YOUR_GEMINI_API_KEY_HERE" else "not_configured"

if __name__ == "__main__":
    print("Starting DEV IDE Backend Server...")
    print("Features enabled:")
    print("- Code Execution (Piston API)")
    print("- Code Analysis (CodeLlama + Gemini)")
    print("- Report Generation (Gemini)")
    print("- Voice-to-Code (Gemini + Speech Recognition)")
    print("- AI Chat Assistant (Gemini)")
    print("\nMake sure to:")
    print("1. Install required packages: pip install flask google-generativeai speechrecognition pyttsx3 pyaudio requests")
    print("2. Set your Gemini API key in the code")
    print("3. Start Ollama service with CodeLlama model")
    print("   - ollama pull codellama")
    print("   - ollama serve")
    print("4. Ensure internet connection for Piston API")
    print("\nServer starting on http://localhost:5000")
    check_gemini_status()
    check_codellama_status()
    check_piston_status()
    app.run(debug=True, port=5000, threaded=True)