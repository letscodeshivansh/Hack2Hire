const chatBox = document.getElementById("chat-box");
const userInput = document.getElementById("user-input");
        const sendButton = document.getElementById("send-button");
        async function sendMessage() {
            const question = userInput.value.trim();
            if (!question) return;

            addMessage(question, "user-message");
            userInput.value = "";
            toggleSendButton(false);

            const loadingMessage = document.createElement("div");
            loadingMessage.className = "loading-indicator";
            loadingMessage.textContent = "Thinking...";
            loadingMessage.setAttribute("aria-busy", "true");
            chatBox.appendChild(loadingMessage);
            chatBox.scrollTop = chatBox.scrollHeight;

            try {
                const response = await fetch("/askai", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({ question }),
                });

                const data = await response.json();
                chatBox.removeChild(loadingMessage);
                loadingMessage.removeAttribute("aria-busy");

                if (response.ok && data.answer) {
                    addMessage(data.answer, "ai-message");
                } else {
                    addMessage(data.error || "Sorry, I couldn't process that.", "ai-message");
                }
            } catch (error) {
                console.error("Fetch error:", error);
                chatBox.removeChild(loadingMessage);
                addMessage("Error communicating with the server.", "ai-message");
            } finally {
                toggleSendButton(true);
            }
        }

        function addMessage(text, className) {
            const message = document.createElement("div");
            message.className = `message ${className}`;
            message.textContent = text;
            chatBox.appendChild(message);
            chatBox.scrollTop = chatBox.scrollHeight;
        }

        function toggleSendButton(enable) {
            sendButton.disabled = !enable;
        }

        userInput.addEventListener("keypress", (event) => {
            if (event.key === "Enter" && !sendButton.disabled) {
                sendMessage();
            }
        });

        sendButton.addEventListener("click", sendMessage);