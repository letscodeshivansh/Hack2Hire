from dotenv import load_dotenv
import os
import google.generativeai as genai
import sys

# Load environment variables
load_dotenv()

# Configure the Generative AI with the API key from the environment variable
genai.configure(api_key=os.getenv("GOOGLE_API_KEY"))

# Function to load Gemini model and get responses
model = genai.GenerativeModel("gemini-1.5-flash")
chat = model.start_chat(history=[])

def get_gemini_response(question):
    # Get the response and extract the text from the first candidate
    response = chat.send_message(question, stream=True)
    try:
        return response.result["candidates"][0]["content"]["parts"][0]["text"]
    except (IndexError, KeyError):
        return "Failed to generate a response."

if __name__ == "__main__":
    # Read the question from command-line arguments
    question = sys.argv[1]
    answer = get_gemini_response(question)
    print(answer)
