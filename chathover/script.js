// Select elements
const chatBtn = document.getElementById("chatBtn");
const chatBox = document.getElementById("chatBox");
const closeBtn = document.getElementById("closeBtn");

// Open chat box
chatBtn.addEventListener("click", () => {
  chatBox.style.display = "flex";
});

// Close chat box
closeBtn.addEventListener("click", () => {
  chatBox.style.display = "none";
});
