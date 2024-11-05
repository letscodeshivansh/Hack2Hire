from dotenv import load_dotenv
import os 
import google.generativeai as genai

# Load the environment variables
load_dotenv()

# Configure the Generative AI with the API key from the environment variable
genai.configure(api_key=os.getenv("GOOGLE_API_KEY"))

# Function to load Gemini model and get responses
model = genai.GenerativeModel("gemini-1.5-flash")

# chat = model.start_chat(history = [])

def get_gemini_response(question):
    response = chat.send_message(question, stream = True)
    return response


        
    
