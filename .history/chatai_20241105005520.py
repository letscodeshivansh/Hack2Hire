from dotenv import load_dotenv
import os 
import google.generativeai as genai

# Load the environment variables
load_dotenv()

# Configure the Generative AI with the API key from the environment variable
genai.configure(api_key=os.getenv("GOOGLE_API_KEY"))

# Function to load Gemini model and get responses
model = genai.GenerativeModel("gemini-1.5-flash")

chat = model.start_chat(history = [])

def get_gemini_response(question):
    response = chat.send_message(question, stream = True)
    return response

#initialize the streamlit
st.set_page_config(page_title = "Chat-Bot")
st.header("Gemini LLM Application")

#Initialize session state for chat history if it doesnt exist
if 'chat_history' not in st.session_state:
    st.session_state['chat_history'] = []

input = st.text_input("Input:", key = "input")
submit = st.button("Ask the question")

if submit and input:
    response = get_gemini_response(input)
    st.session_state['chat_history'].append(("You: ", input))
    st.subheader("Response: ")
    for chunk in response:
        st.write(chunk.text)
        st.session_state['chat_history'].append(("Bot: ", chunk))
        
st.subheader("Chat History: ")

for role, text in st.session_state['chat_history']:
    st.write(f"{role}:{text}")
        
    
