# app.py
from flask import Flask, render_template, request, jsonify
from chatai import get_gemini_response

app = Flask(__name__)

# Route for the homepage
@app.route('/')
def home():
    return render_template('index.html')

# API endpoint to handle chat messages
@app.route('/get_response', methods=['POST'])
def get_response():
    data = request.json
    question = data.get("question")
    response = get_gemini_response(question)
    return jsonify(response=response)

if __name__ == '__main__':
    app.run(debug=True)
